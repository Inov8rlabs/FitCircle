/**
 * Read-only loaders for the finance reports (service role). Every loader of a table that may not
 * exist yet (migration 134: ai_cost_daily, ai_usage_events, ai_gateway_credits; 133: app_opens; 136: user_active_days)
 * returns empty + a note instead of failing the report.
 */
import { addDays } from '../../ads/dates';
import type { RevenueEvent } from '../../ads/metrics';
import { chunk, db, selectAll } from '../../ads/services/db';
import { classifyTestUser } from '../../ads/test-users';
import type { ActivityRow, FinanceUser, GatewayDailyRow, LedgerRow } from '../types';

export interface Loaded<T> {
  rows: T;
  note: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : num(v));

/** UTC instant bounds for whole days [start, end] in UTC. */
export const utcBounds = (start: string, end: string) => ({ from: `${start}T00:00:00.000Z`, to: `${addDays(end, 1)}T00:00:00.000Z` });
/** Instant bounds wide enough for any time zone (±14 h) around [start, end]. */
export const anyTzBounds = (start: string, end: string) => ({
  from: new Date(Date.parse(`${start}T00:00:00Z`) - 14 * 3600_000).toISOString(),
  to: new Date(Date.parse(`${addDays(end, 1)}T00:00:00Z`) + 14 * 3600_000).toISOString(),
});

function missing(table: string, e: any): string {
  return `${table} is not available (${String(e?.message ?? e).slice(0, 120)}); migration not applied yet? Treated as empty.`;
}

export class FinanceData {
  static async gatewayRows(start: string, end: string): Promise<Loaded<GatewayDailyRow[]>> {
    try {
      const rows = await selectAll<any>(() =>
        db()
          .from('ai_cost_daily')
          .select('day, dimension, key, total_cost, market_cost, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, request_count')
          .gte('day', start)
          .lte('day', end)
          .order('day', { ascending: true })
          .order('dimension', { ascending: true })
          .order('key', { ascending: true })
      );
      return {
        rows: rows.map((r) => ({
          day: String(r.day).slice(0, 10),
          dimension: r.dimension,
          key: r.key ?? '',
          totalCost: num(r.total_cost),
          marketCost: numOrNull(r.market_cost),
          inputTokens: num(r.input_tokens),
          outputTokens: num(r.output_tokens),
          cachedInputTokens: num(r.cached_input_tokens),
          reasoningTokens: num(r.reasoning_tokens),
          requestCount: num(r.request_count),
        })),
        note: null,
      };
    } catch (e) {
      return { rows: [], note: missing('ai_cost_daily', e) };
    }
  }

  static async ledger(start: string, end: string): Promise<Loaded<LedgerRow[]>> {
    const { from, to } = utcBounds(start, end);
    try {
      const rows = await selectAll<any>(() =>
        db()
          .from('ai_usage_events')
          .select('id, created_at, user_id, feature, model, environment, cost_usd, ok')
          .gte('created_at', from)
          .lt('created_at', to)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
      );
      return {
        rows: rows.map((r) => ({
          createdAt: new Date(r.created_at).toISOString(),
          userId: r.user_id ?? null,
          feature: r.feature,
          model: r.model,
          environment: r.environment,
          costUsd: numOrNull(r.cost_usd),
          ok: r.ok !== false,
        })),
        note: null,
      };
    } catch (e) {
      return { rows: [], note: missing('ai_usage_events', e) };
    }
  }

  /** First ledger day (UTC) and last sync / latest credits; nulls when the tables are missing. */
  static async meta(): Promise<{ ledgerSince: string | null; lastSyncAt: string | null; creditsBalance: number | null }> {
    const supabase = db();
    const [ledger, sync, credits] = await Promise.all([
      supabase.from('ai_usage_events').select('created_at').order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('ai_cost_daily').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('ai_gateway_credits').select('captured_at, balance').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      ledgerSince: !ledger.error && ledger.data?.created_at ? new Date(ledger.data.created_at).toISOString().slice(0, 10) : null,
      lastSyncAt: !sync.error && sync.data?.synced_at ? new Date(sync.data.synced_at).toISOString() : null,
      creditsBalance: !credits.error && credits.data ? num(credits.data.balance) : null,
    };
  }

  /** Activity signals in [from, to): Home feed loads, app opens and Amplitude user actions (user_active_days). */
  static async activity(from: string, to: string): Promise<Loaded<ActivityRow[]>> {
    const notes: string[] = [];
    const out: ActivityRow[] = [];
    try {
      const rows = await selectAll<{ id: string; user_id: string; platform: string | null; created_at: string }>(() =>
        db().from('home_feed_decisions').select('id, user_id, platform, created_at').gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true }).order('id', { ascending: true })
      );
      for (const r of rows) out.push({ userId: r.user_id, at: r.created_at, platform: normPlatform(r.platform) });
    } catch (e) {
      notes.push(missing('home_feed_decisions', e));
    }
    try {
      const rows = await selectAll<{ user_id: string; platform: string | null; first_open_at: string; local_date: string }>(() =>
        db()
          .from('app_opens')
          .select('user_id, platform, first_open_at, local_date')
          .gte('first_open_at', from)
          .lt('first_open_at', to)
          .order('first_open_at', { ascending: true })
          .order('user_id', { ascending: true })
          .order('platform', { ascending: true })
      );
      for (const r of rows) out.push({ userId: r.user_id, at: r.first_open_at, platform: normPlatform(r.platform) });
    } catch (e) {
      notes.push(missing('app_opens', e));
    }
    try {
      // Amplitude user actions (migration 136): first and last counted event of each local day.
      const rows = await selectAll<{ user_id: string; local_date: string; platform: string | null; first_at: string; last_at: string | null }>(() =>
        db()
          .from('user_active_days')
          .select('user_id, local_date, platform, first_at, last_at')
          .eq('source', 'amplitude')
          .gte('first_at', from)
          .lt('first_at', to)
          .order('first_at', { ascending: true })
          .order('user_id', { ascending: true })
          .order('local_date', { ascending: true })
          .order('platform', { ascending: true })
      );
      for (const r of rows) {
        const platform = normPlatform(r.platform);
        out.push({ userId: r.user_id, at: r.first_at, platform });
        if (r.last_at && r.last_at !== r.first_at && Date.parse(r.last_at) < Date.parse(to)) out.push({ userId: r.user_id, at: r.last_at, platform });
      }
    } catch (e) {
      notes.push(missing('user_active_days', e));
    }
    return { rows: out, note: notes.length ? notes.join(' ') : null };
  }

  /** Profiles (email, name, test verdict) for the given ids. */
  static async users(ids: string[]): Promise<Map<string, FinanceUser>> {
    const out = new Map<string, FinanceUser>();
    const uuids = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    for (const part of chunk(uuids, 150)) {
      const [profiles, attr] = await Promise.all([
        selectAll<{ id: string; created_at: string; email: string | null; display_name: string | null; is_admin: boolean | null }>(() =>
          db().from('profiles').select('id, created_at, email, display_name, is_admin').in('id', part).order('id', { ascending: true })
        ),
        selectAll<{ user_id: string; is_test: boolean | null }>(() => db().from('user_attribution').select('user_id, is_test').in('user_id', part).order('user_id', { ascending: true })),
      ]);
      const mock = new Set(attr.filter((a) => a.is_test === true).map((a) => a.user_id));
      for (const p of profiles) {
        out.set(p.id, {
          userId: p.id,
          email: p.email,
          displayName: p.display_name,
          createdAt: p.created_at,
          testReason: classifyTestUser({ email: p.email, isAdmin: p.is_admin, mockAttribution: mock.has(p.id) }),
        });
      }
    }
    return out;
  }

  /** Profiles created in [from, to) (sign-ups), with test verdicts. */
  static async signups(from: string, to: string): Promise<FinanceUser[]> {
    const rows = await selectAll<{ id: string }>(() => db().from('profiles').select('id').gte('created_at', from).lt('created_at', to).order('id', { ascending: true }));
    const users = await this.users(rows.map((r) => r.id));
    return [...users.values()];
  }

  /** Every PRODUCTION RevenueCat event (small table; segments need full history). */
  static async productionEvents(): Promise<RevenueEvent[]> {
    return selectAll<RevenueEvent>(() =>
      db().from('subscription_events').select('id, user_id, type, store, environment, event_timestamp, raw').eq('environment', 'PRODUCTION').order('id', { ascending: true })
    );
  }
}

function normPlatform(v: unknown): string | null {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('ios') || s.includes('iphone') || s.includes('ipad')) return 'ios';
  if (s.includes('android')) return 'android';
  if (s.includes('web')) return 'web';
  return 'unknown';
}
