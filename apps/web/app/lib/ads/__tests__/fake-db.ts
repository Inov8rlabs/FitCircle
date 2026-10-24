/**
 * In-memory Supabase stand-in for the ads console tests. Supports the query
 * shapes the ads services use: select / eq / in / gte / lte / lt / not-is-null
 * / order / limit / range / maybeSingle / single / insert(+select) / update /
 * upsert(onConflict).
 */
type Row = Record<string, any>;

const PK: Record<string, string[]> = {
  ad_entities: ['channel', 'level', 'external_id'],
  ad_metrics_daily: ['channel', 'level', 'external_id', 'date'],
  user_attribution: ['user_id'],
  ad_change_log: ['id'],
  ad_sync_runs: ['id'],
  profiles: ['id'],
  subscription_events: ['id'],
};

export class AdsFakeDb {
  tables: Record<string, Row[]> = {};
  failing = new Set<string>();
  private seq = 0;

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-a000-${String(this.seq).padStart(12, '0')}`;
  }

  client() {
    return { from: (table: string) => new FakeQuery(this, table) };
  }
}

type Filter = (r: Row) => boolean;

class FakeQuery implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private returning = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private conflict: string[] | null = null;

  constructor(
    private db: AdsFakeDb,
    private table: string
  ) {}

  select(_cols?: string) {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = rows;
    this.conflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : (PK[this.table] ?? ['id']);
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && r[col] >= val);
    return this;
  }
  lte(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && r[col] <= val);
    return this;
  }
  lt(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && r[col] < val);
    return this;
  }
  not(col: string, op: string, val: any) {
    if (op === 'is' && val === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.rng = [from, to];
    return this;
  }

  private matches = (r: Row) => this.filters.every((f) => f(r));

  private keyOf(r: Row, cols: string[]) {
    return cols.map((c) => String(r[c])).join('|');
  }

  private run(): { data: any; error: any } {
    if (this.db.failing.has(this.table)) return { data: null, error: { message: `${this.table} unavailable` } };
    const rows = this.db.rows(this.table);
    const now = new Date().toISOString();
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const pk = PK[this.table] ?? ['id'];
      const out: Row[] = [];
      for (const r of list) {
        const row = { ...(pk.includes('id') ? { id: r.id ?? this.db.nextId() } : {}), created_at: r.created_at ?? now, ...r };
        if (rows.some((x) => this.keyOf(x, pk) === this.keyOf(row, pk))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        rows.push(row);
        out.push(row);
      }
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      for (const r of list) {
        const hit = rows.find((x) => this.keyOf(x, this.conflict!) === this.keyOf(r, this.conflict!));
        if (hit) Object.assign(hit, r);
        else rows.push({ id: this.db.nextId(), ...r });
      }
      return { data: this.returning ? list : null, error: null };
    }
    if (this.op === 'update') {
      const hit = rows.filter(this.matches);
      for (const r of hit) Object.assign(r, this.payload);
      return { data: this.returning ? hit : null, error: null };
    }
    let hit = rows.filter(this.matches);
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      hit = [...hit].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] ?? '') < (b[col] ?? '') ? (asc ? -1 : 1) : asc ? 1 : -1));
    }
    if (this.rng) hit = hit.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== null) hit = hit.slice(0, this.lim);
    return { data: hit.map((r) => ({ ...r })), error: null };
  }

  async maybeSingle() {
    const r = this.run();
    if (r.error) return r;
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return { data, error: null };
  }

  async single() {
    const r = this.run();
    if (r.error) return r;
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
  }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve(this.run()).then(ok, ko);
  }
}

let current = new AdsFakeDb();
export const getAdsDb = () => current;
export const setAdsDb = (db: AdsFakeDb) => {
  current = db;
};
