/**
 * ProLifecycleService — the I/O side of the "Pro is ending / Pro ended"
 * prompts (docs/PRO_LIFECYCLE_PROMPTS.md): the published config (one
 * feature_flags row, cached per instance), per-user facts (grants, purchase
 * history, real usage), the home-feed input, and the read-only audience
 * listing for Admin Tools.
 *
 * No migration: config in feature_flags ('pro_lifecycle_prompts'), audit in
 * experiment_audit_log (key 'config:pro_lifecycle_prompts'), dismissals in
 * promo_user_state (migration 110), sends in notification_log.
 */
import { swrCache } from '@/lib/home-feed/cache';
import {
  CONFIG_FLAG_NAME,
  DEFAULT_CONFIG,
  PRO_LIFECYCLE_PUSH_TYPES,
  PRO_LIFECYCLE_STATES,
  computeLifecycleState,
  configVersion,
  expiringPushAt,
  lifecyclePushDedupeKey,
  localTimeLabel,
  parseConfig,
  promptsEnabled,
  purchaseHistory,
  type GrantRow,
  type LifecycleFacts,
  type LifecycleFeedInput,
  type LifecycleProfile,
  type LifecycleResult,
  type ProLifecycleConfig,
  type ProLifecycleState,
  type ProUsage,
} from '@/lib/pro-lifecycle';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

export const PROFILE_COLUMNS =
  'id, email, is_admin, display_name, timezone, subscription_tier, subscription_status, subscription_platform, subscription_product_id, subscription_expires_at, subscription_will_renew, trial_started_at, trial_ends_at, trial_converted_at';
/** Same columns without the trial_* ones (migration 112 not applied in some environment). */
const PROFILE_COLUMNS_PRE112 =
  'id, email, is_admin, display_name, timezone, subscription_tier, subscription_status, subscription_platform, subscription_product_id, subscription_expires_at, subscription_will_renew';

export const DEFAULT_TIMEZONE = 'America/New_York';

export interface PublishedConfig {
  /** Admin master switch (feature_flags.is_enabled); a missing row = on. */
  enabled: boolean;
  config: ProLifecycleConfig;
  source: 'database' | 'defaults';
  /** feature_flags.updated_at (compare-and-set token) or null without a row. */
  updatedAt: string | null;
  /** A row exists but its metadata didn't validate (defaults served). */
  invalidStored: boolean;
  version: string;
}

/** Read the flag row. Never throws: errors → defaults (logged). */
export async function readPublishedConfig(): Promise<PublishedConfig> {
  const fallback = (invalidStored = false): PublishedConfig => ({ enabled: true, config: DEFAULT_CONFIG, source: 'defaults', updatedAt: null, invalidStored, version: configVersion(true, DEFAULT_CONFIG) });
  try {
    const { data, error } = await createAdminSupabase().from('feature_flags').select('name, is_enabled, metadata, updated_at').eq('name', CONFIG_FLAG_NAME).maybeSingle();
    if (error) throw error;
    if (!data) return fallback();
    const row = data as { is_enabled: boolean | null; metadata: unknown; updated_at: string | null };
    const parsed = parseConfig(row.metadata);
    if (!parsed) {
      console.warn('[pro-lifecycle] stored config is invalid; serving defaults');
      return { ...fallback(true), enabled: row.is_enabled !== false, updatedAt: row.updated_at ?? null, version: configVersion(row.is_enabled !== false, DEFAULT_CONFIG) };
    }
    const enabled = row.is_enabled !== false;
    return { enabled, config: parsed, source: 'database', updatedAt: row.updated_at ?? null, invalidStored: false, version: configVersion(enabled, parsed) };
  } catch (err: any) {
    console.warn('[pro-lifecycle] config read failed; serving defaults:', err?.message ?? err);
    return fallback();
  }
}

/** Per-instance cache (fresh 30 s, stale ≤ 10 min) — the feed reads it on every request. */
export const lifecycleConfigCache = swrCache<PublishedConfig>(readPublishedConfig, { ttlMs: 30_000, maxStaleMs: 600_000, label: 'pro lifecycle config' });

/** Env kill switch AND admin master switch. */
export const lifecycleLive = (pub: Pick<PublishedConfig, 'enabled'>, env: Record<string, string | undefined> = process.env) => promptsEnabled(env) && pub.enabled;

export function timezoneOf(profile: Pick<LifecycleProfile, 'timezone'>, fallback = DEFAULT_TIMEZONE): string {
  return isValidTimezone(profile.timezone) ? profile.timezone : fallback;
}

export function firstNameOf(profile: Pick<LifecycleProfile, 'display_name'> & Record<string, unknown>): string | null {
  for (const k of ['display_name', 'full_name', 'name']) {
    const v = profile[k];
    if (typeof v === 'string' && v.trim()) return v.trim().split(/\s+/)[0].slice(0, 30);
  }
  return null;
}

type EventRow = { user_id: string; type: string | null; environment: string | null; raw: unknown };

/** Facts for many users in 2 reads (grants + events). Profiles are passed in. */
export async function loadFactsFor(profiles: LifecycleProfile[]): Promise<Map<string, LifecycleFacts>> {
  const ids = profiles.map((p) => p.id);
  const out = new Map<string, LifecycleFacts>();
  if (ids.length === 0) return out;
  const supabase = createAdminSupabase();
  const [grants, events] = await Promise.all([
    supabase.from('complimentary_grants').select('id, user_id, granted_by, expires_at, revoked_at, created_at').in('user_id', ids).limit(5000),
    supabase.from('subscription_events').select('user_id, type, environment, raw').in('user_id', ids).limit(5000),
  ]);
  if (grants.error) throw new Error(`grants read failed: ${grants.error.message}`);
  if (events.error) throw new Error(`subscription events read failed: ${events.error.message}`);
  for (const p of profiles) {
    const g = ((grants.data ?? []) as Array<GrantRow & { user_id: string }>).filter((r) => r.user_id === p.id);
    const e = ((events.data ?? []) as EventRow[]).filter((r) => r.user_id === p.id);
    out.set(p.id, { profile: p, grants: g, ...purchaseHistory(e, p) });
  }
  return out;
}

/** Real usage between `since` and `until` (ISO). Three indexed reads. */
export async function loadUsage(userId: string, since: string, until: string): Promise<ProUsage> {
  const supabase = createAdminSupabase();
  const [meals, chats, plans] = await Promise.all([
    supabase
      .from('food_log_entries')
      .select('nutrition_source')
      .eq('user_id', userId)
      .eq('entry_type', 'food')
      .is('deleted_at', null)
      .gte('created_at', since)
      .lte('created_at', until)
      .limit(1000),
    supabase.from('fitzy_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'user').gte('created_at', since).lte('created_at', until),
    supabase.from('fitzy_plans').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_preview', false).gte('created_at', since).lte('created_at', until),
  ]);
  if (meals.error) throw new Error(`usage meals read failed: ${meals.error.message}`);
  const rows = (meals.data ?? []) as Array<{ nutrition_source: string | null }>;
  return {
    meals: rows.length,
    aiMeals: rows.filter((r) => typeof r.nutrition_source === 'string' && r.nutrition_source.startsWith('llm_')).length,
    // Fitzy tables may be missing in an old environment: unknown → 0 (never invented).
    fitzyChats: chats.error ? 0 : (chats.count ?? 0),
    plans: plans.error ? 0 : (plans.count ?? 0),
  };
}

/** Usage window for a result: [start, min(end, now)]. Null without a start. */
export function usageWindow(r: LifecycleResult, now: Date): { since: string; until: string } | null {
  if (!r.startedAt || !r.endsAt) return null;
  const until = Math.min(Date.parse(r.endsAt), now.getTime());
  return { since: r.startedAt, until: new Date(until).toISOString() };
}

export class ProLifecycleService {
  static clearCache(): void {
    lifecycleConfigCache.clear();
  }

  /**
   * Home feed: the lifecycle input for this viewer, or null (unknown). The
   * profile comes from auth (`profiles.*`). Two reads (grants + purchase
   * history), plus three usage counts only when the user is in a state.
   */
  static async feedInput(profile: Record<string, any> & { id: string }, timezone: string, now: Date, config: ProLifecycleConfig): Promise<LifecycleFeedInput> {
    const facts = (await loadFactsFor([profile as LifecycleProfile])).get(profile.id)!;
    const result = computeLifecycleState(facts, now, config);
    let usage: ProUsage | null = null;
    const win = result.state ? usageWindow(result, now) : null;
    if (win) {
      try {
        usage = await loadUsage(profile.id, win.since, win.until);
      } catch (err: any) {
        console.warn('[pro-lifecycle] usage read failed; value-prop copy:', err?.message ?? err);
      }
    }
    return { result, usage, firstName: firstNameOf(profile), timezone };
  }

  /** Profiles by id (with the pre-112 column fallback). */
  static async profiles(ids: string[]): Promise<LifecycleProfile[]> {
    if (ids.length === 0) return [];
    const supabase = createAdminSupabase();
    const full = await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', ids);
    if (!full.error) return (full.data ?? []) as LifecycleProfile[];
    const lite = await supabase.from('profiles').select(PROFILE_COLUMNS_PRE112).in('id', ids);
    if (lite.error) throw new Error(`profiles read failed: ${lite.error.message}`);
    return (lite.data ?? []) as LifecycleProfile[];
  }

  /**
   * Users who may be in a state right now: grants ending soon or ended
   * recently (any non-revoked grant in the window), plus store trials with
   * renewal off. Bounded by the widest configured windows.
   */
  static async candidateIds(now: Date, config: ProLifecycleConfig): Promise<string[]> {
    const supabase = createAdminSupabase();
    const maxBefore = Math.max(config.states.pro_expiring.hoursBefore, config.states.trial_expiring.hoursBefore) * 3_600_000;
    const maxAfter = config.states.pro_expired.daysAfter * 86_400_000;
    const [grants, trials] = await Promise.all([
      supabase
        .from('complimentary_grants')
        .select('user_id')
        .is('revoked_at', null)
        .gte('expires_at', new Date(now.getTime() - maxAfter).toISOString())
        .lte('expires_at', new Date(now.getTime() + maxBefore).toISOString())
        .limit(2000),
      supabase
        .from('profiles')
        .select('id')
        .eq('subscription_status', 'trialing')
        .eq('subscription_will_renew', false)
        .gt('trial_ends_at', now.toISOString())
        .lte('trial_ends_at', new Date(now.getTime() + config.states.trial_expiring.hoursBefore * 3_600_000).toISOString())
        .limit(1000),
    ]);
    if (grants.error) throw new Error(`candidate grants read failed: ${grants.error.message}`);
    // trial_* columns may be missing (pre-112): no trial candidates then.
    const trialIds = trials.error ? [] : ((trials.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    return [...new Set([...((grants.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id), ...trialIds])];
  }

  /** Candidates → their facts + computed state (one batch). */
  static async evaluateAll(now: Date, config: ProLifecycleConfig, opts: { userId?: string } = {}): Promise<Array<{ facts: LifecycleFacts; result: LifecycleResult }>> {
    const ids = opts.userId ? [opts.userId] : await this.candidateIds(now, config);
    const profiles = await this.profiles(ids);
    const facts = await loadFactsFor(profiles);
    return profiles.map((p) => {
      const f = facts.get(p.id)!;
      return { facts: f, result: computeLifecycleState(f, now, config) };
    });
  }

  /**
   * GET /api/admin/home-feed/pro-lifecycle/audience — who is in each state
   * right now (read-only): name, end, platform, time zone, real usage and the
   * push status (sent / scheduled / off).
   */
  static async audience(now = new Date()) {
    const pub = await readPublishedConfig();
    const evaluated = await this.evaluateAll(now, pub.config);
    const inState = evaluated.filter((e) => e.result.state !== null);
    const ids = inState.map((e) => e.facts.profile.id);
    const supabase = createAdminSupabase();
    const [tokens, sent] = await Promise.all([
      ids.length ? supabase.from('push_tokens').select('user_id, platform, is_active, last_used_at').in('user_id', ids).limit(2000) : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase.from('notification_log').select('user_id, notification_type, data, sent_at, suppressed').in('user_id', ids).in('notification_type', Object.values(PRO_LIFECYCLE_PUSH_TYPES)).limit(2000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const tokenRows = ((tokens.data ?? []) as Array<{ user_id: string; platform: string; is_active: boolean; last_used_at: string | null }>).filter((t) => t.is_active !== false);
    const logRows = (sent.data ?? []) as Array<{ user_id: string; notification_type: string; data: Record<string, unknown> | null; sent_at: string; suppressed: boolean }>;

    const users = await Promise.all(
      inState.map(async ({ facts, result }) => {
        const p = facts.profile;
        const state = result.state as ProLifecycleState;
        const tz = timezoneOf(p);
        const platforms = [...new Set(tokenRows.filter((t) => t.user_id === p.id).sort((a, b) => String(b.last_used_at ?? '').localeCompare(String(a.last_used_at ?? ''))).map((t) => t.platform))];
        let usage: ProUsage | null = null;
        const win = usageWindow(result, now);
        if (win) usage = await loadUsage(p.id, win.since, win.until).catch(() => null);
        const sc = pub.config.states[state];
        let push: { type: string | null; status: 'sent' | 'scheduled' | 'due' | 'off' | 'none' | 'missed'; at: string | null; localTime: string | null } = { type: null, status: 'none', at: null, localTime: null };
        if (state !== 'trial_expiring') {
          const type = PRO_LIFECYCLE_PUSH_TYPES[state];
          const key = lifecyclePushDedupeKey(type, p.id, result.endsAt!);
          const delivered = logRows.find((r) => r.user_id === p.id && r.notification_type === type && !r.suppressed && r.data?.dedupeKey === key);
          if (delivered) push = { type, status: 'sent', at: delivered.sent_at, localTime: localTimeLabel(new Date(delivered.sent_at), tz) };
          else if (!lifecycleLive(pub) || !sc.enabled || !sc.push.enabled) push = { type, status: 'off', at: null, localTime: null };
          else if (state === 'pro_expiring') {
            const at = expiringPushAt(new Date(result.endsAt!), tz);
            const due = at.getTime() <= now.getTime();
            push = { type, status: due ? 'due' : 'scheduled', at: (due ? now : at).toISOString(), localTime: localTimeLabel(due ? now : at, tz) };
          } else {
            const lag = now.getTime() - Date.parse(result.endsAt!);
            push = lag > 36 * 3_600_000 ? { type, status: 'missed', at: null, localTime: null } : { type, status: 'due', at: now.toISOString(), localTime: localTimeLabel(now, tz) };
          }
        }
        return {
          userId: p.id,
          displayName: (p.display_name ?? '').trim() || 'Unnamed',
          state,
          source: result.source,
          endsAt: result.endsAt,
          endsAtLocal: result.endsAt ? localTimeLabel(new Date(result.endsAt), tz) : null,
          timezone: tz,
          platforms,
          trialAvailable: result.trialAvailable,
          periodDays: result.periodDays,
          usage,
          cardEnabled: lifecycleLive(pub) && sc.enabled,
          push,
        };
      })
    );
    users.sort((a, b) => String(a.endsAt).localeCompare(String(b.endsAt)));
    const states = Object.fromEntries(PRO_LIFECYCLE_STATES.map((s) => [s, { count: users.filter((u) => u.state === s).length, users: users.filter((u) => u.state === s) }])) as Record<
      ProLifecycleState,
      { count: number; users: typeof users }
    >;
    const skipped: Record<string, number> = {};
    for (const e of evaluated) if (!e.result.state && e.result.reason) skipped[e.result.reason] = (skipped[e.result.reason] ?? 0) + 1;
    return { generatedAt: now.toISOString(), candidates: evaluated.length, states, skipped };
  }
}
