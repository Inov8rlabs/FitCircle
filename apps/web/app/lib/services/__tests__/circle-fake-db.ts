/**
 * In-memory stand-in for the service-role Supabase client, for the circle tests.
 *
 * Unlike a bare chain mock it knows each table's COLUMNS, and answers a select,
 * filter, insert or update that names a column the table does not have with the
 * error PostgREST gives (42703). Two circle routes shipped selecting columns that
 * do not exist; a mock that accepts anything cannot catch that.
 */

import { randomUUID } from 'crypto';

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

/** Columns from supabase/migrations/000_baseline.sql (only the tables used here). */
export const CIRCLE_TABLE_COLUMNS: Record<string, string[]> = {
  fitcircles: [
    'id', 'creator_id', 'name', 'description', 'type', 'status', 'visibility', 'start_date',
    'end_date', 'participant_count', 'invite_code', 'privacy_mode', 'auto_accept_invites',
    'allow_late_join', 'late_join_deadline', 'is_official', 'created_at', 'updated_at',
  ],
  fitcircle_members: [
    'id', 'fitcircle_id', 'user_id', 'status', 'joined_at', 'dropped_at', 'current_value',
    'progress_percentage', 'check_ins_count', 'streak_days', 'goal_type', 'goal_start_value',
    'goal_target_value', 'goal_unit', 'goal_description', 'goal_locked_at', 'invited_by',
    'created_at', 'updated_at',
  ],
  circle_invites: [
    'id', 'circle_id', 'inviter_id', 'invite_code', 'email', 'status', 'created_at',
    'accepted_at', 'accepted_by', 'expires_at',
  ],
  profiles: ['id', 'display_name', 'avatar_url', 'preferences', 'goals'],
  circle_quests: [
    'id', 'fitcircle_id', 'challenge_id', 'template_id', 'quest_name', 'quest_description',
    'quest_type', 'goal_amount', 'unit', 'collective_target', 'collective_progress', 'starts_at',
    'ends_at', 'status', 'created_by', 'metadata', 'created_at',
  ],
  circle_quest_progress: [
    'id', 'quest_id', 'user_id', 'individual_progress', 'is_completed', 'completed_at', 'updated_at',
  ],
  share_cards: [
    'id', 'user_id', 'card_type', 'template_name', 'card_data', 'image_url', 'shared_count',
    'created_at', 'expires_at',
  ],
};

export class CircleFakeDb {
  tables: Record<string, Row[]> = {
    fitcircles: [],
    fitcircle_members: [],
    circle_invites: [],
    profiles: [],
    circle_quests: [],
    circle_quest_progress: [],
    share_cards: [],
  };

  /** Every statement that reached the database, for assertions. */
  log: Array<{ table: string; op: string; payload?: Row }> = [];

  client() {
    return { from: (table: string) => new FakeQuery(this, table) };
  }

  /** Ids are uuids, as in the real tables (the iOS models decode them as UUID). */
  newId(): string {
    return randomUUID();
  }

  columns(table: string): string[] {
    const columns = CIRCLE_TABLE_COLUMNS[table];
    if (!columns) throw new Error(`CircleFakeDb: unknown table ${table}`);
    return columns;
  }
}

function missingColumn(table: string, column: string) {
  return { code: '42703', message: `column ${table}.${column} does not exist` };
}

class FakeQuery implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private countMode = false;
  private headMode = false;
  private returning = false;
  private rowLimit: number | null = null;
  private error: { code: string; message: string } | null = null;

  constructor(
    private db: CircleFakeDb,
    private table: string
  ) {
    db.columns(table); // throws for an unknown table
  }

  private checkColumn(column: string) {
    if (!this.error && !this.db.columns(this.table).includes(column)) {
      this.error = missingColumn(this.table, column);
    }
  }

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true;
    if (options?.count) this.countMode = true;
    if (options?.head) this.headMode = true;
    // Plain lists only; embedded resources ("profiles!fk (...)") are not modelled.
    const plain = columns.replace(/\s+/g, '');
    if (plain !== '*' && /^[a-z0-9_,]+$/i.test(plain)) {
      plain.split(',').filter(Boolean).forEach((column) => this.checkColumn(column));
    }
    return this;
  }

  insert(row: Row | Row[]) {
    this.op = 'insert';
    this.payload = row;
    for (const item of Array.isArray(row) ? row : [row]) {
      Object.keys(item).forEach((column) => this.checkColumn(column));
    }
    return this;
  }

  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    Object.keys(patch).forEach((column) => this.checkColumn(column));
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  private where(column: string, test: (value: any) => boolean) {
    this.checkColumn(column);
    this.filters.push((row) => test(row[column]));
    return this;
  }

  eq(column: string, value: any) {
    return this.where(column, (v) => String(v).toLowerCase() === String(value).toLowerCase());
  }
  neq(column: string, value: any) {
    return this.where(column, (v) => v !== value);
  }
  in(column: string, values: any[]) {
    return this.where(column, (v) => values.includes(v));
  }
  gt(column: string, value: any) {
    return this.where(column, (v) => v > value);
  }
  gte(column: string, value: any) {
    return this.where(column, (v) => v >= value);
  }
  lte(column: string, value: any) {
    return this.where(column, (v) => v <= value);
  }
  order() {
    return this;
  }
  range() {
    return this;
  }
  limit(n: number) {
    this.rowLimit = n;
    return this;
  }

  async single() {
    const result = this.run();
    if (result.error) return { data: null, error: result.error };
    const rows = (result.data ?? []) as Row[];
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
  }

  async maybeSingle() {
    const result = this.run();
    if (result.error) return { data: null, error: result.error };
    const rows = (result.data ?? []) as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onFulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }

  private matching(): Row[] {
    const rows = this.db.tables[this.table].filter((row) => this.filters.every((f) => f(row)));
    return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
  }

  private run(): { data: any; error: any; count?: number | null } {
    if (this.error) return { data: null, error: this.error, count: null };

    switch (this.op) {
      case 'insert': {
        const items = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((row) => {
          const stored: Row = { id: this.db.newId(), ...row };
          // undefined values are not sent by the real client
          Object.keys(stored).forEach((key) => stored[key] === undefined && delete stored[key]);
          return stored;
        });
        this.db.tables[this.table].push(...items);
        items.forEach((payload) => this.db.log.push({ table: this.table, op: 'insert', payload }));
        return { data: this.returning ? items : null, error: null };
      }
      case 'update': {
        const rows = this.matching();
        rows.forEach((row) => Object.assign(row, this.payload));
        this.db.log.push({ table: this.table, op: 'update', payload: this.payload as Row });
        return { data: this.returning ? rows : null, error: null };
      }
      case 'delete': {
        const doomed = new Set(this.matching());
        this.db.tables[this.table] = this.db.tables[this.table].filter((row) => !doomed.has(row));
        this.db.log.push({ table: this.table, op: 'delete' });
        return { data: null, error: null };
      }
      case 'select': {
        const rows = this.matching();
        if (this.countMode) {
          return { data: this.headMode ? null : rows, count: rows.length, error: null };
        }
        return { data: rows, error: null };
      }
    }
  }
}

let current = new CircleFakeDb();

export function setCircleDb(db: CircleFakeDb) {
  current = db;
}

export function getCircleDb(): CircleFakeDb {
  return current;
}
