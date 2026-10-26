/**
 * Minimal in-memory Supabase stand-in for the home-feed route tests: the
 * query shapes HomeFeedService + the context loaders use (select / eq / order
 * / in / limit / count-head / insert / update / maybeSingle / single).
 */
type Row = Record<string, any>;

export class HomeFeedFakeDb {
  tables: Record<string, Row[]> = {
    profiles: [],
    home_feed_rules: [],
    home_feed_decisions: [],
    home_feed_events: [],
    fitcircle_members: [],
    streak_claims: [],
    feature_flags: [],
    // promo@1 / activation journey (migration 110)
    food_log_entries: [],
    promo_user_state: [],
    feature_gates: [],
  };
  /** Tables whose next query errors (simulate outages). */
  failing = new Set<string>();
  /** Queries run per table (latency tests: warm requests must not re-read shared tables). */
  queries: Record<string, number> = {};
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables[table]) throw new Error(`HomeFeedFakeDb: unknown table ${table}`);
    return this.tables[table];
  }

  nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-a000-${String(this.seq).padStart(12, '0')}`;
  }

  client() {
    return { from: (table: string) => new FakeQuery(this, table) };
  }
}

class FakeQuery implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private conflictCols: string[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private preds: Array<(r: Row) => boolean> = [];
  private filters: Array<[string, any]> = [];
  private payload: Row | Row[] | null = null;
  private countMode = false;
  private returning = false;

  constructor(
    private db: HomeFeedFakeDb,
    private table: string
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = rows;
    this.conflictCols = (opts?.onConflict ?? 'id').split(',').map((c) => c.trim());
    return this;
  }
  gte(col: string, val: any) {
    this.preds.push((r) => r[col] !== null && r[col] !== undefined && r[col] >= val);
    return this;
  }
  lte(col: string, val: any) {
    this.preds.push((r) => r[col] !== null && r[col] !== undefined && r[col] <= val);
    return this;
  }
  is(col: string, val: any) {
    this.preds.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push([col, val]);
    return this;
  }
  in(col: string, vals: any[]) {
    this.inFilters.push([col, vals]);
    return this;
  }
  order(col?: string, opts?: { ascending?: boolean }) {
    if (col) this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n?: number) {
    if (typeof n === 'number') this.limitN = n;
    return this;
  }

  private inFilters: Array<[string, any[]]> = [];
  private matches = (r: Row) =>
    this.filters.every(([c, v]) => r[c] === v) && this.inFilters.every(([c, vs]) => vs.includes(r[c])) && this.preds.every((p) => p(r));

  private run(): { data: any; error: any; count?: number } {
    this.db.queries[this.table] = (this.db.queries[this.table] ?? 0) + 1;
    if (this.db.failing.has(this.table)) return { data: null, error: { message: `${this.table} unavailable` } };
    const rows = this.db.rows(this.table);
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const inserted: Row[] = [];
      for (const r of list) {
        if (this.table === 'home_feed_rules' && rows.some((x) => x.key === r.key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const now = new Date().toISOString();
        const row = { id: r.id ?? this.db.nextId(), created_at: now, ...(this.table === 'home_feed_rules' ? { updated_at: now } : {}), ...r };
        rows.push(row);
        inserted.push(row);
      }
      return { data: this.returning ? inserted : null, error: null };
    }
    if (this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const out: Row[] = [];
      for (const r of list) {
        const hit = rows.find((x) => this.conflictCols.every((c) => x[c] === r[c]));
        if (hit) Object.assign(hit, r);
        else rows.push({ ...r });
        out.push(hit ?? r);
      }
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === 'update') {
      const hit = rows.filter(this.matches);
      for (const r of hit) Object.assign(r, this.payload);
      return { data: hit, error: null };
    }
    let hit = rows.filter(this.matches);
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      hit = [...hit].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1)));
    }
    if (this.limitN !== null) hit = hit.slice(0, this.limitN);
    return this.countMode ? { data: null, error: null, count: hit.length } : { data: hit, error: null };
  }

  async maybeSingle() {
    const r = this.run();
    return r.error ? r : { data: (r.data ?? [])[0] ?? null, error: null };
  }

  async single() {
    const r = this.run();
    if (r.error) return r;
    const row = (r.data ?? [])[0];
    return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
  }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve(this.run()).then(ok, ko);
  }
}

let current = new HomeFeedFakeDb();
export const getHomeFeedDb = () => current;
export const setHomeFeedDb = (db: HomeFeedFakeDb) => {
  current = db;
};
