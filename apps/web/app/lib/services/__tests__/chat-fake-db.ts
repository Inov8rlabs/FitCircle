/**
 * In-memory stand-in for the service-role Supabase client, covering the query
 * shapes the chat inbox / cheers / push code uses: select (+count/head), insert,
 * update, eq / neq / in / gt / gte / lt / lte / is / not(is|in) / or(...),
 * JSON paths (`data->>circleId`, `system_payload->cheer->>to_user_id`),
 * order / limit / maybeSingle / single. Tables are plain arrays on `tables`.
 */

type Row = Record<string, any>;

/** Read `col`, following PostgREST JSON paths (`a->b->>c`). */
export function colValue(row: Row, col: string): any {
  const parts = col.split(/->>?/);
  let v: any = row[parts[0]];
  for (const key of parts.slice(1)) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = v[key];
  }
  if (col.includes('->>') && v !== undefined && v !== null && typeof v !== 'string') return String(v);
  return v;
}

const parseList = (raw: string) => raw.replace(/^\(|\)$/g, '').split(',').filter(Boolean);

/** One `or()` clause: `col.op.value` (eq, in, is, not.in). */
function orClause(clause: string): (r: Row) => boolean {
  const m = clause.match(/^([^.]+)\.(not\.in|in|eq|is)\.(.*)$/);
  if (!m) throw new Error(`ChatFakeDb: unsupported or() clause ${clause}`);
  const [, col, op, raw] = m;
  if (op === 'eq') return (r) => colValue(r, col) === raw;
  if (op === 'is') return (r) => (colValue(r, col) ?? null) === (raw === 'null' ? null : raw);
  const vals = parseList(raw);
  if (op === 'in') return (r) => vals.includes(colValue(r, col));
  return (r) => {
    const v = colValue(r, col);
    return v !== null && v !== undefined && !vals.includes(v); // SQL: NULL NOT IN (…) is not true
  };
}

/** Split `a.in.(x,y),b.eq.z` on the commas that are outside parentheses. */
function splitOr(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export class ChatFakeDb {
  tables: Record<string, Row[]> = {};
  seq = 0;
  /** Every query run, for "no N+1" assertions: [table, op]. */
  log: Array<[string, string]> = [];

  client() {
    return { from: (table: string) => new ChatFakeQuery(this, table) };
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }
}

class ChatFakeQuery implements PromiseLike<any> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: Row | Row[] | null = null;
  private countMode = false;
  private head = false;
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private singleMode: 'maybe' | 'single' | null = null;
  private conflict: string[] = [];

  constructor(
    private db: ChatFakeDb,
    private table: string
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = row;
    this.conflict = (opts?.onConflict ?? 'id').split(',');
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: any) { this.filters.push((r) => colValue(r, col) === val); return this; }
  neq(col: string, val: any) { this.filters.push((r) => colValue(r, col) !== val); return this; }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(colValue(r, col))); return this; }
  gt(col: string, val: any) { this.filters.push((r) => colValue(r, col) > val); return this; }
  gte(col: string, val: any) { this.filters.push((r) => colValue(r, col) >= val); return this; }
  lt(col: string, val: any) { this.filters.push((r) => colValue(r, col) < val); return this; }
  lte(col: string, val: any) { this.filters.push((r) => colValue(r, col) <= val); return this; }
  is(col: string, val: any) { this.filters.push((r) => (colValue(r, col) ?? null) === val); return this; }
  not(col: string, op: string, val: any) {
    if (op === 'is') this.filters.push((r) => (colValue(r, col) ?? null) !== val);
    else if (op === 'in') {
      const vals = parseList(String(val));
      this.filters.push((r) => { const v = colValue(r, col); return v !== null && v !== undefined && !vals.includes(v); });
    } else this.filters.push((r) => colValue(r, col) !== val);
    return this;
  }
  or(expr: string) {
    const clauses = splitOr(expr).map(orClause);
    this.filters.push((r) => clauses.some((c) => c(r)));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range() { return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  single() { this.singleMode = 'single'; return this; }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, ko);
  }

  private run(): { data: any; count?: number; error: any } {
    this.db.log.push([this.table, this.op]);
    const rows = this.db.rows(this.table);
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const now = new Date().toISOString();
      const out: Row[] = [];
      for (const r of list) {
        if (this.op === 'upsert') {
          const hit = rows.find((x) => this.conflict.every((k) => x[k] === r[k]));
          if (hit) {
            Object.assign(hit, r);
            out.push(hit);
            continue;
          }
        }
        const row = { id: `row-${++this.db.seq}`, created_at: now, sent_at: now, ...r };
        rows.push(row);
        out.push(row);
      }
      return this.finish(out);
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      return this.finish(matched);
    }
    if (this.op === 'delete') {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r));
      return { data: null, error: null };
    }
    let data = matched.map((r) => ({ ...r }));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      data.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) data = data.slice(0, this.limitN);
    if (this.countMode) return { data: this.head ? null : data, count: matched.length, error: null };
    return this.finish(data);
  }

  private finish(data: Row[]): { data: any; error: any } {
    if (this.singleMode === 'maybe') return { data: data[0] ?? null, error: null };
    if (this.singleMode === 'single') {
      return data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'not found', code: 'PGRST116' } };
    }
    return { data, error: null };
  }
}
