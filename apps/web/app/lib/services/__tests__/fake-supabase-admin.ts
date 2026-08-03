/**
 * In-memory stand-in for the service-role Supabase client, covering exactly the
 * query shapes the billing/quota services use (insert / select+filters /
 * maybeSingle / count-head / update / delete / in). Test files register a fresh
 * FakeDb per test via setDb(); the vi.mock factory routes createAdminSupabase()
 * here.
 */

type Row = Record<string, any>;

export class FakeDb {
  profiles = new Map<string, Row>();
  subscription_events = new Map<string, Row>();
  payments: Row[] = [];
  feature_gates = new Map<string, string>(); // feature_key → required_tier
  nutrition_parse_log: Row[] = [];
  fitzy_message_log: Row[] = [];
  fitcircles: Row[] = [];
  feature_flags: Row[] = [];

  client() {
    return { from: (table: string) => new FakeQuery(this, table) };
  }

  rows(table: string): Row[] {
    switch (table) {
      case 'profiles':
        return [...this.profiles.values()];
      case 'subscription_events':
        return [...this.subscription_events.values()];
      case 'payments':
        return this.payments;
      case 'feature_gates':
        return [...this.feature_gates.entries()].map(([feature_key, required_tier]) => ({
          feature_key,
          required_tier,
        }));
      case 'nutrition_parse_log':
        return this.nutrition_parse_log;
      case 'fitzy_message_log':
        return this.fitzy_message_log;
      case 'fitcircles':
        return this.fitcircles;
      case 'feature_flags':
        return this.feature_flags;
      default:
        throw new Error(`FakeDb: unknown table ${table}`);
    }
  }
}

type Filter = { kind: 'eq' | 'neq' | 'gte' | 'lt'; col: string; val: any } | { kind: 'in'; col: string; vals: any[] } | { kind: 'notIs'; col: string; val: any };

class FakeQuery implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: Filter[] = [];
  private insertRow: Row | null = null;
  private patch: Row | null = null;
  private countMode = false;

  constructor(
    private db: FakeDb,
    private table: string
  ) {}

  insert(row: Row) {
    this.op = 'insert';
    this.insertRow = row;
    return this;
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    return this;
  }

  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(col: string, val: any) { this.filters.push({ kind: 'eq', col, val }); return this; }
  neq(col: string, val: any) { this.filters.push({ kind: 'neq', col, val }); return this; }
  gte(col: string, val: any) { this.filters.push({ kind: 'gte', col, val }); return this; }
  lt(col: string, val: any) { this.filters.push({ kind: 'lt', col, val }); return this; }
  in(col: string, vals: any[]) { this.filters.push({ kind: 'in', col, vals }); return this; }
  not(col: string, _op: string, val: any) { this.filters.push({ kind: 'notIs', col, val }); return this; }
  limit(_n: number) { return this; }
  order(_c: string, _o?: any) { return this; }

  async maybeSingle() {
    const rows = this.filtered();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.filtered();
    return rows[0]
      ? { data: rows[0], error: null }
      : { data: null, error: { message: 'not found' } };
  }

  then<TResult1 = any, TResult2 = never>(
    onFulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }

  private filtered(): Row[] {
    return this.db.rows(this.table).filter((row) =>
      this.filters.every((f) => {
        switch (f.kind) {
          case 'eq': return row[f.col] === f.val;
          case 'neq': return row[f.col] !== f.val;
          case 'gte': return row[f.col] >= f.val;
          case 'lt': return row[f.col] != null && row[f.col] < f.val;
          case 'in': return f.vals.includes(row[f.col]);
          case 'notIs': return row[f.col] !== f.val;
        }
      })
    );
  }

  private run(): any {
    switch (this.op) {
      case 'insert': {
        const row = this.insertRow!;
        if (this.table === 'subscription_events') {
          if (this.db.subscription_events.has(row.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          this.db.subscription_events.set(row.id, { ...row });
          return { data: null, error: null };
        }
        if (this.table === 'payments') {
          this.db.payments.push({ ...row });
          return { data: null, error: null };
        }
        if (this.table === 'fitzy_message_log') {
          this.db.fitzy_message_log.push({ created_at: new Date().toISOString(), ...row });
          return { data: null, error: null };
        }
        if (this.table === 'nutrition_parse_log') {
          this.db.nutrition_parse_log.push({ created_at: new Date().toISOString(), ...row });
          return { data: null, error: null };
        }
        throw new Error(`FakeDb: insert not supported on ${this.table}`);
      }
      case 'update': {
        for (const row of this.filtered()) Object.assign(row, this.patch);
        return { data: null, error: null };
      }
      case 'delete': {
        if (this.table === 'subscription_events') {
          for (const row of this.filtered()) this.db.subscription_events.delete(row.id);
          return { data: null, error: null };
        }
        throw new Error(`FakeDb: delete not supported on ${this.table}`);
      }
      case 'select': {
        const rows = this.filtered();
        if (this.countMode) return { count: rows.length, data: null, error: null };
        return { data: rows, error: null };
      }
    }
  }
}

let current: FakeDb = new FakeDb();
export function setDb(db: FakeDb) { current = db; }
export function getDb(): FakeDb { return current; }
