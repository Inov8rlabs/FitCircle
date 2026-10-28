/**
 * FeedContext builder (spec §5 context.ts): one round of parallel, fail-soft
 * lookups. Every loader has a timeout; a failure or timeout leaves its fields
 * `null` ("unknown") — the feed still renders, hints just don't fire.
 *
 * The profile comes from the auth middleware (`profiles.*`), so timezone,
 * created_at and subscription tier cost nothing extra.
 */
import type { CampaignRow } from '@/lib/campaigns/model';
import { CampaignService, featuredCampaign, viewerToday } from '@/lib/services/campaign-service';
import { normalizeTier } from '@/lib/services/entitlement-service';
import { FeatureFlagService } from '@/lib/services/feature-flag-service';
import { VitalsService } from '@/lib/services/vitals-service';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { swrCache } from './cache';
import type { AppPlatform, FeedContext } from './types';

/**
 * Context budget. The loaders run in one parallel round; anything slower than
 * this is treated as unknown (null) so the feed answers on time — the home
 * feed is the apps' first screen and must keep a tight P95.
 */
export const CONTEXT_LOADER_TIMEOUT_MS = 250;
/** Budget for the promo journey-facts / promo-state reads (they decide the time-of-day meal card). */
export const PROMO_LOADER_TIMEOUT_MS = 600;

/**
 * User-independent tables, cached per instance (fresh 30 s, served stale up
 * to 10 min while refreshing). Warm requests spend no round trips on them.
 */
export const activeCampaignsCache = swrCache<CampaignRow[]>(() => CampaignService.fetchActiveRows(), {
  ttlMs: 30_000,
  maxStaleMs: 600_000,
  label: 'campaigns',
});

const FEED_FLAGS = ['referrals', 'subscriptions'] as const;
type FlagRow = { name: string; is_enabled: boolean | null; allowed_user_ids: string[] | null; allowed_tiers: string[] | null; rollout_percentage: number | null };

export const feedFlagsCache = swrCache<Map<string, FlagRow>>(
  async () => {
    const { data, error } = await createAdminSupabase()
      .from('feature_flags')
      .select('name, is_enabled, allowed_user_ids, allowed_tiers, rollout_percentage')
      .in('name', [...FEED_FLAGS]);
    if (error) throw error;
    return new Map(((data ?? []) as FlagRow[]).map((r) => [r.name, r]));
  },
  { ttlMs: 30_000, maxStaleMs: 600_000, label: 'feature flags' }
);

/** Same decision FeatureFlagService.isFeatureEnabled makes, from the cached row + the auth profile. */
async function flagOn(name: (typeof FEED_FLAGS)[number], profile: FeedProfile): Promise<boolean> {
  const flags = await feedFlagsCache.get();
  const tier = 'subscription_tier' in profile ? ((profile.subscription_tier as string | null) ?? null) : undefined;
  return FeatureFlagService.evaluate(flags.get(name), profile.id, tier).enabled === true;
}

/** Local hour from which a not-yet-checked-in streak counts as "at risk". */
export const STREAK_AT_RISK_HOUR = 18;

export type FeedProfile = Record<string, any> & { id: string };

export interface FeedRequestInfo {
  platform: AppPlatform | null;
  appVersion: string | null;
  appBuild: number | null;
  /** x-client-timezone (already validated) or null. */
  clientTimezone: string | null;
}

export interface CampaignHint {
  present: boolean;
  slug: string | null;
  phase: string | null;
}

/** Injected I/O so the builder is unit-testable. */
export interface ContextLoaders {
  campaign(profile: FeedProfile, timezone: string): Promise<CampaignHint>;
  referralProgramEnabled(profile: FeedProfile): Promise<boolean>;
  subscriptionsEnabled(profile: FeedProfile): Promise<boolean>;
  activeCircleCount(userId: string): Promise<number>;
  checkedIn(userId: string, localDate: string): Promise<boolean>;
  waterTodayMl(userId: string, timezone: string, profile: FeedProfile): Promise<number>;
}

export const defaultContextLoaders: ContextLoaders = {
  async campaign(profile, timezone) {
    const rows = await activeCampaignsCache.get();
    const home = featuredCampaign(rows, profile.id, viewerToday(profile as any, timezone));
    return home ? { present: true, slug: home.slug, phase: home.phase } : { present: false, slug: null, phase: null };
  },
  // = ReferralService.isProgramEnabled: referrals AND subscriptions.
  async referralProgramEnabled(profile) {
    const [referrals, subscriptions] = await Promise.all([flagOn('referrals', profile), flagOn('subscriptions', profile)]);
    return referrals && subscriptions;
  },
  // = EntitlementService.areSubscriptionsEnabled.
  subscriptionsEnabled: (profile) => flagOn('subscriptions', profile),
  async activeCircleCount(userId) {
    const { count, error } = await createAdminSupabase()
      .from('fitcircle_members')
      .select('fitcircle_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    return count ?? 0;
  },
  async checkedIn(userId, localDate) {
    const { data, error } = await createAdminSupabase()
      .from('streak_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_date', localDate)
      .limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  },
  async waterTodayMl(userId, timezone, profile) {
    const today = await VitalsService.getHydrationToday(userId, { timezone, profile: profile as { timezone?: string | null; preferences?: unknown } });
    return today.todayMl ?? 0;
  },
};

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

type HeaderSource = { headers: { get(name: string): string | null } };

export function parsePlatform(raw: string | null | undefined): AppPlatform | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'ios' || v === 'android' || v === 'web' ? v : null;
}

/**
 * X-App-Platform (spec) or X-Platform (what Android already sends),
 * X-App-Version, X-App-Build, x-client-timezone. Missing → null.
 */
export function readRequestInfo(request: HeaderSource): FeedRequestInfo {
  const h = request.headers;
  const version = (h.get('x-app-version') ?? '').trim().slice(0, 32) || null;
  const buildRaw = (h.get('x-app-build') ?? '').trim();
  const build = /^\d{1,9}$/.test(buildRaw) ? Number(buildRaw) : null;
  const tz = h.get('x-client-timezone');
  return {
    platform: parsePlatform(h.get('x-app-platform') ?? h.get('x-platform')),
    appVersion: version,
    appBuild: build,
    clientTimezone: isValidTimezone(tz) ? tz : null,
  };
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(now: Date, timezone: string): { date: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

/** Resolve the user's timezone: client header → profile → UTC. */
export function resolveTimezone(info: FeedRequestInfo, profile: FeedProfile): string {
  if (info.clientTimezone) return info.clientTimezone;
  if (isValidTimezone(profile.timezone)) return profile.timezone;
  return 'UTC';
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Resolve to the loader's value, or null on error/timeout. Never throws. */
export async function softly<T>(run: () => Promise<T>, timeoutMs = CONTEXT_LOADER_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function daysSince(createdAt: unknown, now: Date): number | null {
  if (typeof createdAt !== 'string' && !(createdAt instanceof Date)) return null;
  const t = new Date(createdAt as string).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export function proFromProfile(profile: FeedProfile): boolean | null {
  if (!('subscription_tier' in profile)) return null;
  return normalizeTier(profile.subscription_tier) === 'premium';
}

export async function buildFeedContext(
  profile: FeedProfile,
  info: FeedRequestInfo,
  opts: { loaders?: ContextLoaders; now?: Date; timeoutMs?: number } = {}
): Promise<FeedContext> {
  const loaders = opts.loaders ?? defaultContextLoaders;
  const now = opts.now ?? new Date();
  const timezone = resolveTimezone(info, profile);
  const local = localParts(now, timezone);
  const t = opts.timeoutMs;
  const userId = profile.id;

  const [campaign, referralProgramEnabled, subscriptionsEnabled, circleCount, checkedInToday, waterMl] = await Promise.all([
    softly(() => loaders.campaign(profile, timezone), t),
    softly(() => loaders.referralProgramEnabled(profile), t),
    softly(() => loaders.subscriptionsEnabled(profile), t),
    softly(() => loaders.activeCircleCount(userId), t),
    softly(() => loaders.checkedIn(userId, local.date), t),
    softly(() => loaders.waterTodayMl(userId, timezone, profile), t),
  ]);

  const isPro = proFromProfile(profile);
  return {
    userId,
    now,
    platform: info.platform,
    appVersion: info.appVersion,
    appBuild: info.appBuild,
    timezone,
    localDate: local.date,
    localHour: local.hour,
    localWeekday: local.weekday,
    daysSinceSignup: daysSince(profile.created_at, now),
    isPro,
    subscriptionsEnabled,
    hasCircle: circleCount === null ? null : circleCount > 0,
    circleCount,
    campaign,
    referralProgramEnabled,
    checkedInToday,
    streakAtRisk: checkedInToday === false && local.hour >= STREAK_AT_RISK_HOUR,
    waterLoggedToday: waterMl === null ? null : waterMl > 0,
    adsEligible: isPro === null ? null : !isPro,
  };
}
