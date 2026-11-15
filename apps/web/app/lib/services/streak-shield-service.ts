/**
 * StreakShieldService — the ONLY owner of streak-shield (freeze) inventory.
 *
 * One inventory: the `streak_shields` table (one row per user per type:
 * freeze | milestone_shield | purchased). The legacy column
 * `engagement_streaks.streak_freezes_available` is kept as a read-only
 * MIRROR of the total so mobile clients in the field keep displaying a
 * correct number; nothing may decrement or grant against it directly.
 *
 * Economy (docs/STREAKS-SPEC.md):
 * - Pro (profiles.subscription_tier = premium/enterprise): unlimited —
 *   protection never decrements a balance, status reports unlimited: true.
 * - Free: earn exactly +1 each time the streak crosses a multiple of the earn
 *   interval (shieldsEarnedBetween), banked up to the max balance.
 * - Starter: a new user gets the starter balance once, at onboarding
 *   completion (grantOnboardingStarter, reason `onboarding_starter`); an
 *   inventory first created any other way is seeded with the same starter
 *   balance (reason `lazy_first_touch`). The grant is recorded on the freeze
 *   row's metadata.starter_grant, so it can never happen twice.
 * - Earn interval / starter count / max balance are remote config
 *   (lib/streaks/shield-rules.ts), resolved per user; never hard-code them.
 * - Consumption order: freeze → milestone_shield → purchased.
 * - Exhausted + free tier → NO_SHIELDS_AVAILABLE, which routes surface with
 *   an upsell hint so clients can open the Pro paywall.
 */

import { randomUUID } from 'crypto';

import { logIgnoredQueryError } from '@/lib/api/route-errors';

import { trackServerEventInBackground } from '../analytics/amplitude-server';
import { AnalyticsEvents, type ShieldGrantReason } from '../analytics/events.generated';
import { resolveShieldRules, type ShieldRules } from '../streaks/shield-rules';
import { addDays, localToday } from '../streaks/streak-calculator';
import {
  MILESTONES,
  shieldXpPrice,
  type StreakMilestoneDef,
} from '../streaks/streak-config';
import { createAdminSupabase } from '../supabase-admin';
import { StreakClaimError, CLAIM_ERROR_CODES } from '../types/streak-claiming';

import { normalizeTier } from './entitlement-service';

export type ShieldType = 'freeze' | 'milestone_shield' | 'purchased';

const CONSUME_ORDER: ShieldType[] = ['freeze', 'milestone_shield', 'purchased'];

/** How many paid boundary / celebrated milestone days to remember per user. */
const PAID_HISTORY_LIMIT = 200;

export interface ShieldInventory {
  available: number;
  unlimited: boolean;
  /** = rules.maxBalance (kept for the existing `cap` response fields). */
  cap: number;
  breakdown: Record<ShieldType, number>;
  /** The resolved economy for this user (serve as `shield_rules`). */
  rules: ShieldRules;
}

/** Why a starter balance was granted (freeze row metadata.starter_grant.reason). */
export type StarterGrantReason = 'onboarding_starter' | 'lazy_first_touch';

/** Recorded once per user on the freeze row's metadata. */
export interface StarterGrantRecord {
  reason: StarterGrantReason;
  /** Shields actually added by this grant (a top-up can add fewer than target). */
  count: number;
  /** The starter balance in force when the grant happened. */
  target: number;
  granted_at: string;
  /** Unique per grant attempt: tells a caller's own seed apart from a concurrent one. */
  grant_id: string;
}

export interface StarterGrantResult {
  /** Shields added by this call (0 when already granted or already at/above the target). */
  granted: number;
  /** True when a starter grant had already been recorded (retry / replay / lazy seed). */
  alreadyGranted: boolean;
  /** Total balance after the call. */
  available: number;
  reason: StarterGrantReason;
}

/** Outcome of awarding shields + milestones for a streak that grew. */
export interface StreakGrowthAward {
  /** Shields actually banked by this call (0 when capped out or Pro). */
  credited: number;
  /** Shields the growth earned before the balance cap was applied. */
  earned: number;
  /** True when at least one earned shield was dropped because the bank is full. */
  capped: boolean;
  /** The highest milestone this growth newly reached that hasn't been celebrated yet. */
  milestone: StreakMilestoneDef | null;
}

export interface ConsumeResult {
  consumedType: ShieldType | 'pro_unlimited';
  remaining: number;
  unlimited: boolean;
}

export const SHIELD_PURCHASE_ERROR_CODES = {
  /** No XP price is configured (STREAK_SHIELD_XP_PRICE switched it off). */
  PRICE_NOT_CONFIGURED: 'PRICE_NOT_CONFIGURED',
  /** Migration 095 (engagement_streaks.points_spent) has not been applied. */
  XP_LEDGER_UNAVAILABLE: 'XP_LEDGER_UNAVAILABLE',
  /** Pro users have unlimited shields; there is nothing to buy. */
  SHIELDS_UNLIMITED: 'SHIELDS_UNLIMITED',
  MAX_SHIELDS_REACHED: 'MAX_SHIELDS_REACHED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  /** Another purchase for the same user settled first (double tap). */
  PURCHASE_IN_PROGRESS: 'PURCHASE_IN_PROGRESS',
  /** Any payment method other than XP: there is no verified payment to settle. */
  PAYMENT_NOT_SUPPORTED: 'PAYMENT_NOT_SUPPORTED',
} as const;

export type ShieldPurchaseErrorCode =
  (typeof SHIELD_PURCHASE_ERROR_CODES)[keyof typeof SHIELD_PURCHASE_ERROR_CODES];

export class ShieldPurchaseError extends Error {
  constructor(
    message: string,
    public code: ShieldPurchaseErrorCode,
    public status: number,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ShieldPurchaseError';
  }
}

export interface ShieldPurchaseResult {
  payment_method: 'xp';
  /** XP charged for this purchase. */
  xp_spent: number;
  /** Spendable XP left: total earned minus total spent. */
  xp_remaining: number;
  /** Shields the user holds after the purchase. */
  new_freeze_count: number;
}

/** Spendable XP for a user. */
export interface XpBalance {
  /** Lifetime XP earned (engagement_streaks.total_points). */
  earned: number;
  /** Lifetime XP spent (engagement_streaks.points_spent, migration 095). */
  spent: number;
  balance: number;
}

const OPTIMISTIC_RETRIES = 3;

/** PostgREST / Postgres errors that mean "this column does not exist (yet)". */
function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /points_spent/.test(error.message || '') && /does not exist|schema cache/i.test(error.message || '');
}

export class StreakShieldService {
  /** Pro users get unlimited shields. Tier cache is written by the RC webhook. */
  static async hasUnlimitedShields(userId: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data, error: dataError } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();
    logIgnoredQueryError('StreakShieldService.hasUnlimitedShields', dataError);
    return normalizeTier(data?.subscription_tier) === 'premium';
  }

  /**
   * Current inventory + unlimited flag + resolved rules. Creates the starter
   * rows on first touch (starter balance = rules.starterCount, recorded as a
   * `lazy_first_touch` starter grant so onboarding completion never adds a
   * second starter on top).
   */
  static async getInventory(userId: string, opts: { rules?: ShieldRules } = {}): Promise<ShieldInventory> {
    const supabase = createAdminSupabase();

    const [{ data: rows }, unlimited, rules] = await Promise.all([
      supabase.from('streak_shields').select('shield_type, available_count').eq('user_id', userId),
      this.hasUnlimitedShields(userId),
      opts.rules ? Promise.resolve(opts.rules) : resolveShieldRules(userId),
    ]);

    let effectiveRows = rows;
    if (!rows || rows.length === 0) {
      effectiveRows = (await this.seedStarterRows(userId, rules, 'lazy_first_touch')).rows;
    }
    const breakdown = this.breakdownOf(effectiveRows);
    const available = breakdown.freeze + breakdown.milestone_shield + breakdown.purchased;
    if (!rows || rows.length === 0) {
      // Keep the legacy mirror truthful from the very first touch.
      await this.mirrorLegacyBalance(userId, available, rules.maxBalance);
    }

    return { available, unlimited, cap: rules.maxBalance, breakdown, rules };
  }

  private static breakdownOf(
    rows: Array<{ shield_type: string; available_count: number | null }> | null | undefined
  ): Record<ShieldType, number> {
    const breakdown: Record<ShieldType, number> = { freeze: 0, milestone_shield: 0, purchased: 0 };
    for (const row of rows || []) {
      if (row.shield_type in breakdown) {
        breakdown[row.shield_type as ShieldType] = row.available_count || 0;
      }
    }
    return breakdown;
  }

  /**
   * Seed the three inventory rows with the starter balance. Re-reads
   * afterwards — if a concurrent call seeded first (ignoreDuplicates), the
   * rows it wrote are the truth, not our optimistic guess.
   */
  private static async seedStarterRows(
    userId: string,
    rules: ShieldRules,
    reason: StarterGrantReason
  ): Promise<{ rows: Array<{ shield_type: string; available_count: number }> | null; grantId: string }> {
    const supabase = createAdminSupabase();
    const starter_grant: StarterGrantRecord = {
      reason,
      count: rules.starterCount,
      target: rules.starterCount,
      granted_at: new Date().toISOString(),
      grant_id: randomUUID(),
    };
    const { error: seedError } = await supabase.from('streak_shields').upsert(
      [
        { user_id: userId, shield_type: 'freeze', available_count: rules.starterCount, metadata: { starter_grant } },
        { user_id: userId, shield_type: 'milestone_shield', available_count: 0 },
        { user_id: userId, shield_type: 'purchased', available_count: 0 },
      ],
      { onConflict: 'user_id,shield_type', ignoreDuplicates: true }
    );
    logIgnoredQueryError('StreakShieldService.seedStarterRows', seedError);
    const { data: seeded, error: seededError } = await supabase
      .from('streak_shields')
      .select('shield_type, available_count, metadata')
      .eq('user_id', userId);
    logIgnoredQueryError('StreakShieldService.getInventory', seededError);
    // Only the call whose seed actually landed reports the grant.
    const freeze = (seeded || []).find(r => r.shield_type === 'freeze');
    const landed = (freeze?.metadata as { starter_grant?: StarterGrantRecord } | null)?.starter_grant?.grant_id === starter_grant.grant_id;
    if (landed) recordShieldGranted(userId, reason, starter_grant.count, `starter:${starter_grant.grant_id}`);
    return { rows: seeded, grantId: starter_grant.grant_id };
  }

  /**
   * Grant the starter balance when a user completes onboarding. Idempotent:
   *
   * - No inventory yet → seed it at the starter balance (reason onboarding_starter).
   * - Inventory exists and a starter grant is already recorded (lazy first
   *   touch, an earlier completion, a retry or a replay) → no-op.
   * - Inventory exists without a recorded grant (created before this rule
   *   shipped) → TOP UP to the starter balance once (never +starter on top,
   *   never lowers a balance) and record the grant.
   *
   * Applies to Pro users too (harmless while unlimited, useful if Pro lapses).
   * Never retroactive for existing users: callers only invoke it for a user
   * whose onboarding is completing now (see AssessmentService.completeOnboarding).
   */
  static async grantOnboardingStarter(
    userId: string,
    opts: { rules?: ShieldRules } = {}
  ): Promise<StarterGrantResult> {
    const reason: StarterGrantReason = 'onboarding_starter';
    const supabase = createAdminSupabase();
    const rules = opts.rules ?? (await resolveShieldRules(userId));

    // grant_id of the seed THIS call wrote, so a re-read can tell our seed
    // (granted) from a concurrent seed or an earlier completion (no-op).
    let seededId: string | null = null;
    for (let attempt = 0; attempt < OPTIMISTIC_RETRIES; attempt++) {
      const { data: rows, error: readError } = await supabase
        .from('streak_shields')
        .select('shield_type, available_count, metadata')
        .eq('user_id', userId);
      if (readError) throw readError;

      if (!rows || rows.length === 0) {
        const seeded = await this.seedStarterRows(userId, rules, reason);
        seededId = seeded.grantId;
        const available = Object.values(this.breakdownOf(seeded.rows)).reduce((a, b) => a + b, 0);
        await this.mirrorLegacyBalance(userId, available, rules.maxBalance);
        // Re-loop: if a concurrent lazy seed won, its marker is what we read next.
        continue;
      }

      const breakdown = this.breakdownOf(rows);
      const available = breakdown.freeze + breakdown.milestone_shield + breakdown.purchased;
      const freezeRow = rows.find(r => r.shield_type === 'freeze');
      const metadata = ((freezeRow?.metadata as Record<string, unknown>) || {});
      const recorded = metadata.starter_grant as StarterGrantRecord | undefined;
      if (recorded) {
        const ours = seededId !== null && recorded.grant_id === seededId;
        return { granted: ours ? recorded.count : 0, alreadyGranted: !ours, available, reason };
      }

      const topUp = Math.max(0, rules.starterCount - available);
      const starter_grant: StarterGrantRecord = {
        reason,
        count: topUp,
        target: rules.starterCount,
        granted_at: new Date().toISOString(),
        grant_id: randomUUID(),
      };

      if (!freezeRow) {
        const { error: insertError } = await supabase.from('streak_shields').insert({
          user_id: userId,
          shield_type: 'freeze',
          available_count: topUp,
          metadata: { starter_grant },
        });
        if (insertError && insertError.code !== '23505') throw insertError;
        if (insertError) continue; // concurrent insert won — re-read
      } else {
        const seen = breakdown.freeze;
        const { data: updated, error } = await supabase
          .from('streak_shields')
          .update({ available_count: seen + topUp, metadata: { ...metadata, starter_grant } })
          .eq('user_id', userId)
          .eq('shield_type', 'freeze')
          .eq('available_count', seen)
          .select('available_count');
        if (error) throw error;
        if (!updated || updated.length === 0) continue; // lost a race — re-read
      }

      if (topUp > 0) {
        await this.mirrorLegacyBalance(userId, available + topUp, rules.maxBalance);
        recordShieldGranted(userId, reason, topUp, `starter:${starter_grant.grant_id}`);
      }
      return { granted: topUp, alreadyGranted: false, available: available + topUp, reason };
    }

    throw new Error('Could not record the onboarding starter shields after several attempts');
  }

  /**
   * Consume one shield to protect `dateStr` (YYYY-MM-DD, user-local).
   *
   * Pro: records the protection without decrementing anything.
   * Free: atomically decrements the first non-empty balance in
   * CONSUME_ORDER — the UPDATE carries a `available_count = <seen>` guard
   * so two concurrent consumers can't both spend the same shield; a lost
   * race just retries the next type or throws NO_SHIELDS_AVAILABLE.
   *
   * Callers are responsible for inserting the protecting `streak_claims`
   * row (they know method/timezone/metadata); this method only settles the
   * inventory and mirrors the legacy column.
   */
  static async consume(userId: string): Promise<ConsumeResult> {
    const supabase = createAdminSupabase();

    // getInventory already resolves the tier — one lookup serves both checks.
    const inventory = await this.getInventory(userId);
    if (inventory.unlimited) {
      return { consumedType: 'pro_unlimited', remaining: Infinity as unknown as number, unlimited: true };
    }

    if (inventory.available <= 0) {
      throw new StreakClaimError('No shields available', CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE, {
        upsell: 'pro_unlimited_shields',
      });
    }

    for (const type of CONSUME_ORDER) {
      const count = inventory.breakdown[type];
      if (count <= 0) continue;

      // Optimistic-concurrency decrement: only applies if the count we read
      // is still the count in the row.
      const { data: updated, error } = await supabase
        .from('streak_shields')
        .update({ available_count: count - 1 })
        .eq('user_id', userId)
        .eq('shield_type', type)
        .eq('available_count', count)
        .select('available_count');

      if (error) throw error;
      if (updated && updated.length > 0) {
        const remaining = inventory.available - 1;
        await this.mirrorLegacyBalance(userId, remaining, inventory.rules.maxBalance);
        return { consumedType: type, remaining, unlimited: false };
      }
      // Lost a race on this row — fall through and try the next type.
    }

    throw new StreakClaimError('No shields available', CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE, {
      upsell: 'pro_unlimited_shields',
    });
  }

  /**
   * Award shields + milestone for a streak that grew from oldStreak to
   * newStreak, where the run ends on `runEndDay` (user-local YYYY-MM-DD:
   * today if today is claimed, otherwise yesterday).
   *
   * Every weekly/monthly boundary is anchored to the CALENDAR DAY the run
   * crossed it (runEndDay - (newStreak - k*interval)). A boundary day is
   * paid at most once, ever — recorded in the milestone_shield row's
   * metadata. That makes awards path-independent: a retroactive claim that
   * bridges a gap and merges two runs re-crosses the older run's boundaries
   * on the SAME days, so they're recognised as already paid, while an honest
   * new run after a break crosses boundaries on new days and earns normally.
   * (This replaced a rolling "2 awards / 7 days" rate limit, which merely
   * slowed break-and-repair farming and also truncated honest catch-ups.)
   *
   * Milestone celebrations are deduped the same way so a merged run doesn't
   * re-fire "1-Week Warrior".
   *
   * Credited shields are banked into milestone_shield, capped at the
   * resolved max balance across all types. Pro users never bank (unlimited).
   */
  static async awardForStreakGrowth(
    userId: string,
    params: { oldStreak: number; newStreak: number; runEndDay?: string }
  ): Promise<StreakGrowthAward> {
    const { oldStreak, newStreak } = params;
    const none: StreakGrowthAward = { credited: 0, earned: 0, capped: false, milestone: null };
    if (newStreak <= oldStreak) return none;

    const runEndDay = params.runEndDay || localToday();
    const dayForStreakValue = (value: number) => addDays(runEndDay, -(newStreak - value));

    const supabase = createAdminSupabase();
    const inventory = await this.getInventory(userId);

    const { data: milestoneRow, error: milestoneRowError } = await supabase
      .from('streak_shields')
      .select('available_count, metadata')
      .eq('user_id', userId)
      .eq('shield_type', 'milestone_shield')
      .maybeSingle();
    logIgnoredQueryError('StreakShieldService.awardForStreakGrowth', milestoneRowError);
    const metadata: Record<string, unknown> = (milestoneRow?.metadata as Record<string, unknown>) || {};
    const paidBoundaries = new Set<string>((metadata.paid_boundaries as string[]) || []);
    const celebrated = new Set<string>((metadata.celebrated_milestone_days as string[]) || []);

    // Boundary days crossed by this growth that were never paid before. One
    // shield per multiple of the (remote-config) earn interval. A calendar day
    // pays at most one shield ever, whatever interval paid it: entries are
    // stored as `<interval>:<day>` (older rows also hold `30:<day>` from the
    // retired monthly bonus), and the day part alone decides "already paid", so
    // an admin changing the interval can't make a merged run re-pay old days.
    const paidDays = new Set([...paidBoundaries].map(key => key.slice(key.indexOf(':') + 1)));
    const interval = inventory.rules.earnIntervalDays;
    const newlyPaid: string[] = [];
    for (let k = Math.floor(oldStreak / interval) + 1; k * interval <= newStreak; k++) {
      const day = dayForStreakValue(k * interval);
      if (!paidDays.has(day)) newlyPaid.push(`${interval}:${day}`);
    }
    const earned = newlyPaid.length;

    // Highest milestone newly reached whose day hasn't been celebrated.
    let milestone: StreakMilestoneDef | null = null;
    const newlyCelebrated: string[] = [];
    for (const m of MILESTONES) {
      if (m.days <= oldStreak || m.days > newStreak) continue;
      const day = dayForStreakValue(m.days);
      if (celebrated.has(day)) continue;
      newlyCelebrated.push(day);
      milestone = m; // MILESTONES is sorted ascending → last one wins
    }

    if (earned === 0 && newlyCelebrated.length === 0) return none;

    const capHeadroom = inventory.unlimited
      ? 0
      : Math.max(0, inventory.rules.maxBalance - inventory.available);
    const credited = Math.min(earned, capHeadroom);
    const capped = !inventory.unlimited && earned > credited;

    const nextMetadata = {
      ...metadata,
      paid_boundaries: [...paidBoundaries, ...newlyPaid].slice(-PAID_HISTORY_LIMIT),
      celebrated_milestone_days: [...celebrated, ...newlyCelebrated].slice(-PAID_HISTORY_LIMIT),
      last_award_at: new Date().toISOString(),
    };

    // Optimistic-concurrency write: only apply if the milestone_shield count
    // is still what we read, so a concurrent consume/earn can't be lost.
    const seen = milestoneRow?.available_count ?? inventory.breakdown.milestone_shield;
    const { data: updated, error } = await supabase
      .from('streak_shields')
      .update({ available_count: seen + credited, metadata: nextMetadata })
      .eq('user_id', userId)
      .eq('shield_type', 'milestone_shield')
      .eq('available_count', seen)
      .select('available_count');
    if (error) throw error;
    if (!updated || updated.length === 0) {
      // Lost the race — the balance moved under us. Retry once from fresh
      // state; a second loss means another writer already handled it.
      if (!(params as { _retried?: boolean })._retried) {
        return this.awardForStreakGrowth(userId, { ...params, _retried: true } as typeof params);
      }
      return { credited: 0, earned, capped, milestone };
    }

    if (credited > 0) {
      await this.mirrorLegacyBalance(userId, inventory.available + credited, inventory.rules.maxBalance);
      recordShieldGranted(userId, 'streak_earned', credited);
    }
    return { credited, earned, capped, milestone };
  }

  /**
   * Shields credited for a streak growing oldStreak → newStreak. Thin
   * wrapper over awardForStreakGrowth for callers that only bank shields.
   */
  static async earnForStreakIncrease(
    userId: string,
    oldStreak: number,
    newStreak: number,
    runEndDay?: string
  ): Promise<number> {
    const award = await this.awardForStreakGrowth(userId, { oldStreak, newStreak, runEndDay });
    return award.credited;
  }

  /**
   * Refund one shield of the given type (e.g. a duplicate-protection race
   * consumed a shield for a day that was already covered). Keeps the legacy
   * mirror in sync.
   */
  static async refund(userId: string, type: ShieldType): Promise<void> {
    const supabase = createAdminSupabase();
    for (let attempt = 0; attempt < 2; attempt++) {
      const inventory = await this.getInventory(userId);
      // Cap against the WHOLE bank, not the single row — a refund must never
      // push the total past the max balance.
      if (inventory.available >= inventory.rules.maxBalance) return;
      const seen = inventory.breakdown[type];

      const { data: updated, error } = await supabase
        .from('streak_shields')
        .update({ available_count: seen + 1 })
        .eq('user_id', userId)
        .eq('shield_type', type)
        .eq('available_count', seen)
        .select('available_count');
      if (error) throw error;
      if (updated && updated.length > 0) {
        await this.mirrorLegacyBalance(userId, inventory.available + 1, inventory.rules.maxBalance);
        return;
      }
      // Lost a race — re-read and try once more.
    }
    console.error(`[StreakShieldService.refund] gave up refunding ${type} for ${userId} after a race`);
  }

  // ==========================================================================
  // XP PURCHASE
  // ==========================================================================

  /**
   * Spendable XP = total_points (earned, only ever grows) - points_spent.
   * Spending is tracked in its own column so the check-in's
   * read-modify-write of total_points can never undo a charge.
   *
   * Throws XP_LEDGER_UNAVAILABLE while migration 095 is not applied.
   */
  static async getXpBalance(userId: string): Promise<XpBalance> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('engagement_streaks')
      .select('total_points, points_spent')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error)) {
        throw new ShieldPurchaseError(
          'Buying shields with XP is not available yet',
          SHIELD_PURCHASE_ERROR_CODES.XP_LEDGER_UNAVAILABLE,
          503
        );
      }
      throw error;
    }

    const earned = Math.max(0, Number(data?.total_points) || 0);
    const spent = Math.max(0, Number(data?.points_spent) || 0);
    return { earned, spent, balance: Math.max(0, earned - spent) };
  }

  /**
   * Buy one shield with XP: check the balance, charge, grant.
   *
   * The charge is a conditional UPDATE guarded by the `points_spent` value
   * that was read, and the number of affected rows is checked. Two requests
   * racing (a double tap) read the same value, only one UPDATE matches a row,
   * and the loser is refused with PURCHASE_IN_PROGRESS without granting
   * anything. If the grant fails after a successful charge the XP is refunded.
   *
   * Never grants a shield without a successful charge.
   */
  static async purchaseWithXp(userId: string): Promise<ShieldPurchaseResult> {
    const price = shieldXpPrice();
    if (price === null) {
      throw new ShieldPurchaseError(
        'Buying shields with XP is not available: no price is configured',
        SHIELD_PURCHASE_ERROR_CODES.PRICE_NOT_CONFIGURED,
        503
      );
    }

    const inventory = await this.getInventory(userId);
    if (inventory.unlimited) {
      throw new ShieldPurchaseError(
        'Pro members already have unlimited shields',
        SHIELD_PURCHASE_ERROR_CODES.SHIELDS_UNLIMITED,
        400
      );
    }
    if (inventory.available >= inventory.rules.maxBalance) {
      throw new ShieldPurchaseError(
        'You already have the maximum number of shields',
        SHIELD_PURCHASE_ERROR_CODES.MAX_SHIELDS_REACHED,
        400,
        { cap: inventory.rules.maxBalance, available: inventory.available }
      );
    }

    const xp = await this.getXpBalance(userId);
    if (xp.balance < price) {
      throw new ShieldPurchaseError(
        `Not enough XP: a shield costs ${price} XP and you have ${xp.balance}`,
        SHIELD_PURCHASE_ERROR_CODES.INSUFFICIENT_BALANCE,
        400,
        { price, xp_balance: xp.balance, xp_missing: price - xp.balance }
      );
    }

    // CHARGE — applies only if nobody spent XP since the balance was read.
    const supabase = createAdminSupabase();
    const { data: charged, error: chargeError } = await supabase
      .from('engagement_streaks')
      .update({ points_spent: xp.spent + price })
      .eq('user_id', userId)
      .eq('points_spent', xp.spent)
      .gte('total_points', xp.spent + price)
      .select('total_points, points_spent');

    if (chargeError) {
      if (isMissingColumnError(chargeError)) {
        throw new ShieldPurchaseError(
          'Buying shields with XP is not available yet',
          SHIELD_PURCHASE_ERROR_CODES.XP_LEDGER_UNAVAILABLE,
          503
        );
      }
      throw chargeError;
    }
    if (!charged || charged.length === 0) {
      throw new ShieldPurchaseError(
        'Another purchase is already being processed. Check your shields and try again.',
        SHIELD_PURCHASE_ERROR_CODES.PURCHASE_IN_PROGRESS,
        409
      );
    }

    // GRANT — refund the charge if the shield cannot be banked.
    let newCount: number | null = null;
    try {
      newCount = await this.grantOnePurchased(userId);
    } catch (grantError) {
      await this.refundXp(userId, price);
      throw grantError;
    }
    if (newCount === null) {
      await this.refundXp(userId, price);
      throw new ShieldPurchaseError(
        'You already have the maximum number of shields',
        SHIELD_PURCHASE_ERROR_CODES.MAX_SHIELDS_REACHED,
        400,
        { cap: inventory.rules.maxBalance }
      );
    }

    const earnedNow = Math.max(0, Number(charged[0]?.total_points) || xp.earned);
    return {
      payment_method: 'xp',
      xp_spent: price,
      xp_remaining: Math.max(0, earnedNow - (xp.spent + price)),
      new_freeze_count: newCount,
    };
  }

  /**
   * Bank exactly one purchased shield with an optimistic-concurrency UPDATE.
   * Returns the new total, or null when the bank is full.
   */
  private static async grantOnePurchased(userId: string): Promise<number | null> {
    const supabase = createAdminSupabase();

    for (let attempt = 0; attempt < OPTIMISTIC_RETRIES; attempt++) {
      const inventory = await this.getInventory(userId);
      if (inventory.available >= inventory.rules.maxBalance) return null;
      const seen = inventory.breakdown.purchased;

      const { data: updated, error } = await supabase
        .from('streak_shields')
        .update({ available_count: seen + 1 })
        .eq('user_id', userId)
        .eq('shield_type', 'purchased')
        .eq('available_count', seen)
        .select('available_count');
      if (error) throw error;

      if (updated && updated.length > 0) {
        const total = inventory.available + 1;
        await this.mirrorLegacyBalance(userId, total, inventory.rules.maxBalance);
        recordShieldGranted(userId, 'purchased', 1);
        return total;
      }

      if (seen === 0) {
        // The user has shield rows but no 'purchased' row yet: create it. A
        // concurrent insert loses on the unique key and the loop re-reads.
        const { error: insertError } = await supabase
          .from('streak_shields')
          .insert({ user_id: userId, shield_type: 'purchased', available_count: 1 });
        if (!insertError) {
          const total = inventory.available + 1;
          await this.mirrorLegacyBalance(userId, total, inventory.rules.maxBalance);
          recordShieldGranted(userId, 'purchased', 1);
          return total;
        }
        if (insertError.code !== '23505') throw insertError;
      }
      // Lost a race on the row — re-read and try again.
    }

    throw new Error('Could not bank the purchased shield after several attempts');
  }

  /** Give back XP charged for a shield that could not be granted. */
  private static async refundXp(userId: string, amount: number): Promise<void> {
    const supabase = createAdminSupabase();
    try {
      for (let attempt = 0; attempt < OPTIMISTIC_RETRIES; attempt++) {
        const { data: row, error: readError } = await supabase
          .from('engagement_streaks')
          .select('points_spent')
          .eq('user_id', userId)
          .maybeSingle();
        if (readError) throw readError;
        const seen = Math.max(0, Number(row?.points_spent) || 0);

        const { data: updated, error } = await supabase
          .from('engagement_streaks')
          .update({ points_spent: Math.max(0, seen - amount) })
          .eq('user_id', userId)
          .eq('points_spent', seen)
          .select('points_spent');
        if (error) throw error;
        if (updated && updated.length > 0) return;
      }
      console.error(`[StreakShieldService.refundXp] gave up refunding ${amount} XP for ${userId} after a race`);
    } catch (e) {
      // Needs a manual correction: the user was charged and got no shield.
      console.error(`[StreakShieldService.refundXp] FAILED to refund ${amount} XP for ${userId}:`, e);
    }
  }

  /**
   * Credit shields for a purchase that was ALREADY settled and verified by the
   * caller (IAP receipt / promo). Also capped. This method charges nothing:
   * never call it from a route on the strength of a client's say-so.
   */
  static async creditPurchased(userId: string, count: number): Promise<number> {
    if (count <= 0) return 0;
    const supabase = createAdminSupabase();
    const inventory = await this.getInventory(userId);
    const credited = Math.min(count, Math.max(0, inventory.rules.maxBalance - inventory.available));
    if (credited <= 0) return 0;

    const { error } = await supabase.from('streak_shields').upsert(
      {
        user_id: userId,
        shield_type: 'purchased',
        available_count: inventory.breakdown.purchased + credited,
      },
      { onConflict: 'user_id,shield_type' }
    );
    if (error) throw error;

    await this.mirrorLegacyBalance(userId, inventory.available + credited, inventory.rules.maxBalance);
    recordShieldGranted(userId, 'purchased', credited);
    return credited;
  }

  /**
   * Keep the legacy `engagement_streaks.streak_freezes_available` column in
   * sync so pre-update mobile clients keep showing a truthful count.
   */
  private static async mirrorLegacyBalance(userId: string, total: number, maxBalance: number): Promise<void> {
    const supabase = createAdminSupabase();
    const mirrored = Math.max(0, Math.min(total, maxBalance));
    // Upsert so a user whose engagement_streaks row hasn't been created yet
    // still gets a truthful mirror instead of a silent no-op.
    const { error } = await supabase
      .from('engagement_streaks')
      .upsert({ user_id: userId, streak_freezes_available: mirrored }, { onConflict: 'user_id' });
    // Mirror failures must never fail the primary operation.
    if (error) console.error('[StreakShieldService.mirrorLegacyBalance] Error:', error);
  }
}

/**
 * Server-side `Streak Shield Granted` Amplitude event (tracking plan v35): one per
 * grant that banked > 0 shields. Fire-and-forget after the response, never throws,
 * no-op without AMPLITUDE_SERVER_API_KEY. `dedupeKey` becomes the insert_id so a
 * replayed starter grant can't double-count.
 */
export function recordShieldGranted(userId: string, reason: ShieldGrantReason, count: number, dedupeKey?: string): void {
  if (count <= 0) return;
  try {
    const e = AnalyticsEvents.streakShieldGranted({ reason, count });
    trackServerEventInBackground(
      {
        event_type: e.name,
        user_id: userId,
        event_properties: { ...e.properties },
        ...(dedupeKey ? { insert_id: `shield-grant:${dedupeKey}` } : {}),
      },
      e.name
    );
  } catch (err: any) {
    console.warn('[shields] grant event failed:', err?.message ?? err);
  }
}

/** How long after onboarding completion a retried completion may still settle the starter grant. */
export const STARTER_GRANT_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * True when onboarding completed within STARTER_GRANT_RETRY_WINDOW_MS of `now`.
 * Lets a retried completion call (first one failed after the profile update)
 * still grant the starter shields, while users who completed onboarding long
 * ago never get a retroactive grant by calling the endpoint again.
 */
export function isRecentCompletion(completedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!completedAt) return false;
  const at = Date.parse(completedAt);
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= -60_000 && age <= STARTER_GRANT_RETRY_WINDOW_MS;
}

/**
 * Onboarding-completion hook: grant the starter shields (idempotent, see
 * StreakShieldService.grantOnboardingStarter). Never throws — a failure here
 * must not fail onboarding; the lazy seed in getInventory is the fallback.
 */
export async function grantStarterShields(userId: string): Promise<StarterGrantResult | null> {
  try {
    const result = await StreakShieldService.grantOnboardingStarter(userId);
    if (result.granted > 0) {
      console.log(`[shields] onboarding_starter: +${result.granted} for ${userId} (balance ${result.available})`);
    }
    return result;
  } catch (e: any) {
    console.error('[shields] onboarding_starter grant failed (non-blocking):', e?.message ?? e);
    return null;
  }
}
