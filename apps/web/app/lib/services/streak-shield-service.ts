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
 * - Free: earn +1 per 7-day streak milestone and +1 extra per 30-day
 *   milestone (shieldsEarnedBetween), banked up to MAX_SHIELD_BALANCE.
 * - Consumption order: freeze → milestone_shield → purchased.
 * - Exhausted + free tier → NO_SHIELDS_AVAILABLE, which routes surface with
 *   an upsell hint so clients can open the Pro paywall.
 */

import { createAdminSupabase } from '../supabase-admin';
import { StreakClaimError, CLAIM_ERROR_CODES } from '../types/streak-claiming';
import {
  MILESTONES,
  SHIELD_RULES,
  shieldXpPrice,
  type StreakMilestoneDef,
} from '../streaks/streak-config';
import { addDays, localToday } from '../streaks/streak-calculator';
import { normalizeTier } from './entitlement-service';

export type ShieldType = 'freeze' | 'milestone_shield' | 'purchased';

const CONSUME_ORDER: ShieldType[] = ['freeze', 'milestone_shield', 'purchased'];

/** How many paid boundary / celebrated milestone days to remember per user. */
const PAID_HISTORY_LIMIT = 200;

export interface ShieldInventory {
  available: number;
  unlimited: boolean;
  cap: number;
  breakdown: Record<ShieldType, number>;
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
    const { data } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();
    return normalizeTier(data?.subscription_tier) === 'premium';
  }

  /** Current inventory + unlimited flag. Creates starter rows on first touch. */
  static async getInventory(userId: string): Promise<ShieldInventory> {
    const supabase = createAdminSupabase();

    const [{ data: rows }, unlimited] = await Promise.all([
      supabase.from('streak_shields').select('shield_type, available_count').eq('user_id', userId),
      this.hasUnlimitedShields(userId),
    ]);

    const breakdown: Record<ShieldType, number> = {
      freeze: 0,
      milestone_shield: 0,
      purchased: 0,
    };

    let effectiveRows = rows;
    if (!rows || rows.length === 0) {
      // First touch: seed the starter shield so a new user's first slip
      // doesn't kill the habit. Re-read afterwards — if a concurrent call
      // seeded first (ignoreDuplicates), the rows it wrote are the truth,
      // not our optimistic STARTER_SHIELDS guess.
      await supabase.from('streak_shields').upsert(
        [
          { user_id: userId, shield_type: 'freeze', available_count: SHIELD_RULES.STARTER_SHIELDS },
          { user_id: userId, shield_type: 'milestone_shield', available_count: 0 },
          { user_id: userId, shield_type: 'purchased', available_count: 0 },
        ],
        { onConflict: 'user_id,shield_type', ignoreDuplicates: true }
      );
      const { data: seeded } = await supabase
        .from('streak_shields')
        .select('shield_type, available_count')
        .eq('user_id', userId);
      effectiveRows = seeded;
    }
    for (const row of effectiveRows || []) {
      if (row.shield_type in breakdown) {
        breakdown[row.shield_type as ShieldType] = row.available_count || 0;
      }
    }

    const available = breakdown.freeze + breakdown.milestone_shield + breakdown.purchased;
    if (!rows || rows.length === 0) {
      // Keep the legacy mirror truthful from the very first touch.
      await this.mirrorLegacyBalance(userId, available);
    }

    return {
      available,
      unlimited,
      cap: SHIELD_RULES.MAX_SHIELD_BALANCE,
      breakdown,
    };
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
        await this.mirrorLegacyBalance(userId, remaining);
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
   * Credited shields are banked into milestone_shield, capped at
   * MAX_SHIELD_BALANCE across all types. Pro users never bank (unlimited).
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

    const { data: milestoneRow } = await supabase
      .from('streak_shields')
      .select('available_count, metadata')
      .eq('user_id', userId)
      .eq('shield_type', 'milestone_shield')
      .maybeSingle();
    const metadata: Record<string, unknown> = (milestoneRow?.metadata as Record<string, unknown>) || {};
    const paidBoundaries = new Set<string>((metadata.paid_boundaries as string[]) || []);
    const celebrated = new Set<string>((metadata.celebrated_milestone_days as string[]) || []);

    // Boundary days crossed by this growth that were never paid before.
    const newlyPaid: string[] = [];
    for (const interval of [SHIELD_RULES.WEEKLY_EARN_INTERVAL, SHIELD_RULES.MONTHLY_EARN_INTERVAL]) {
      for (let k = Math.floor(oldStreak / interval) + 1; k * interval <= newStreak; k++) {
        const day = `${interval}:${dayForStreakValue(k * interval)}`;
        if (!paidBoundaries.has(day)) newlyPaid.push(day);
      }
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
      : Math.max(0, SHIELD_RULES.MAX_SHIELD_BALANCE - inventory.available);
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

    if (credited > 0) await this.mirrorLegacyBalance(userId, inventory.available + credited);
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
      // push the total past MAX_SHIELD_BALANCE.
      if (inventory.available >= SHIELD_RULES.MAX_SHIELD_BALANCE) return;
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
        await this.mirrorLegacyBalance(userId, inventory.available + 1);
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
    if (inventory.available >= SHIELD_RULES.MAX_SHIELD_BALANCE) {
      throw new ShieldPurchaseError(
        'You already have the maximum number of shields',
        SHIELD_PURCHASE_ERROR_CODES.MAX_SHIELDS_REACHED,
        400,
        { cap: SHIELD_RULES.MAX_SHIELD_BALANCE, available: inventory.available }
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
        { cap: SHIELD_RULES.MAX_SHIELD_BALANCE }
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
      if (inventory.available >= SHIELD_RULES.MAX_SHIELD_BALANCE) return null;
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
        await this.mirrorLegacyBalance(userId, total);
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
          await this.mirrorLegacyBalance(userId, total);
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
    const credited = Math.min(count, Math.max(0, SHIELD_RULES.MAX_SHIELD_BALANCE - inventory.available));
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

    await this.mirrorLegacyBalance(userId, inventory.available + credited);
    return credited;
  }

  /**
   * Keep the legacy `engagement_streaks.streak_freezes_available` column in
   * sync so pre-update mobile clients keep showing a truthful count.
   */
  private static async mirrorLegacyBalance(userId: string, total: number): Promise<void> {
    const supabase = createAdminSupabase();
    const mirrored = Math.max(0, Math.min(total, SHIELD_RULES.MAX_SHIELD_BALANCE));
    // Upsert so a user whose engagement_streaks row hasn't been created yet
    // still gets a truthful mirror instead of a silent no-op.
    const { error } = await supabase
      .from('engagement_streaks')
      .upsert({ user_id: userId, streak_freezes_available: mirrored }, { onConflict: 'user_id' });
    // Mirror failures must never fail the primary operation.
    if (error) console.error('[StreakShieldService.mirrorLegacyBalance] Error:', error);
  }
}
