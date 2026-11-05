/**
 * Permissive in-memory Supabase for the client-payload replay suite.
 *
 * Unlike the strict service-test fakes, any route may hit it: unknown query-builder
 * methods are accepted as no-ops (a filter it does not model matches every row), and
 * `rpc`, `storage` and `auth` are stubbed. It records every write so a fixture can
 * assert what the route STORED. It is not a database: it models what a replay needs
 * (insert / upsert / update / delete / select with simple filters), nothing more.
 */
type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

export interface ReplayWrite {
  table: string;
  op: Op;
  payload: Row | Row[] | undefined;
}

let idCounter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);
const same = (a: unknown, b: unknown) => a === b || lower(a) === lower(b);
const cmp = (a: any, b: any) => (a === b ? 0 : a > b ? 1 : -1);

export function createReplaySupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const writes: ReplayWrite[] = [];

  function builder(table: string) {
    let op: Op = 'select';
    let payload: Row | Row[] | undefined;
    let conflict: string[] | undefined;
    let ignoreDuplicates = false;
    let mode: 'many' | 'single' | 'maybeSingle' = 'many';
    let countRequested = false;
    let head = false;
    let max: number | undefined;
    const filters: ((row: Row) => boolean)[] = [];
    const orders: { column: string; ascending: boolean }[] = [];

    const run = () => {
      if (op !== 'select') writes.push({ table, op, payload });
      const rows = (tables[table] ??= []);
      let result: Row[] = [];
      if (op === 'select') {
        result = rows.filter((r) => filters.every((f) => f(r)));
      } else if (op === 'insert' || op === 'upsert') {
        const incoming = Array.isArray(payload) ? payload : [payload ?? {}];
        for (const item of incoming) {
          const existing =
            op === 'upsert' && conflict ? rows.find((r) => conflict!.every((c) => same(r[c], item[c]))) : undefined;
          if (existing) {
            if (!ignoreDuplicates) Object.assign(existing, item);
            result.push(existing);
          } else {
            const now = new Date().toISOString();
            const row = { id: nextId(), created_at: now, updated_at: now, ...item };
            rows.push(row);
            result.push(row);
          }
        }
      } else if (op === 'update') {
        result = rows.filter((r) => filters.every((f) => f(r)));
        for (const row of result) Object.assign(row, payload as Row);
      } else if (op === 'delete') {
        result = rows.filter((r) => filters.every((f) => f(r)));
        tables[table] = rows.filter((r) => !result.includes(r));
      }
      for (const { column, ascending } of [...orders].reverse()) {
        result = [...result].sort((a, b) => cmp(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (max !== undefined) result = result.slice(0, max);
      const copies = result.map((r) => ({ ...r }));
      const count = countRequested ? copies.length : null;
      if (head) return { data: null, error: null, count };
      if (mode === 'single') {
        return copies.length === 1
          ? { data: copies[0], error: null, count }
          : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count };
      }
      if (mode === 'maybeSingle') return { data: copies[0] ?? null, error: null, count };
      return { data: copies, error: null, count };
    };

    const api: Record<string, (...args: any[]) => any> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) countRequested = true;
        if (opts?.head) head = true;
        return proxy;
      },
      insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), proxy),
      update: (p: Row) => ((op = 'update'), (payload = p), proxy),
      upsert: (p: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = 'upsert';
        payload = p;
        conflict = opts?.onConflict?.split(',').map((c) => c.trim());
        ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
        return proxy;
      },
      delete: () => ((op = 'delete'), proxy),
      eq: (c: string, v: unknown) => (filters.push((r) => same(r[c], v)), proxy),
      neq: (c: string, v: unknown) => (filters.push((r) => !same(r[c], v)), proxy),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.some((v) => same(r[c], v))), proxy),
      gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) >= 0), proxy),
      gt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) > 0), proxy),
      lte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) <= 0), proxy),
      lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) < 0), proxy),
      is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), proxy),
      match: (o: Row) => (filters.push((r) => Object.entries(o).every(([k, v]) => same(r[k], v))), proxy),
      order: (column: string, opts?: { ascending?: boolean }) => (
        orders.push({ column, ascending: opts?.ascending !== false }), proxy
      ),
      limit: (n: number) => ((max = n), proxy),
      range: (from: number, to: number) => ((max = to - from + 1), proxy),
      single: () => ((mode = 'single'), proxy),
      maybeSingle: () => ((mode = 'maybeSingle'), proxy),
      then: (onF?: (v: any) => any, onR?: (e: any) => any) => Promise.resolve().then(run).then(onF, onR),
    };

    // Anything not modelled (or, not, ilike, contains, filter, textSearch, abortSignal…) is a no-op.
    const proxy: any = new Proxy(api, {
      get: (target, prop: string) => (prop in target ? target[prop] : () => proxy),
    });
    return proxy;
  }

  const authUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    user_metadata: { display_name: 'Replay User' },
    app_metadata: {},
  };
  const authSession = { access_token: 'replay-access', refresh_token: 'replay-refresh', expires_at: 2_000_000_000, user: authUser };

  const storageBucket = {
    upload: async (path: string) => ({ data: { path }, error: null }),
    remove: async () => ({ data: [], error: null }),
    download: async () => ({ data: null, error: { message: 'not stored' } }),
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.example.com/${path}` }, error: null }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.com/${path}` } }),
  };

  const client: any = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => storageBucket },
    // Supabase Auth: every call succeeds for the replay user (sign-in, sign-up, reset, resend…).
    auth: new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === 'admin'
            ? new Proxy({}, { get: () => async () => ({ data: { user: authUser }, error: null }) })
            : async () => ({ data: { user: authUser, session: authSession }, error: null }),
      }
    ),
    channel: () => ({ send: async () => 'ok', subscribe: () => ({}), unsubscribe: async () => 'ok' }),
    removeChannel: async () => 'ok',
  };

  return {
    client,
    tables,
    writes,
    rows: (table: string) => tables[table] ?? [],
  };
}
