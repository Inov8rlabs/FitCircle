/**
 * FeedContext builder (spec §5 context.ts): one round of parallel, fail-soft
 * lookups. Every loader has a timeout; a failure or timeout leaves its fields
 * `null` ("unknown") — the feed still renders, hints just don't fire.
 *
 * The profile comes from the auth middleware (`profiles.*`), so timezone,
 * created_at and subscription tier cost nothing extra.
 */
import { CampaignService } from '@/lib/services/campaign-service';
import { EntitlementService, normalizeTier } from '@/lib/services/entitlement-service';
import { ReferralService } from '@/lib/services/referral-service';
import { VitalsService } from '@/lib/services/vitals-service';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

import type { AppPlatform, FeedContext } from './types';

/** Per-loader budget. The whole context costs one parallel round ≈ the slowest loader. */
export const CONTEXT_LOADER_TIMEOUT_MS = 700;

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
  referralProgramEnabled(userId: string): Promise<boolean>;
  subscriptionsEnabled(userId: string): Promise<boolean>;
  activeCircleCount(userId: string): Promise<number>;
  checkedIn(userId: string, localDate: string): Promise<boolean>;
  waterTodayMl(userId: string, timezone: string, profile: FeedProfile): Promise<number>;
}

export const defaultContextLoaders: ContextLoaders = {
  async campaign(profile, timezone) {
    const { campaigns } = await CampaignService.listForViewer(profile as any, timezone);
    const home = campaigns[0];
    return home ? { present: true, slug: home.slug, phase: home.phase } : { present: false, slug: null, phase: null };
  },
  referralProgramEnabled: (userId) => ReferralService.isProgramEnabled(userId),
  subscriptionsEnabled: (userId) => EntitlementService.areSubscriptionsEnabled(userId),
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
    softly(() => loaders.referralProgramEnabled(userId), t),
    softly(() => loaders.subscriptionsEnabled(userId), t),
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
