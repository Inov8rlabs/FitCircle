/**
 * Minimal in-memory Supabase fake for unit-testing service logic.
 *
 * Supports the query shapes the streak services use:
 *   from(t).select(...).eq(...).gte(...).lt(...).order(...).limit(...)
 *     .single() / .maybeSingle() / await (thenable → {data: rows})
 *   from(t).insert(row|rows) [.select().single()]
 *   from(t).update(patch).eq(...)... [.select(...)]
 *   from(t).upsert(row|rows, {onConflict}) — honours unique keys
 *
 * Unique constraints are declared per table so duplicate inserts produce
 * Postgres-style 23505 errors, which the services rely on.
 */

type Row = Record<string, any>;

interface TableDef {
  rows: Row[];
  /** columns forming the unique key (for insert conflict + upsert matching) */
  uniqueKey?: string[];
}

export class FakeSupabase {
  tables: Record<string, TableDef> = {};

  constructor(defs: Record<string, { rows?: Row[]; uniqueKey?: string[] }>) {
    for (const [name, def] of Object.entries(defs)) {
      this.tables[name] = { rows: [...(def.rows || [])], uniqueKey: def.uniqueKey };
    }
  }

  seed(table: string, rows: Row[]) {
    this.ensure(table).rows.push(...rows.map(r => ({ ...r })));
  }

  getRows(table: string): Row[] {
    return this.ensure(table).rows;
  }

  private ensure(table: string): TableDef {
    if (!this.tables[table]) this.tables[table] = { rows: [] };
    return this.tables[table];
  }

  from(table: string) {
    return new FakeQuery(this.ensure(table));
  }
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: Row | Row[] | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private returnRows = false;

  constructor(private table: TableDef) {}

  select(_cols?: string) {
    if (this.op === 'insert' || this.op === 'update' || this.op === 'upsert') {
      this.returnRows = true;
      return this;
    }
    this.op = 'select';
    return this;
  }

  insert(payload: Row | Row[]) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }

  upsert(payload: Row | Row[], _opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.payload = payload;
    (this as any).upsertOpts = _opts;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push(r => r[column] === value);
    return this;
  }

  /** PostgREST `.is(col, null)` — the only form the services use. */
  is(column: string, value: any) {
    this.filters.push(r => (value === null ? r[column] == null : r[column] === value));
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push(r => r[column] !== value);
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push(r => r[column] > value);
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push(r => r[column] >= value);
    return this;
  }

  lt(column: string, value: any) {
    this.filters.push(r => r[column] < value);
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push(r => r[column] <= value);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private matching(): Row[] {
    let rows = this.table.rows.filter(r => this.filters.every(f => f(r)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) =>
        a[column] < b[column] ? (ascending ? -1 : 1) : a[column] > b[column] ? (ascending ? 1 : -1) : 0
      );
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private violatesUnique(row: Row, ignoreRow?: Row): boolean {
    const key = this.table.uniqueKey;
    if (!key) return false;
    return this.table.rows.some(
      existing => existing !== ignoreRow && key.every(k => existing[k] === row[k])
    );
  }

  private findByUnique(row: Row): Row | undefined {
    const key = this.table.uniqueKey;
    if (!key) return undefined;
    return this.table.rows.find(existing => key.every(k => existing[k] === row[k]));
  }

  private execute(): { data: any; error: any } {
    switch (this.op) {
      case 'select':
        return { data: this.matching(), error: null };

      case 'insert': {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
        for (const row of rows) {
          if (this.violatesUnique(row)) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            };
          }
        }
        const inserted = rows.map(r => ({ id: `id-${Math.random().toString(36).slice(2)}`, ...r }));
        this.table.rows.push(...inserted);
        return { data: inserted, error: null };
      }

      case 'update': {
        const rows = this.matching();
        for (const row of rows) Object.assign(row, this.payload);
        return { data: rows, error: null };
      }

      case 'upsert': {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const opts = (this as any).upsertOpts as { ignoreDuplicates?: boolean } | undefined;
        const result: Row[] = [];
        for (const row of rows) {
          const existing = this.findByUnique(row);
          if (existing) {
            if (!opts?.ignoreDuplicates) Object.assign(existing, row);
            result.push(existing);
          } else {
            const inserted = { id: `id-${Math.random().toString(36).slice(2)}`, ...row };
            this.table.rows.push(inserted);
            result.push(inserted);
          }
        }
        return { data: result, error: null };
      }
    }
  }

  single(): Promise<{ data: any; error: any }> {
    const { data, error } = this.execute();
    if (error) return Promise.resolve({ data: null, error });
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) {
      return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    }
    return Promise.resolve({ data: rows[0], error: null });
  }

  maybeSingle(): Promise<{ data: any; error: any }> {
    const { data, error } = this.execute();
    if (error) return Promise.resolve({ data: null, error });
    const rows = Array.isArray(data) ? data : [data];
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  // Thenable: `await query` resolves with {data, error}. Mutations return
  // affected rows in data only when .select() was chained (like Supabase).
  then<T>(resolve: (value: { data: any; error: any }) => T, reject?: (e: any) => T): Promise<T> {
    const { data, error } = this.execute();
    const value =
      this.op === 'select' || this.returnRows ? { data, error } : { data: null, error };
    return Promise.resolve(value).then(resolve, reject);
  }
}

/** Table definitions matching the streak schema's unique constraints. */
export function makeStreakDb(): FakeSupabase {
  return new FakeSupabase({
    profiles: { uniqueKey: ['id'] },
    streak_claims: { uniqueKey: ['user_id', 'claim_date'] },
    streak_shields: { uniqueKey: ['user_id', 'shield_type'] },
    streak_recoveries: { uniqueKey: ['user_id', 'broken_date'] },
    engagement_streaks: { uniqueKey: ['user_id'] },
    engagement_activities: { uniqueKey: ['user_id', 'activity_date', 'activity_type', 'reference_id'] },
    daily_tracking: { uniqueKey: ['user_id', 'tracking_date'] },
    daily_goals: {},
  });
}
