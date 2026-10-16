/**
 * In-memory service-role Supabase stand-in for the referral services: generic
 * tables, the filter/order/limit/count shapes those services use, insert/update
 * with `.select()` returning rows, and the UNIQUE indexes from migration 100
 * (so idempotency and race paths behave like Postgres: error code 23505).
 */

type Row = Record<string, any>;

interface UniqueIndex {
  cols: string[];
  where?: (row: Row) => boolean;
}

const UNIQUE: Record<string, UniqueIndex[]> = {
  referral_codes: [{ cols: ['user_id'] }, { cols: ['code'] }],
  referrals: [{ cols: ['invitee_id'] }],
  referral_rewards: [
    { cols: ['referral_id', 'kind'], where: (r) => r.referral_id != null },
    { cols: ['user_id'], where: (r) => r.kind === 'lifetime' },
  ],
  referral_devices: [{ cols: ['device_hash', 'user_id'] }],
  referral_invites: [{ cols: ['inviter_id', 'contact_hash'] }],
  referral_email_optouts: [{ cols: ['email_hash'] }],
  profiles: [{ cols: ['id'] }],
  campaigns: [{ cols: ['slug'] }],
  campaign_participants: [{ cols: ['campaign_id', 'user_id'] }],
  campaign_deliveries: [{ cols: ['campaign_id', 'user_id', 'delivery_key'] }],
};

let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export class ReferralFakeDb {
  tables: Record<string, Row[]> = {
    profiles: [],
    referral_codes: [],
    referrals: [],
    referral_rewards: [],
    referral_devices: [],
    complimentary_grants: [],
    fitcircles: [],
    fitcircle_members: [],
    streak_claims: [],
    feature_flags: [],
  };
  /** Every update applied, for assertions on profile pinning etc. */
  log: Array<{ table: string; op: string; payload: any }> = [];

  /** Uploaded storage objects, keyed `${bucket}/${path}`. */
  storage: Record<string, { bytes: unknown; opts: unknown }> = {};

  client() {
    return {
      from: (table: string) => new Query(this, table),
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, bytes: unknown, opts: unknown) => {
            this.storage[`${bucket}/${path}`] = { bytes, opts };
            return { data: { path }, error: null };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        }),
      },
    };
  }

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  profile(id: string): Row | undefined {
    return this.rows('profiles').find((p) => p.id === id);
  }

  addProfile(p: Partial<Row> & { id: string }): Row {
    const row = {
      display_name: null,
      username: null,
      avatar_url: null,
      email: `${p.id}@example.com`,
      onboarding_completed: true,
      created_at: new Date().toISOString(),
      subscription_tier: 'free',
      subscription_platform: null,
      subscription_product_id: null,
      subscription_expires_at: null,
      subscription_status: null,
      ...p,
    };
    this.rows('profiles').push(row);
    return row;
  }

  violates(table: string, candidate: Row, ignore?: Row): boolean {
    for (const idx of UNIQUE[table] ?? []) {
      if (idx.where && !idx.where(candidate)) continue;
      const clash = this.rows(table).some(
        (r) => r !== ignore && (!idx.where || idx.where(r)) && idx.cols.every((c) => r[c] === candidate[c])
      );
      if (clash) return true;
    }
    return false;
  }
}

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private conflictCols: string[] = [];
  private filters: Filter[] = [];
  private payload: any = null;
  private returning = false;
  private countMode = false;
  private headMode = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private offset = 0;

  constructor(
    private db: ReferralFakeDb,
    private table: string
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      if (opts?.count) this.countMode = true;
      if (opts?.head) this.headMode = true;
    } else {
      this.returning = true;
    }
    return this;
  }
  insert(row: Row | Row[]) { this.op = 'insert'; this.payload = row; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = row;
    this.conflictCols = (opts?.onConflict ?? 'id').split(',').map((c) => c.trim());
    return this;
  }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, val: any) { this.filters.push((r) => (r[col] ?? null) === (val ?? null)); return this; }
  is(col: string, val: any) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  neq(col: string, val: any) { this.filters.push((r) => r[col] !== val); return this; }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  gt(col: string, val: any) { this.filters.push((r) => r[col] != null && r[col] > val); return this; }
  gte(col: string, val: any) { this.filters.push((r) => r[col] != null && r[col] >= val); return this; }
  lt(col: string, val: any) { this.filters.push((r) => r[col] != null && r[col] < val); return this; }
  lte(col: string, val: any) { this.filters.push((r) => r[col] != null && r[col] <= val); return this; }
  not(col: string, op: string, val: any) {
    // JSON paths ('metadata->lobby') resolve through nested objects.
    const at = (r: Row) => col.split(/->>?/).reduce<any>((v, k) => (v == null ? v : v[k]), r);
    if (op === 'is') this.filters.push((r) => (at(r) ?? null) !== val);
    else this.filters.push((r) => r[col] !== val);
    return this;
  }
  ilike(col: string, val: string) {
    this.filters.push((r) => String(r[col] ?? '').toLowerCase() === String(val).toLowerCase());
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.max = n; return this; }
  range(from: number, to: number) { this.offset = from; this.max = to - from + 1; return this; }

  async maybeSingle() {
    const res = this.run();
    if (res.error) return res;
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const res = this.run();
    if (res.error) return res;
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    return rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  }

  then<T1 = any, T2 = never>(
    ok?: ((v: any) => T1 | PromiseLike<T1>) | null,
    err?: ((e: any) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return Promise.resolve(this.run()).then(ok, err);
  }

  private matched(): Row[] {
    let rows = this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)));
    }
    if (this.offset || this.max != null) rows = rows.slice(this.offset, this.max != null ? this.offset + this.max : undefined);
    return rows;
  }

  private run(): any {
    switch (this.op) {
      case 'select': {
        const rows = this.matched();
        if (this.countMode) return { count: rows.length, data: this.headMode ? null : rows, error: null };
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      case 'insert': {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => ({
          id: nextId(),
          created_at: new Date().toISOString(),
          ...(this.table === 'complimentary_grants' ? { revoked_at: null } : {}),
          ...(this.table === 'referral_rewards' ? { applied_at: null, seen_at: null, notified_at: null, emailed_at: null } : {}),
          ...(this.table === 'referral_invites'
            ? { status: 'invited', referral_id: null, nudge_count: 0, last_nudged_at: null, sent_at: new Date().toISOString(), joined_at: null }
            : {}),
          ...(this.table === 'referrals'
            ? { attributed_at: new Date().toISOString(), qualified_at: null, status: 'pending', status_reason: null, nudge_count: 0, last_nudged_at: null, inviter_notified_at: null, progress_days: 0, progress_notified_days: 0 }
            : {}),
          ...r,
        }));
        for (const row of list) {
          if (this.db.violates(this.table, row)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
        }
        this.db.rows(this.table).push(...list);
        this.db.log.push({ table: this.table, op: 'insert', payload: list });
        const out = list.map((r: Row) => ({ ...r }));
        return { data: this.returning ? (Array.isArray(this.payload) ? out : out[0]) : null, error: null };
      }
      case 'upsert': {
        const row = this.payload as Row;
        const all = this.db.rows(this.table);
        const hit = all.find((r) => this.conflictCols.every((c) => r[c] === row[c]));
        if (hit) Object.assign(hit, row);
        else all.push({ updated_at: new Date().toISOString(), ...row });
        const out = { ...(hit ?? all[all.length - 1]) };
        return { data: this.returning ? [out] : null, error: null };
      }
      case 'update': {
        const rows = this.matched();
        for (const row of rows) Object.assign(row, this.payload);
        this.db.log.push({ table: this.table, op: 'update', payload: { patch: this.payload, count: rows.length } });
        return { data: this.returning ? rows.map((r) => ({ ...r })) : null, error: null };
      }
      case 'delete': {
        const rows = this.matched();
        const all = this.db.rows(this.table);
        for (const row of rows) all.splice(all.indexOf(row), 1);
        return { data: null, error: null };
      }
    }
  }
}

let current = new ReferralFakeDb();
export function setReferralDb(db: ReferralFakeDb) { current = db; }
export function getReferralDb(): ReferralFakeDb { return current; }
