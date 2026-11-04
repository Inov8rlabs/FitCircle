/**
 * Minimal in-memory Supabase for the sign-up → welcome-email tests: one store
 * shared by `@supabase/supabase-js` createClient (the auth routes) and
 * `@/lib/supabase-admin` createAdminSupabase (welcome ledger, test-device flag),
 * so a profile one route creates is the profile the welcome ledger reads.
 *
 * Supports what those paths use: select / insert / update / upsert, eq / ilike /
 * is (incl. JSON paths like `metadata->welcome_email`) / in, limit,
 * maybeSingle / single / await, plus auth.signUp / admin.getUserById /
 * admin.createUser / admin.deleteUser / getUser.
 */
type Row = Record<string, any>;

const path = (r: Row, col: string) => col.split(/->>?/).reduce<any>((v, k) => (v == null ? v : v[k]), r);

export class WelcomeFakeDb {
  tables = new Map<string, Row[]>();
  users = new Map<string, { id: string; email: string; created_at: string; user_metadata: Row }>();
  tokens = new Map<string, string>();
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  profile(id: string): Row | undefined {
    return this.rows('profiles').find((p) => p.id === id);
  }

  addUser(email: string, opts: { createdAt?: string; profile?: Row | null; metadata?: Row } = {}): string {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.users.set(id, { id, email, created_at: opts.createdAt ?? new Date().toISOString(), user_metadata: opts.metadata ?? {} });
    if (opts.profile !== null) this.rows('profiles').push({ id, email, display_name: null, is_admin: false, metadata: null, ...(opts.profile ?? {}) });
    return id;
  }

  client() {
    return this.makeClient(this);
  }

  private makeClient(db: WelcomeFakeDb) {
    return {
      from: (table: string) => new Query(db, table),
      auth: {
        signUp: async ({ email }: { email: string }) => {
          const id = db.addUser(email, { profile: null });
          return { data: { user: { id, email, identities: [{}] }, session: null }, error: null };
        },
        getUser: async (token?: string) => {
          const id = token ? db.tokens.get(token) : undefined;
          const u = id ? db.users.get(id) : undefined;
          return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
        },
        admin: {
          getUserById: async (id: string) => ({ data: { user: db.users.get(id) ?? null }, error: null }),
          createUser: async ({ email, user_metadata }: { email: string; user_metadata?: Row }) => {
            if ([...db.users.values()].some((u) => u.email.toLowerCase() === email.toLowerCase())) {
              return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } };
            }
            const id = db.addUser(email, { profile: null, metadata: user_metadata });
            return { data: { user: db.users.get(id) }, error: null };
          },
          listUsers: async () => ({ data: { users: [...db.users.values()] }, error: null }),
          deleteUser: async (id: string) => {
            db.users.delete(id);
            return { data: null, error: null };
          },
        },
      },
    };
  }
}

class Query implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: any = null;
  private filters: Array<(r: Row) => boolean> = [];
  private max = Infinity;
  private returning = false;

  constructor(private db: WelcomeFakeDb, private table: string) {}

  select(_cols?: string) {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  upsert(row: Row) {
    this.op = 'upsert';
    this.payload = row;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push((r) => (path(r, col) ?? null) === (val ?? null));
    return this;
  }
  ilike(col: string, val: string) {
    this.filters.push((r) => String(path(r, col) ?? '').toLowerCase() === String(val).toLowerCase());
    return this;
  }
  is(col: string, val: any) {
    this.filters.push((r) => (path(r, col) ?? null) === val);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push((r) => vals.includes(path(r, col)));
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  async maybeSingle() {
    const { data, error } = this.run();
    return { data: Array.isArray(data) ? data[0] ?? null : data, error };
  }
  async single() {
    const { data, error } = this.run();
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { data: row, error } : { data: null, error: error ?? { code: 'PGRST116', message: 'no rows' } };
  }
  then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }

  private matches(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): { data: any; error: any } {
    const rows = this.db.rows(this.table);
    switch (this.op) {
      case 'select':
        return { data: this.matches().slice(0, this.max).map((r) => structuredClone(r)), error: null };
      case 'insert': {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const r of list) {
          if (r.id && rows.some((x) => x.id === r.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows.push(...list.map((r: Row) => ({ metadata: null, is_admin: false, ...structuredClone(r) })));
        return { data: list.map((r: Row) => structuredClone(r)), error: null };
      }
      case 'upsert': {
        const i = rows.findIndex((x) => x.id === this.payload.id);
        if (i >= 0) rows[i] = { ...rows[i], ...structuredClone(this.payload) };
        else rows.push({ metadata: null, is_admin: false, ...structuredClone(this.payload) });
        return { data: [structuredClone(rows[i >= 0 ? i : rows.length - 1])], error: null };
      }
      case 'update': {
        const hit = this.matches();
        for (const r of hit) Object.assign(r, structuredClone(this.payload));
        return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
    }
  }
}
