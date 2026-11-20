import { headers } from 'next/headers';

import { logIgnoredQueryError } from '@/lib/api/route-errors';
import { isAttestedDevice } from '@/lib/integrity/attestations';
import { normalizeDeviceId } from '@/lib/integrity/contract';
import { recordSecurityEvent } from '@/lib/security/security-events';

import { TIER_LIMITS, LEGACY_LIMITS } from '../config/tier-limits';
import { trialEligibleFromProfile } from '../entitlements/trial-eligibility';
import { RemoteConfigService } from '../remote-config/service';
import { createAdminSupabase } from '../supabase-admin';
import {
  allowanceTimezone,
  dailyScansUsed,
  fitzyAllowanceFrom,
  freeFoodScanAllowance,
  localDayWindow,
  localWeekWindow,
  nextUtcMidnight,
  unmeteredFoodScanAllowance,
  UNLIMITED_FITZY_ALLOWANCE,
  type FitzyAllowance,
  type FoodScanAllowance,
} from '../usage/allowance';

import { TrialConfig } from './trial-config';

/**
 * UsageService — tier-aware daily quotas for metered AI features.
 *
 * Two distinct refusals, which clients treat very differently:
 *  - UpgradeRequiredError (free user at the free-tier limit, gate live):
 *    the PRIMARY paywall trigger. Routes map it to 429/402 with
 *    code 'UPGRADE_REQUIRED' + {feature, used, limit} so clients open the
 *    contextual paywall.
 *  - Error('RateLimited') (abuse ceiling, or the legacy cap while gates are
 *    dark): plain rate limit; clients keep their existing 429 handling.
 *
 * Gate-dark behavior (before pending migration 083, the Pro launch switch): LEGACY limits apply to everyone —
 * byte-identical to pre-subscription FitCircle.
 *
 * Counting uses the proven insert-then-count pattern (nutrition_parse_log /
 * fitzy_message_log with (user_id, created_at) indexes); no stored procedures
 * per CLAUDE.md. Tolerance: two truly concurrent requests can both pass the
 * check at limit-1 — acceptable for a daily product quota.
 */

/** PGRST204 / 42703 naming `column` (a migration not applied yet). */
function isMissingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error || (error.code !== 'PGRST204' && error.code !== '42703')) return false;
  return typeof error.message === 'string' && error.message.includes(column);
}

export class UpgradeRequiredError extends Error {
  constructor(
    public readonly feature: string,
    public readonly used: number,
    public readonly limit: number,
    /** Fitzy chat gate only: may the user still start a free trial (paywall copy). Undefined elsewhere. */
    public readonly trialEligible?: boolean,
    /** Free-trial length for the paywall copy (remote config `trial_days` for this request). */
    public readonly trialDays?: number,
    /**
     * 1.1.5 additive context (docs/ENGAGEMENT_115_SPEC.md §2.3, §3.3):
     *  - food: `phase` (starter | daily | exhausted) and the allowance AFTER the refusal;
     *  - Fitzy weekly: `window: 'week'` + `resetsAt`.
     */
    public readonly extra: {
      phase?: 'starter' | 'daily' | 'exhausted';
      allowance?: FoodScanAllowance;
      window?: 'week' | 'day';
      resetsAt?: string | null;
    } = {}
  ) {
    super('UPGRADE_REQUIRED');
    this.name = 'UpgradeRequiredError';
  }
}

type Tier = 'free' | 'premium';

interface FreeFoodAiPlan {
  kind: 'free';
  /** Lifetime starter allowance (free_food_ai_analyses_total). */
  limit: number;
  /** Daily allowance after the starter (free_food_ai_daily_after_total); 0 = none. */
  daily: number;
  trialEligible: boolean;
  trialDays?: number;
  timezone: string;
  dayStart: Date;
  resetsAt: Date;
}
type FoodAiPlan = { kind: 'legacy' | 'premium'; limit: number; trialEligible: boolean } | FreeFoodAiPlan;
interface FreeScanUsage {
  lifetime: number;
  today: number;
}

/** How assertFitzyQuota says the message must be recorded (fitzy_message_log.tier / .context). */
export interface FitzyQuotaDecision {
  tier: 'free' | 'pro';
  context: 'onboarding' | null;
}

/** Free Fitzy answers per day for the onboarding tour's "Ask Fitzy" step (TRIAL_FIRST_SPEC §1.3). */
export const ONBOARDING_FREE_FITZY_MESSAGES = 3;

/** A held food AI credit (a nutrition_parse_log row). `release()` gives it back after a failed analysis. */
export interface FoodAiReservation {
  /** null when the reservation row could not be written (fail-soft path). */
  id: string | null;
  release(): Promise<void>;
}

/**
 * A food AI analysis repeated within this window (same content hash, or same client
 * `X-Analysis-Job-Id`) is not counted again (ENGAGEMENT_115_SPEC §14.4 item 3).
 */
export const FOOD_AI_REPEAT_WINDOW_MS = 10 * 60_000;
/** Separator between the content hash and the job id in nutrition_parse_log.image_hash. */
const JOB_TAG = '|job:';

/**
 * nutrition_parse_log.image_hash for a credit: the content hash, plus `|job:<id>` when the client
 * sent an analysis job id. No column needed: image_hash is write-only audit data (nothing else
 * reads it; the parse cache has its own table).
 */
export function foodAiCreditHash(contentHash: string, jobId?: string): string {
  return jobId ? `${contentHash}${JOB_TAG}${jobId}` : contentHash;
}

/** The counted analysis a request repeats (content hash of that analysis + when it was counted). */
export interface FoodAiRepeat {
  contentHash: string;
  countedAt: string;
  matchedBy: 'content' | 'job';
}

export class UsageService {
  /**
   * The user's counted food AI analysis this request repeats, if any: a nutrition_parse_log row
   * within FOOD_AI_REPEAT_WINDOW_MS with the same content hash, or (when `jobId` is given) the
   * same analysis job id. One indexed read (user_id, created_at). Fail-soft: errors → null
   * (the request is simply counted, as before).
   */
  static async recentFoodAiCredit(userId: string, contentHash: string, jobId?: string, now: Date = new Date()): Promise<FoodAiRepeat | null> {
    try {
      const since = new Date(now.getTime() - FOOD_AI_REPEAT_WINDOW_MS).toISOString();
      const { data, error } = await createAdminSupabase()
        .from('nutrition_parse_log')
        .select('image_hash, created_at')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        logIgnoredQueryError('UsageService.recentFoodAiCredit', error);
        return null;
      }
      for (const row of (data ?? []) as Array<{ image_hash: string | null; created_at: string }>) {
        const stored = row.image_hash ?? '';
        const at = stored.indexOf(JOB_TAG);
        const hash = at >= 0 ? stored.slice(0, at) : stored;
        const job = at >= 0 ? stored.slice(at + JOB_TAG.length) : null;
        if (hash && hash === contentHash) return { contentHash: hash, countedAt: row.created_at, matchedBy: 'content' };
        if (jobId && job === jobId && hash) return { contentHash: hash, countedAt: row.created_at, matchedBy: 'job' };
      }
      return null;
    } catch (err: any) {
      console.warn('[UsageService] recentFoodAiCredit failed (counting as usual):', err?.message ?? err);
      return null;
    }
  }

  /**
   * Food AI quota check WITHOUT consuming (photo + voice + describe + Fix + estimate-item combined).
   * Call it before serving a cached analysis so a free user past the allowance gets the
   * paywall instead of a free result. Use reserveFoodAi() right before an actual model call.
   *
   * Phases (docs/ENGAGEMENT_115_SPEC.md §2.1): Pro / trial = the 100/day abuse ceiling; gate
   * dark = the legacy 25/day RateLimited cap; free = the lifetime starter allowance
   * (free_food_ai_analyses_total), then free_food_ai_daily_after_total per LOCAL day (0 = none,
   * which is every request without a >= 1.1.5 app version).
   */
  static async assertFoodAiQuota(userId: string): Promise<void> {
    const plan = await this.foodAiPlan(userId);
    if (plan.kind !== 'free') {
      const used = await this.countToday('nutrition_parse_log', userId);
      if (used >= plan.limit) throw new Error('RateLimited');
      return;
    }
    const usage = await this.freeScanUsage(userId, plan);
    if (this.freeScanBlocked(plan, usage, 0)) throw await this.foodAiRefusalNoted(plan, usage, userId);
  }

  /**
   * Reserve ONE food AI analysis before the model call (race-safe insert-then-count).
   * Inserts the nutrition_parse_log row first, then counts; if the count (including this row)
   * is over the allowance the row is deleted and the call refused, BEFORE any model call. Two
   * parallel requests at the last credit can never both pass (worst case both are refused —
   * the user retries and gets the last credit). Only SUCCESSFUL analyses keep their row:
   * callers MUST call `release()` when the model call fails, so failed parses never burn a credit.
   *
   * @throws UpgradeRequiredError (free, gate live) / Error('RateLimited') (ceilings)
   */
  static async reserveFoodAi(userId: string, contentHash: string, opts: { jobId?: string } = {}): Promise<FoodAiReservation> {
    const plan = await this.foodAiPlan(userId);
    const supabase = createAdminSupabase();
    const hash = foodAiCreditHash(contentHash, opts.jobId);
    // Attested device (Android integrity): the credit also counts against the device.
    const deviceId = plan.kind === 'free' ? await this.attestedRequestDevice(userId) : null;
    let { data: row, error: insertError } = await supabase
      .from('nutrition_parse_log')
      .insert({ user_id: userId, image_hash: hash, ...(deviceId ? { device_id: deviceId } : {}) })
      .select('id')
      .single();
    if (insertError && deviceId && isMissingColumn(insertError, 'device_id')) {
      ({ data: row, error: insertError } = await supabase
        .from('nutrition_parse_log')
        .insert({ user_id: userId, image_hash: hash })
        .select('id')
        .single());
    }
    if (insertError || !row?.id) {
      // Couldn't write the reservation: fall back to the plain (non-atomic) check so a logging
      // fault never blocks a paying user, and still refuse a free user who is clearly over.
      console.error('[UsageService] nutrition_parse_log reservation failed:', insertError?.message);
      if (plan.kind !== 'free') {
        const used = await this.countToday('nutrition_parse_log', userId);
        if (used >= plan.limit) throw new Error('RateLimited');
      } else {
        const usage = await this.freeScanUsage(userId, plan);
        if (this.freeScanBlocked(plan, usage, 0)) throw await this.foodAiRefusalNoted(plan, usage, userId);
      }
      return { id: null, release: async () => {} };
    }
    const id = row.id as string;
    const release = async () => {
      const { error } = await createAdminSupabase().from('nutrition_parse_log').delete().eq('id', id);
      if (error) console.error('[UsageService] nutrition_parse_log release failed:', error.message);
    };
    if (plan.kind !== 'free') {
      const count = await this.countToday('nutrition_parse_log', userId);
      if (count > plan.limit) {
        await release();
        throw new Error('RateLimited');
      }
      return { id, release };
    }
    const usage = await this.freeScanUsage(userId, plan);
    if (this.freeScanBlocked(plan, usage, 1)) {
      await release();
      throw await this.foodAiRefusalNoted(plan, { lifetime: Math.max(0, usage.lifetime - 1), today: Math.max(0, usage.today - 1) }, userId);
    }
    return { id, release };
  }

  /**
   * Legacy `limits.foodAiAnalysesTotal` / `foodAiAnalysesRemaining` (TRIAL_FIRST_SPEC §5):
   * the lifetime allowance. Both null for Pro / trial (only the abuse ceiling) and while the
   * gate is dark.
   */
  static async foodAiAllowance(
    userId: string,
    tier: Tier,
    gateLive: boolean,
    signupAt?: string | null
  ): Promise<{ total: number | null; remaining: number | null }> {
    if (!gateLive || tier !== 'free') return { total: null, remaining: null };
    const [total, used] = await Promise.all([this.freeFoodAiTotal(userId, signupAt), this.countFoodAi(userId, 'lifetime')]);
    return { total, remaining: Math.max(0, total - used) };
  }

  /**
   * `allowances.foodScans` for GET /api/mobile/entitlements (ENGAGEMENT_115_SPEC §2.3). The
   * daily key is resolved for the current request (X-App-Version / X-App-Platform rules), so
   * 1.1.2–1.1.4, web and header-less requests resolve 0 → starter / exhausted only.
   */
  static async foodScanAllowance(userId: string, tier: Tier, gateLive: boolean, requestTz?: string | null): Promise<FoodScanAllowance> {
    if (!gateLive || tier !== 'free') {
      return unmeteredFoodScanAllowance(gateLive ? 'unlimited' : 'legacy', allowanceTimezone(requestTz, null));
    }
    const profile = await this.getProfileForGate(userId);
    const plan = await this.freePlan(userId, profile, requestTz);
    const usage = await this.freeScanUsage(userId, plan);
    return this.scanAllowanceOf(plan, usage);
  }

  /**
   * X-Device-Id of the current request when that device has passed the Android integrity
   * check for this user (device_attestations). Unverified ids are ignored: they are
   * client-controlled. Null outside a request.
   */
  private static async attestedRequestDevice(userId: string): Promise<string | null> {
    let deviceId: string | null = null;
    try {
      const h = await headers();
      deviceId = normalizeDeviceId(h.get('x-device-id'));
    } catch {
      return null; // not inside a request (cron, scripts, tests)
    }
    if (!deviceId) return null;
    return (await isAttestedDevice(userId, deviceId)) ? deviceId : null;
  }

  /** Account ids that share this user's mailbox (profiles.email_canonical), including the user. */
  private static async mailboxAccountIds(userId: string): Promise<string[]> {
    const supabase = createAdminSupabase();
    const { data: me, error } = await supabase.from('profiles').select('email_canonical').eq('id', userId).maybeSingle();
    const canonical = !error && typeof (me as any)?.email_canonical === 'string' ? ((me as any).email_canonical as string) : null;
    if (!canonical) return [userId];
    const { data: rows, error: rowsError } = await supabase.from('profiles').select('id').eq('email_canonical', canonical).limit(50);
    if (rowsError) return [userId];
    const ids = new Set<string>([userId, ...((rows ?? []) as Array<{ id: string }>).map((r) => r.id)]);
    return Array.from(ids);
  }

  /**
   * Free-tier limits come from remote config (Admin Tools, TRIAL_FIRST_SPEC §6): a matching
   * segment rule, else the admin default, else the code default (5 / 0). Never throws.
   * Lowering a limit below what a user already used simply means nothing is left.
   */
  static freeFoodAiTotal(userId: string, signupAt?: string | null): Promise<number> {
    return RemoteConfigService.value('free_food_ai_analyses_total', { userId, ...(signupAt !== undefined ? { signupAt } : {}) });
  }

  static freeFitzyLimit(userId: string, signupAt?: string | null): Promise<number> {
    return RemoteConfigService.value('free_fitzy_messages_per_day', { userId, ...(signupAt !== undefined ? { signupAt } : {}) });
  }

  /** Daily scans after the starter allowance (remote config; 0 unless a >= 1.1.5 version rule matches). */
  static freeFoodAiDaily(userId: string, signupAt?: string | null): Promise<number> {
    return RemoteConfigService.value('free_food_ai_daily_after_total', { userId, ...(signupAt !== undefined ? { signupAt } : {}) });
  }

  static freeFitzyWeekly(userId: string, signupAt?: string | null): Promise<number> {
    return RemoteConfigService.value('free_fitzy_messages_per_week', { userId, ...(signupAt !== undefined ? { signupAt } : {}) });
  }

  private static async foodAiPlan(userId: string): Promise<FoodAiPlan> {
    const gateLive = await this.isGateLive('food_ai_unlimited');
    if (!gateLive) return { kind: 'legacy', limit: LEGACY_LIMITS.foodAiParsesPerDay, trialEligible: false };
    const profile = await this.getProfileForGate(userId);
    if (profile.tier === 'premium') return { kind: 'premium', limit: TIER_LIMITS.premium.foodAiParsesPerDay, trialEligible: false };
    return this.freePlan(userId, profile);
  }

  private static async freePlan(
    userId: string,
    profile: { trialEligible: boolean; signupAt: string | null; timezone: string | null },
    requestTz?: string | null
  ): Promise<FreeFoodAiPlan> {
    const tzHeader = requestTz !== undefined ? requestTz : await this.requestTimezone();
    const timezone = allowanceTimezone(tzHeader, profile.timezone);
    const [limit, daily, trialDays] = await Promise.all([
      this.freeFoodAiTotal(userId, profile.signupAt),
      this.freeFoodAiDaily(userId, profile.signupAt).catch(() => 0),
      TrialConfig.days(userId),
    ]);
    const day = localDayWindow(timezone);
    return { kind: 'free', limit, daily, trialEligible: profile.trialEligible, trialDays, timezone, dayStart: day.start, resetsAt: day.resetsAt };
  }

  /** Lifetime rows (L) and, once the starter allowance is used and a daily allowance applies, rows since local midnight (T). */
  private static async freeScanUsage(userId: string, plan: FreeFoodAiPlan): Promise<FreeScanUsage> {
    const lifetime = (await this.lifetimeFoodAiUsage(userId)).used;
    const today = plan.daily > 0 && lifetime >= plan.limit ? (await this.lifetimeFoodAiUsage(userId, plan.dayStart)).used : 0;
    return { lifetime, today };
  }

  /**
   * Is the free user over the allowance? `pending` = rows of THIS request already counted
   * (1 right after the reservation insert, 0 for a plain check).
   */
  private static freeScanBlocked(plan: FreeFoodAiPlan, usage: FreeScanUsage, pending: 0 | 1): boolean {
    if (usage.lifetime - pending < plan.limit) return false; // inside the starter allowance
    if (plan.daily <= 0) return true;
    const used = dailyScansUsed(plan.limit, usage.lifetime, usage.today);
    return pending === 1 ? used > plan.daily : used >= plan.daily;
  }

  private static scanAllowanceOf(plan: FreeFoodAiPlan, usage: FreeScanUsage): FoodScanAllowance {
    return freeFoodScanAllowance({
      total: plan.limit,
      daily: plan.daily,
      lifetimeUsed: usage.lifetime,
      todayUsed: usage.today,
      timezone: plan.timezone,
      resetsAt: plan.resetsAt,
    });
  }

  /** The refusal (usage WITHOUT the refused request), after recording a shared-device / mailbox hit. */
  private static async foodAiRefusalNoted(plan: FreeFoodAiPlan, usage: FreeScanUsage, userId: string): Promise<UpgradeRequiredError> {
    const allowance = this.scanAllowanceOf(plan, usage);
    if (allowance.mode === 'daily') {
      // The user's own daily allowance: not a shared-device / shared-mailbox starter hit.
      const used = dailyScansUsed(plan.limit, usage.lifetime, usage.today);
      return new UpgradeRequiredError('food_ai_unlimited', used, plan.daily, plan.trialEligible, plan.trialDays, { phase: 'daily', allowance });
    }
    await this.noteSharedLimit(userId, plan.limit);
    return new UpgradeRequiredError('food_ai_unlimited', usage.lifetime, plan.limit, plan.trialEligible, plan.trialDays, {
      phase: allowance.mode === 'exhausted' ? 'exhausted' : 'starter',
      allowance,
    });
  }

  /** X-Client-Timezone of the current request; null outside a request (cron, scripts, tests). */
  private static async requestTimezone(): Promise<string | null> {
    try {
      const h = await headers();
      return h.get('x-client-timezone');
    } catch {
      return null;
    }
  }

  /**
   * Lifetime count = the larger of: every account on the same mailbox (canonical email),
   * and the attested device of this request across all accounts. So new accounts on one
   * phone, or `+tag` / Gmail-dot spellings of one inbox, don't reset the free allowance.
   */
  private static async countFoodAi(userId: string, scope: 'today' | 'lifetime'): Promise<number> {
    if (scope === 'today') return this.countToday('nutrition_parse_log', userId);
    return (await this.lifetimeFoodAiUsage(userId)).used;
  }

  /** Food AI rows since an instant, with the same mailbox / attested-device max as lifetime. */
  static async countFoodAiSince(userId: string, since: Date): Promise<number> {
    return (await this.lifetimeFoodAiUsage(userId, since)).used;
  }

  /** Lifetime usage split: own account, mailbox group, attested device. */
  private static async lifetimeFoodAiUsage(
    userId: string,
    since?: Date
  ): Promise<{ used: number; ownUsed: number; deviceId: string | null; sharedLimitReason: 'device' | 'mailbox' | null }> {
    const supabase = createAdminSupabase();
    const [ids, deviceId] = await Promise.all([this.mailboxAccountIds(userId), this.attestedRequestDevice(userId)]);
    // `since` = the local-day window of the daily phase (ENGAGEMENT_115_SPEC §2.1); absent = lifetime.
    const rows = () => {
      const q = supabase.from('nutrition_parse_log').select('*', { count: 'exact', head: true });
      return since ? q.gte('created_at', since.toISOString()) : q;
    };
    const accountQuery = rows();
    const { count, error } = await (ids.length === 1 ? accountQuery.eq('user_id', userId) : accountQuery.in('user_id', ids));
    logIgnoredQueryError('UsageService.countFoodAi', error);
    const groupUsed = count ?? 0;
    let ownUsed = groupUsed;
    if (ids.length > 1) {
      const { count: own } = await rows().eq('user_id', userId);
      ownUsed = own ?? 0;
    }
    let deviceUsed = 0;
    if (deviceId) {
      const { count: deviceCount, error: deviceError } = await rows().eq('device_id', deviceId);
      if (!deviceError) deviceUsed = deviceCount ?? 0;
    }
    const used = Math.max(groupUsed, deviceUsed);
    const sharedLimitReason = deviceUsed > ownUsed && deviceUsed >= groupUsed ? 'device' : groupUsed > ownUsed ? 'mailbox' : null;
    return { used, ownUsed, deviceId, sharedLimitReason };
  }

  /**
   * A free user refused because ANOTHER account on the same device or mailbox used the
   * allowance: record it (security_events + Amplitude "Free AI Device Limit Hit").
   */
  private static async noteSharedLimit(userId: string, limit: number): Promise<void> {
    try {
      const usage = await this.lifetimeFoodAiUsage(userId);
      if (!usage.sharedLimitReason || usage.ownUsed >= limit) return;
      await recordSecurityEvent(null, {
        kind: 'free_ai_device_limit',
        result: 'block',
        reason: usage.sharedLimitReason,
        userId,
        deviceId: usage.deviceId,
        amplitude: { limit, used: usage.used },
      });
    } catch {
      // telemetry only
    }
  }

  /**
   * Fitzy / nutrition-coach quota, checked BEFORE any conversation write, message log or model
   * call. Gate dark = no-op. Pro (incl. trialing) = the 200/day abuse ceiling.
   *
   * Free (docs/ENGAGEMENT_115_SPEC.md §3.1):
   *  - weekly mode when free_fitzy_messages_per_week resolves > 0 for this request (apps
   *    >= 1.1.5): free, non-onboarding messages since Monday 00:00 local; the daily key is
   *    ignored for the request;
   *  - otherwise the daily key (free_fitzy_messages_per_day, 0 = first message → paywall),
   *    exactly as 1.1.2–1.1.4.
   * The onboarding tour's "Ask Fitzy" step stays answerable for users who haven't finished
   * onboarding (ONBOARDING_FREE_FITZY_MESSAGES per day) and those messages never count.
   *
   * Returns how the message must be recorded (pass it to recordFitzyMessage).
   */
  static async assertFitzyQuota(userId: string, opts: { onboarding?: boolean } = {}): Promise<FitzyQuotaDecision> {
    const gateLive = await this.isGateLive('fitzy_unlimited');
    const profile = await this.getProfileForGate(userId);
    const tier: 'free' | 'pro' = profile.tier === 'premium' ? 'pro' : 'free';
    if (!gateLive) return { tier, context: null };

    const usedToday = await this.countToday('fitzy_message_log', userId);
    if (tier === 'pro') {
      if (usedToday >= TIER_LIMITS.premium.fitzyMessagesPerDay) throw new Error('RateLimited');
      return { tier, context: null };
    }
    // Narrow on purpose: unfinished onboarding only, ONBOARDING_FREE_FITZY_MESSAGES per day.
    if (opts.onboarding && profile.onboardingCompleted !== true && usedToday < ONBOARDING_FREE_FITZY_MESSAGES) {
      return { tier, context: 'onboarding' };
    }
    const weekly = await this.freeFitzyWeekly(userId, profile.signupAt).catch(() => 0);
    if (weekly > 0) {
      const tz = allowanceTimezone(await this.requestTimezone(), profile.timezone);
      const week = localWeekWindow(tz);
      const used = await this.countFreeFitzySince(userId, week.start);
      if (used >= weekly) {
        throw new UpgradeRequiredError('fitzy_unlimited', used, weekly, profile.trialEligible, await TrialConfig.days(userId), {
          window: 'week',
          resetsAt: week.resetsAt.toISOString(),
        });
      }
      return { tier, context: null };
    }
    const limit = await this.freeFitzyLimit(userId, profile.signupAt);
    if (usedToday >= limit) {
      throw new UpgradeRequiredError('fitzy_unlimited', usedToday, limit, profile.trialEligible, await TrialConfig.days(userId), {
        window: 'day',
        resetsAt: nextUtcMidnight().toISOString(),
      });
    }
    return { tier, context: null };
  }

  /**
   * Fitzy tier + what is left after this message (FITZY_V2_SPEC §6, ENGAGEMENT_115_SPEC §3.3).
   * `remaining` / `limit` / `window` / `resetsAt` are null when uncapped (Pro, or the gate is
   * dark). Call after recordFitzyMessage so the count includes the current message.
   */
  static async fitzyAllowance(
    userId: string
  ): Promise<{ tier: 'free' | 'pro'; remaining: number | null; limit: number | null; window: 'week' | 'day' | null; resetsAt: string | null }> {
    const [gateLive, tier] = await Promise.all([this.isGateLive('fitzy_unlimited'), this.getTier(userId)]);
    const t: 'free' | 'pro' = tier === 'premium' ? 'pro' : 'free';
    if (t === 'pro' || !gateLive) return { tier: t, remaining: null, limit: null, window: null, resetsAt: null };
    const a = await this.freeFitzyWindow(userId);
    return { tier: t, remaining: a.remaining, limit: a.limit, window: a.window, resetsAt: a.resetsAt };
  }

  /** `allowances.fitzy` for GET /api/mobile/entitlements. */
  static async fitzyAllowanceFor(userId: string, tier: Tier, gateLive: boolean, requestTz?: string | null): Promise<FitzyAllowance> {
    if (tier !== 'free' || !gateLive) return { ...UNLIMITED_FITZY_ALLOWANCE };
    return this.freeFitzyWindow(userId, requestTz);
  }

  private static async freeFitzyWindow(userId: string, requestTz?: string | null): Promise<FitzyAllowance> {
    const profile = await this.getProfileForGate(userId);
    const weekly = await this.freeFitzyWeekly(userId, profile.signupAt).catch(() => 0);
    if (weekly > 0) {
      const tz = allowanceTimezone(requestTz !== undefined ? requestTz : await this.requestTimezone(), profile.timezone);
      const week = localWeekWindow(tz);
      const used = await this.countFreeFitzySince(userId, week.start);
      return fitzyAllowanceFrom({ window: 'week', limit: weekly, used, resetsAt: week.resetsAt });
    }
    const [used, limit] = await Promise.all([this.countToday('fitzy_message_log', userId), this.freeFitzyLimit(userId, profile.signupAt)]);
    return fitzyAllowanceFrom({ window: 'day', limit, used, resetsAt: nextUtcMidnight() });
  }

  /**
   * Free, non-onboarding Fitzy messages since an instant (the weekly count). Rows from before
   * migration 138 have tier NULL and never count; a missing column counts 0 (generous, never blocking).
   */
  private static async countFreeFitzySince(userId: string, since: Date): Promise<number> {
    const supabase = createAdminSupabase();
    const { count, error } = await supabase
      .from('fitzy_message_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tier', 'free')
      .or('context.is.null,context.neq.onboarding')
      .gte('created_at', since.toISOString());
    if (error) {
      if (!isMissingColumn(error, 'tier') && !isMissingColumn(error, 'context')) logIgnoredQueryError('UsageService.countFreeFitzySince', error);
      return 0;
    }
    return count ?? 0;
  }

  /** 'pro' for premium/enterprise subscribers (Fitzy Pro features: plans, memory, history). */
  static async fitzyTier(userId: string): Promise<'free' | 'pro'> {
    return (await this.getTier(userId)) === 'premium' ? 'pro' : 'free';
  }

  /**
   * Record one Fitzy/coach message. Called BEFORE the model call (insert-before-call closes
   * the check/insert race in the caller's favor, not the abuser's). `decision` (from
   * assertFitzyQuota) stamps `tier` / `context` (migration 138) for the weekly count; without
   * it the tier is looked up. Falls back to the plain insert until 138 is applied.
   */
  static async recordFitzyMessage(userId: string, decision?: FitzyQuotaDecision | void): Promise<void> {
    const supabase = createAdminSupabase();
    const tier = decision?.tier ?? ((await this.getTier(userId)) === 'premium' ? 'pro' : 'free');
    const context = decision?.context ?? null;
    let { error } = await supabase.from('fitzy_message_log').insert({ user_id: userId, tier, context });
    if (error && (isMissingColumn(error, 'tier') || isMissingColumn(error, 'context'))) {
      ({ error } = await supabase.from('fitzy_message_log').insert({ user_id: userId }));
    }
    if (error) console.error('[UsageService] fitzy_message_log insert failed:', error.message);
  }

  /**
   * Circle-creation cap: free users may have at most 2 active created circles
   * once the gate is live. Returns null when allowed, or the details clients
   * need for the contextual paywall.
   */
  static async checkCircleCreation(
    userId: string
  ): Promise<{ used: number; limit: number } | null> {
    const gateLive = await this.isGateLive('circles_unlimited');
    if (!gateLive) return null;

    const tier = await this.getTier(userId);
    const limit = TIER_LIMITS[tier].maxActiveCreatedCircles;
    if (!Number.isFinite(limit)) return null;

    const supabase = createAdminSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const { count, error: countError } = await supabase
      .from('fitcircles')
      .select('*', { count: 'exact', head: true })
      .eq('creator_id', userId)
      .eq('is_official', false)
      .gte('end_date', today);
    logIgnoredQueryError('UsageService.checkCircleCreation', countError);
    const used = count ?? 0;
    return used >= limit ? { used, limit } : null;
  }

  /**
   * History window for stats/insights endpoints: free = 14 days once the gate
   * is live; otherwise unlimited. Endpoints CLAMP (never 403) and mark the
   * response so clients can render the "unlock full history" footer.
   */
  static async historyWindowDays(userId: string): Promise<number> {
    const gateLive = await this.isGateLive('history_extended');
    if (!gateLive) return Number.POSITIVE_INFINITY;
    const tier = await this.getTier(userId);
    return TIER_LIMITS[tier].historyDays;
  }

  // ---------------------------------------------------------------------------

  /** Tier + trial eligibility from ONE profile read (the Fitzy gate needs both). */
  private static async getProfileForGate(
    userId: string
  ): Promise<{ tier: Tier; trialEligible: boolean; signupAt: string | null; onboardingCompleted: boolean | null; timezone: string | null }> {
    const supabase = createAdminSupabase();
    const { data, error: dataError } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_platform, trial_started_at, created_at, onboarding_completed, timezone')
      .eq('id', userId)
      .maybeSingle();
    logIgnoredQueryError('UsageService.getProfileForGate', dataError);
    const raw = data?.subscription_tier;
    return {
      tier: raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free',
      trialEligible: trialEligibleFromProfile(data ?? null),
      signupAt: typeof data?.created_at === 'string' ? data.created_at : null,
      onboardingCompleted: typeof data?.onboarding_completed === 'boolean' ? data.onboarding_completed : null,
      timezone: typeof (data as any)?.timezone === 'string' ? ((data as any).timezone as string) : null,
    };
  }

  private static async getTier(userId: string): Promise<Tier> {
    const supabase = createAdminSupabase();
    const { data, error: dataError } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();
    logIgnoredQueryError('UsageService.getTier', dataError);
    const raw = data?.subscription_tier;
    return raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free';
  }

  /** A gate is "live" once 077 flips it to premium; missing/dark rows are not. */
  private static async isGateLive(featureKey: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data, error: dataError } = await supabase
      .from('feature_gates')
      .select('required_tier')
      .eq('feature_key', featureKey)
      .maybeSingle();
    logIgnoredQueryError('UsageService.isGateLive', dataError);
    return data?.required_tier === 'premium';
  }

  private static async countToday(
    table: 'nutrition_parse_log' | 'fitzy_message_log',
    userId: string
  ): Promise<number> {
    const supabase = createAdminSupabase();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count, error: countError } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    logIgnoredQueryError('UsageService.countToday', countError);
    return count ?? 0;
  }
}
