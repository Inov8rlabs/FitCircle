import { headers } from 'next/headers';

import { logIgnoredQueryError } from '@/lib/api/route-errors';
import { isAttestedDevice } from '@/lib/integrity/attestations';
import { normalizeDeviceId } from '@/lib/integrity/contract';
import { recordSecurityEvent } from '@/lib/security/security-events';

import { TIER_LIMITS, LEGACY_LIMITS } from '../config/tier-limits';
import { trialEligibleFromProfile } from '../entitlements/trial-eligibility';
import { RemoteConfigService } from '../remote-config/service';
import { createAdminSupabase } from '../supabase-admin';

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
    public readonly trialDays?: number
  ) {
    super('UPGRADE_REQUIRED');
    this.name = 'UpgradeRequiredError';
  }
}

type Tier = 'free' | 'premium';

/** Free Fitzy answers per day for the onboarding tour's "Ask Fitzy" step (TRIAL_FIRST_SPEC §1.3). */
export const ONBOARDING_FREE_FITZY_MESSAGES = 3;

/** A held food AI credit (a nutrition_parse_log row). `release()` gives it back after a failed analysis. */
export interface FoodAiReservation {
  /** null when the reservation row could not be written (fail-soft path). */
  id: string | null;
  release(): Promise<void>;
}

export class UsageService {
  /**
   * Food AI quota check WITHOUT consuming (photo + voice + describe + Fix + estimate-item combined).
   * Call it before serving a cached analysis so a free user past the lifetime allowance gets the
   * paywall instead of a free result. Use reserveFoodAi() right before an actual model call.
   *
   * Trial-first (TRIAL_FIRST_SPEC §5): once food_ai_unlimited is live, FREE = 5 successful AI
   * analyses in TOTAL (lifetime, every row in nutrition_parse_log); Pro / trial = the 100/day
   * abuse ceiling. Gate dark = the legacy 25/day RateLimited cap for everyone.
   */
  static async assertFoodAiQuota(userId: string): Promise<void> {
    const plan = await this.foodAiPlan(userId);
    const used = await this.countFoodAi(userId, plan.scope);
    if (used >= plan.limit) throw await this.foodAiRefusalNoted(plan, used, userId);
  }

  /**
   * Reserve ONE food AI analysis before the model call (race-safe insert-then-count).
   * Inserts the nutrition_parse_log row first, then counts; if the count (including this row)
   * is over the limit the row is deleted and the call refused. Two parallel requests at 4/5 can
   * therefore never both pass (worst case both see 6/5 and both are refused — the user retries
   * and gets the last credit). Only SUCCESSFUL analyses keep their row: callers MUST call
   * `release()` when the model call fails, so failed/fallback parses never burn a credit.
   *
   * @throws UpgradeRequiredError (free, gate live) / Error('RateLimited') (ceilings)
   */
  static async reserveFoodAi(userId: string, hash: string): Promise<FoodAiReservation> {
    const plan = await this.foodAiPlan(userId);
    const supabase = createAdminSupabase();
    // Attested device (Android integrity): the credit also counts against the device.
    const deviceId = plan.scope === 'lifetime' ? await this.attestedRequestDevice(userId) : null;
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
      const used = await this.countFoodAi(userId, plan.scope);
      if (used >= plan.limit) throw this.foodAiRefusal(plan, used);
      return { id: null, release: async () => {} };
    }
    const id = row.id as string;
    const release = async () => {
      const { error } = await createAdminSupabase().from('nutrition_parse_log').delete().eq('id', id);
      if (error) console.error('[UsageService] nutrition_parse_log release failed:', error.message);
    };
    const count = await this.countFoodAi(userId, plan.scope);
    if (count > plan.limit) {
      await release();
      throw await this.foodAiRefusalNoted(plan, count - 1, userId);
    }
    return { id, release };
  }

  /**
   * Free food AI allowance for GET /api/mobile/entitlements (TRIAL_FIRST_SPEC §5):
   * total = 5 and remaining = 5 − lifetime analyses for free users once the gate is live;
   * both null for Pro / trial (only the abuse ceiling) and while the gate is dark.
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

  private static async foodAiPlan(
    userId: string
  ): Promise<{ kind: 'legacy' | 'free' | 'premium'; scope: 'today' | 'lifetime'; limit: number; trialEligible: boolean; trialDays?: number }> {
    const gateLive = await this.isGateLive('food_ai_unlimited');
    if (!gateLive) return { kind: 'legacy', scope: 'today', limit: LEGACY_LIMITS.foodAiParsesPerDay, trialEligible: false };
    const profile = await this.getProfileForGate(userId);
    if (profile.tier === 'premium') return { kind: 'premium', scope: 'today', limit: TIER_LIMITS.premium.foodAiParsesPerDay, trialEligible: false };
    const [limit, trialDays] = await Promise.all([this.freeFoodAiTotal(userId, profile.signupAt), TrialConfig.days(userId)]);
    return { kind: 'free', scope: 'lifetime', limit, trialEligible: profile.trialEligible, trialDays };
  }

  /** The refusal, after recording a shared-device / shared-mailbox limit hit (free plan only). */
  private static async foodAiRefusalNoted(plan: { kind: 'legacy' | 'free' | 'premium'; limit: number; trialEligible: boolean; trialDays?: number }, used: number, userId: string): Promise<Error> {
    if (plan.kind === 'free') await this.noteSharedLimit(userId, plan.limit);
    return this.foodAiRefusal(plan, used);
  }

  private static foodAiRefusal(plan: { kind: 'legacy' | 'free' | 'premium'; limit: number; trialEligible: boolean; trialDays?: number }, used: number): Error {
    if (plan.kind === 'free') {
      return new UpgradeRequiredError('food_ai_unlimited', used, plan.limit, plan.trialEligible, plan.trialDays);
    }
    return new Error('RateLimited');
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

  /** Lifetime usage split: own account, mailbox group, attested device. */
  private static async lifetimeFoodAiUsage(
    userId: string
  ): Promise<{ used: number; ownUsed: number; deviceId: string | null; sharedLimitReason: 'device' | 'mailbox' | null }> {
    const supabase = createAdminSupabase();
    const [ids, deviceId] = await Promise.all([this.mailboxAccountIds(userId), this.attestedRequestDevice(userId)]);
    const accountQuery = supabase.from('nutrition_parse_log').select('*', { count: 'exact', head: true });
    const { count, error } = await (ids.length === 1 ? accountQuery.eq('user_id', userId) : accountQuery.in('user_id', ids));
    logIgnoredQueryError('UsageService.countFoodAi', error);
    const groupUsed = count ?? 0;
    let ownUsed = groupUsed;
    if (ids.length > 1) {
      const { count: own } = await supabase.from('nutrition_parse_log').select('*', { count: 'exact', head: true }).eq('user_id', userId);
      ownUsed = own ?? 0;
    }
    let deviceUsed = 0;
    if (deviceId) {
      const { count: deviceCount, error: deviceError } = await supabase
        .from('nutrition_parse_log')
        .select('*', { count: 'exact', head: true })
        .eq('device_id', deviceId);
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
   * Fitzy / nutrition-coach quota. Historically uncapped, so gate-dark is a no-op.
   * Trial-first (TRIAL_FIRST_SPEC §1): free = 0 messages/day once the gate is live, so a
   * free user's FIRST message throws UpgradeRequiredError here — before any conversation
   * write, message log or model call. Pro (incl. trialing) keeps the 200/day abuse ceiling.
   */
  static async assertFitzyQuota(userId: string, opts: { onboarding?: boolean } = {}): Promise<void> {
    const gateLive = await this.isGateLive('fitzy_unlimited');
    if (!gateLive) return;

    const [profile, used] = await Promise.all([
      this.getProfileForGate(userId),
      this.countToday('fitzy_message_log', userId),
    ]);
    const tier = profile.tier;
    const limit = tier === 'free' ? await this.freeFitzyLimit(userId, profile.signupAt) : TIER_LIMITS.premium.fitzyMessagesPerDay;
    // The onboarding tour's "Ask Fitzy" step (context 'onboarding') stays answerable for free users
    // who haven't finished onboarding — shipped apps show a dead-end error there, not the paywall.
    // Narrow on purpose: unfinished onboarding only, ONBOARDING_FREE_FITZY_MESSAGES per day.
    if (tier === 'free' && opts.onboarding && profile.onboardingCompleted !== true && used < ONBOARDING_FREE_FITZY_MESSAGES) return;
    if (used >= limit) {
      if (tier === 'free') throw new UpgradeRequiredError('fitzy_unlimited', used, limit, profile.trialEligible, await TrialConfig.days(userId));
      throw new Error('RateLimited');
    }
  }

  /**
   * Fitzy tier + messages left today (FITZY_V2_SPEC §6). `remaining` is null
   * when uncapped for this user (Pro, or the free gate is still dark). Call
   * after recordFitzyMessage so the count includes the current message.
   */
  static async fitzyAllowance(userId: string): Promise<{ tier: 'free' | 'pro'; remaining: number | null; limit: number | null }> {
    const [gateLive, tier] = await Promise.all([this.isGateLive('fitzy_unlimited'), this.getTier(userId)]);
    if (tier === 'premium') return { tier: 'pro', remaining: null, limit: null };
    if (!gateLive) return { tier: 'free', remaining: null, limit: null };
    const [used, limit] = await Promise.all([this.countToday('fitzy_message_log', userId), this.freeFitzyLimit(userId)]);
    return { tier: 'free', remaining: Math.max(0, limit - used), limit };
  }

  /** 'pro' for premium/enterprise subscribers (Fitzy Pro features: plans, memory, history). */
  static async fitzyTier(userId: string): Promise<'free' | 'pro'> {
    return (await this.getTier(userId)) === 'premium' ? 'pro' : 'free';
  }

  /**
   * Record one Fitzy/coach message. Called BEFORE the model call (insert-before-
   * call closes the check/insert race in the caller's favor, not the abuser's).
   */
  static async recordFitzyMessage(userId: string): Promise<void> {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from('fitzy_message_log').insert({ user_id: userId });
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
  ): Promise<{ tier: Tier; trialEligible: boolean; signupAt: string | null; onboardingCompleted: boolean | null }> {
    const supabase = createAdminSupabase();
    const { data, error: dataError } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_platform, trial_started_at, created_at, onboarding_completed')
      .eq('id', userId)
      .maybeSingle();
    logIgnoredQueryError('UsageService.getProfileForGate', dataError);
    const raw = data?.subscription_tier;
    return {
      tier: raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free',
      trialEligible: trialEligibleFromProfile(data ?? null),
      signupAt: typeof data?.created_at === 'string' ? data.created_at : null,
      onboardingCompleted: typeof data?.onboarding_completed === 'boolean' ? data.onboarding_completed : null,
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
