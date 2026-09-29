/**
 * In-memory stand-in for the service-role Supabase client, covering the query
 * shapes `circle-challenge-service.ts` uses: select (+ count/head), insert / upsert
 * (+ select + single), update, delete, eq / neq / gte / lte / in, order, range,
 * limit, single / maybeSingle.
 *
 * It enforces the constraints of the real tables that the service relies on
 * (`challenge_logs.amount` CHECK, note length, numeric(5,2) percentage), so a test
 * fails the way production would.
 */

export type Row = Record<string, any>;

type Filter =
  | { kind: 'eq' | 'neq' | 'gte' | 'lte'; col: string; val: any }
  | { kind: 'in'; col: string; vals: any[] };

let sequence = 0;
export function fakeUuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

export class ChallengeFakeDb {
  tables: Record<string, Row[]> = {
    challenges: [],
    challenge_participants: [],
    challenge_logs: [],
    challenge_invites: [],
    fitcircle_members: [],
    profiles: [],
    circle_encouragements: [],
  };

  /** Page size cap, like PostgREST's `max-rows`. */
  maxRows = 1000;
  /** Every write, in order: `{ table, op, row | patch }`. */
  writes: Array<{ table: string; op: string; payload: Row }> = [];

  client() {
    return { from: (table: string) => new Query(this, table) };
  }

  rows(table: string): Row[] {
    const rows = this.tables[table];
    if (!rows) throw new Error(`ChallengeFakeDb: unknown table ${table}`);
    return rows;
  }
}

class Query implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private countMode = false;
  private headMode = false;
  private returning = false;
  private orders: Array<{ col: string; ascending: boolean }> = [];
  private window: { from: number; to: number } | null = null;
  private max: number | null = null;

  constructor(
    private db: ChallengeFakeDb,
    private table: string
  ) {}

  insert(row: Row | Row[]) { this.op = 'insert'; this.payload = row; return this; }
  upsert(row: Row | Row[]) { this.op = 'insert'; this.payload = row; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') { this.returning = true; return this; }
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.headMode = true;
    return this;
  }

  eq(col: string, val: any) { this.filters.push({ kind: 'eq', col, val }); return this; }
  neq(col: string, val: any) { this.filters.push({ kind: 'neq', col, val }); return this; }
  gte(col: string, val: any) { this.filters.push({ kind: 'gte', col, val }); return this; }
  lte(col: string, val: any) { this.filters.push({ kind: 'lte', col, val }); return this; }
  in(col: string, vals: any[]) { this.filters.push({ kind: 'in', col, vals }); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }
  range(from: number, to: number) { this.window = { from, to }; return this; }
  limit(n: number) { this.max = n; return this; }

  async single() {
    const result = this.run();
    if (result.error) return result;
    const rows: Row[] = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    if (rows.length !== 1) {
      return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const result = this.run();
    if (result.error) return result;
    const rows: Row[] = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onFulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      switch (f.kind) {
        case 'eq': return row[f.col] === f.val;
        case 'neq': return row[f.col] !== f.val;
        case 'gte': return row[f.col] != null && row[f.col] >= f.val;
        case 'lte': return row[f.col] != null && row[f.col] <= f.val;
        case 'in': return f.vals.includes(row[f.col]);
      }
    });
  }

  private run(): { data: any; error: any; count?: number } {
    const rows = this.db.rows(this.table);

    switch (this.op) {
      case 'insert': {
        const inserted: Row[] = [];
        for (const input of Array.isArray(this.payload) ? this.payload : [this.payload as Row]) {
          const row = this.withDefaults(input);
          const violation = this.check(row);
          if (violation) return { data: null, error: violation };
          rows.push(row);
          inserted.push(row);
          this.db.writes.push({ table: this.table, op: 'insert', payload: { ...row } });
        }
        return { data: this.returning ? inserted.map((r) => ({ ...r })) : null, error: null };
      }
      case 'update': {
        const patch = this.payload as Row;
        const touched = rows.filter((row) => this.matches(row));
        for (const row of touched) {
          const next = { ...row, ...patch };
          const violation = this.check(next);
          if (violation) return { data: null, error: violation };
          Object.assign(row, patch);
        }
        this.db.writes.push({ table: this.table, op: 'update', payload: { ...patch } });
        return { data: this.returning ? touched.map((r) => ({ ...r })) : null, error: null };
      }
      case 'delete': {
        const keep = rows.filter((row) => !this.matches(row));
        const removed = rows.length - keep.length;
        this.db.tables[this.table] = keep;
        this.db.writes.push({ table: this.table, op: 'delete', payload: { removed } });
        return { data: null, error: null };
      }
      case 'select': {
        let result = rows.filter((row) => this.matches(row));
        if (this.countMode && this.headMode) return { data: null, error: null, count: result.length };

        for (const { col, ascending } of [...this.orders].reverse()) {
          result = [...result].sort((a, b) => {
            if (a[col] === b[col]) return 0;
            const less = a[col] < b[col] ? -1 : 1;
            return ascending ? less : -less;
          });
        }
        if (this.window) result = result.slice(this.window.from, this.window.to + 1);
        if (this.max !== null) result = result.slice(0, this.max);
        result = result.slice(0, this.db.maxRows);
        return { data: result.map((r) => ({ ...r })), error: null, count: result.length };
      }
    }
  }

  private withDefaults(input: Row): Row {
    const now = new Date().toISOString();
    const base: Row = { id: fakeUuid(), created_at: now };
    if (this.table === 'challenge_participants') {
      Object.assign(base, {
        status: 'active',
        cumulative_total: 0,
        today_total: 0,
        today_date: now.split('T')[0],
        current_streak: 0,
        longest_streak: 0,
        last_logged_at: null,
        log_count: 0,
        rank: null,
        goal_completion_pct: 0,
        milestones_achieved: {},
        joined_at: now,
        updated_at: now,
      });
    }
    if (this.table === 'challenge_logs') {
      Object.assign(base, { note: null, logged_at: now, log_date: now.split('T')[0] });
    }
    return { ...base, ...input };
  }

  /** The CHECK constraints / column types the service must respect. */
  private check(row: Row): { code: string; message: string } | null {
    if (this.table === 'challenge_logs') {
      if (!(row.amount > 0 && row.amount <= 10000)) {
        return { code: '23514', message: 'violates check constraint "circle_challenge_logs_amount_check"' };
      }
      if (Math.round(row.amount * 100) !== row.amount * 100 && Math.abs(Math.round(row.amount * 100) - row.amount * 100) > 1e-6) {
        return { code: 'FAKE', message: 'amount has more than 2 decimals (numeric(12,2) would round it)' };
      }
      if (typeof row.note === 'string' && row.note.length > 80) {
        return { code: '23514', message: 'violates check constraint "circle_challenge_logs_note_check"' };
      }
    }
    if (this.table === 'challenge_participants') {
      if (row.goal_completion_pct != null && !(row.goal_completion_pct >= 0 && row.goal_completion_pct < 1000)) {
        return { code: '22003', message: 'numeric field overflow' };
      }
    }
    if (this.table === 'challenges') {
      const categories = ['strength', 'cardio', 'flexibility', 'wellness', 'custom'];
      if (row.category != null && !categories.includes(row.category)) {
        return { code: '23514', message: 'violates check constraint "circle_challenges_category_check"' };
      }
    }
    return null;
  }
}

let current = new ChallengeFakeDb();
export function setChallengeDb(db: ChallengeFakeDb) { current = db; }
export function getChallengeDb(): ChallengeFakeDb { return current; }
