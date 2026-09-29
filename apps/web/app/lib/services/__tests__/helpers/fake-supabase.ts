/**
 * Minimal in-memory stand-in for the Supabase query builder, for service tests.
 * Supports the subset the exercise / body-composition / tracking services use:
 * select / insert / update / upsert / delete, eq / in / gte / lte / lt filters,
 * order, limit, single / maybeSingle, and error injection per (table, operation).
 */

type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

export interface FakeDbError {
  code: string;
  message: string;
}

export interface FakeRule {
  table: string;
  op: Op;
  /** Return an error to fail this call; undefined lets it through. */
  fail: (payload: Row | Row[] | undefined) => FakeDbError | undefined;
}

export interface FakeCall {
  table: string;
  op: Op;
  payload?: Row | Row[];
}

let idCounter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

export function createFakeSupabase(
  initial: Record<string, Row[]> = {},
  options: { rules?: FakeRule[]; missingTables?: string[]; uniqueKeys?: Record<string, string[][]> } = {}
) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const calls: FakeCall[] = [];
  const rules = options.rules ?? [];
  const missing = new Set(options.missingTables ?? []);

  class Builder implements PromiseLike<{ data: any; error: FakeDbError | null }> {
    private op: Op = 'select';
    private payload: Row | Row[] | undefined;
    private filters: ((row: Row) => boolean)[] = [];
    private orders: { column: string; ascending: boolean }[] = [];
    private max: number | undefined;
    private mode: 'many' | 'single' | 'maybeSingle' = 'many';
    private conflict: string[] | undefined;

    constructor(private table: string) {}

    select(_columns?: string) {
      return this;
    }
    insert(payload: Row | Row[]) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }
    update(payload: Row) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }
    upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
      this.op = 'upsert';
      this.payload = payload;
      this.conflict = opts?.onConflict?.split(',').map((c) => c.trim());
      return this;
    }
    delete() {
      this.op = 'delete';
      return this;
    }
    eq(column: string, value: any) {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    in(column: string, values: any[]) {
      this.filters.push((r) => values.includes(r[column]));
      return this;
    }
    gte(column: string, value: any) {
      this.filters.push((r) => r[column] != null && cmp(r[column], value) >= 0);
      return this;
    }
    lte(column: string, value: any) {
      this.filters.push((r) => r[column] != null && cmp(r[column], value) <= 0);
      return this;
    }
    lt(column: string, value: any) {
      this.filters.push((r) => r[column] != null && cmp(r[column], value) < 0);
      return this;
    }
    order(column: string, opts?: { ascending?: boolean }) {
      this.orders.push({ column, ascending: opts?.ascending !== false });
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    single() {
      this.mode = 'single';
      return this;
    }
    maybeSingle() {
      this.mode = 'maybeSingle';
      return this;
    }

    then<A = { data: any; error: FakeDbError | null }, B = never>(
      onfulfilled?: ((value: { data: any; error: FakeDbError | null }) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: any) => B | PromiseLike<B>) | null
    ): PromiseLike<A | B> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }

    private run(): { data: any; error: FakeDbError | null } {
      calls.push({ table: this.table, op: this.op, payload: this.payload });

      if (missing.has(this.table)) {
        return {
          data: null,
          error: { code: 'PGRST205', message: `Could not find the table 'public.${this.table}' in the schema cache` },
        };
      }
      for (const rule of rules) {
        if (rule.table !== this.table || rule.op !== this.op) continue;
        const error = rule.fail(this.payload);
        if (error) return { data: null, error };
      }

      const rows = (tables[this.table] ??= []);
      let result: Row[] = [];

      if (this.op === 'select') {
        result = rows.filter((r) => this.filters.every((f) => f(r)));
      } else if (this.op === 'insert' || this.op === 'upsert') {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        for (const item of incoming) {
          const existing =
            this.op === 'upsert' && this.conflict
              ? rows.find((r) => this.conflict!.every((c) => sameValue(r[c], item[c])))
              : undefined;
          for (const key of options.uniqueKeys?.[this.table] ?? []) {
            const clash = rows.find(
              (r) => r !== existing && key.every((c) => r[c] != null && sameValue(r[c], item[c]))
            );
            if (clash) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
          }
          if (existing) {
            Object.assign(existing, item);
            result.push(existing);
          } else {
            const now = new Date().toISOString();
            const row = { id: nextId(), created_at: now, updated_at: now, ...item };
            rows.push(row);
            result.push(row);
          }
        }
      } else if (this.op === 'update') {
        result = rows.filter((r) => this.filters.every((f) => f(r)));
        for (const row of result) Object.assign(row, this.payload as Row);
      } else if (this.op === 'delete') {
        result = rows.filter((r) => this.filters.every((f) => f(r)));
        tables[this.table] = rows.filter((r) => !result.includes(r));
      }

      for (const { column, ascending } of [...this.orders].reverse()) {
        result = [...result].sort((a, b) => cmp(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (this.max !== undefined) result = result.slice(0, this.max);

      const copies = result.map((r) => ({ ...r }));
      if (this.mode === 'single') {
        if (copies.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        }
        return { data: copies[0], error: null };
      }
      if (this.mode === 'maybeSingle') return { data: copies[0] ?? null, error: null };
      return { data: copies, error: null };
    }
  }

  return {
    client: { from: (table: string) => new Builder(table) } as any,
    tables,
    calls,
    rows: (table: string) => tables[table] ?? [],
  };
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const asTime = (v: any): number => (typeof v === 'string' && ISO_TIMESTAMP.test(v) ? Date.parse(v) : NaN);

function cmp(a: any, b: any): number {
  const ta = asTime(a);
  const tb = asTime(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function sameValue(a: any, b: any): boolean {
  if (a === b) return true;
  const ta = asTime(a);
  const tb = asTime(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}
