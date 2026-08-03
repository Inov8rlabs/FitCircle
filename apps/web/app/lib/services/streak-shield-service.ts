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
import { SHIELD_RULES, shieldsEarnedBetween } from '../streaks/streak-config';
import { normalizeTier } from './entitlement-service';

export type ShieldType = 'freeze' | 'milestone_shield' | 'purchased';

const CONSUME_ORDER: ShieldType[] = ['freeze', 'milestone_shield', 'purchased'];

/**
 * Max shield awards in any rolling 7 days — the honest ceiling (one weekly
 * boundary plus at most one monthly boundary per week). Guards against
 * farming awards by breaking and retro-repairing across the same boundary.
 */
const MAX_AWARDS_PER_WEEK = 2;

export interface ShieldInventory {
  available: number;
  unlimited: boolean;
  cap: number;
  breakdown: Record<ShieldType, number>;
}

export interface ConsumeResult {
  consumedType: ShieldType | 'pro_unlimited';
  remaining: number;
  unlimited: boolean;
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

    if (!rows || rows.length === 0) {
      // First touch: seed the starter shield so a new user's first slip
      // doesn't kill the habit.
      await supabase.from('streak_shields').upsert(
        [
          { user_id: userId, shield_type: 'freeze', available_count: SHIELD_RULES.STARTER_SHIELDS },
          { user_id: userId, shield_type: 'milestone_shield', available_count: 0 },
          { user_id: userId, shield_type: 'purchased', available_count: 0 },
        ],
        { onConflict: 'user_id,shield_type', ignoreDuplicates: true }
      );
      breakdown.freeze = SHIELD_RULES.STARTER_SHIELDS;
    } else {
      for (const row of rows) {
        if (row.shield_type in breakdown) {
          breakdown[row.shield_type as ShieldType] = row.available_count || 0;
        }
      }
    }

    return {
      available: breakdown.freeze + breakdown.milestone_shield + breakdown.purchased,
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
   * Award shields earned by growing the streak from oldStreak → newStreak
   * (+1 per 7-day boundary, +1 per 30-day boundary crossed). Banked into
   * milestone_shield, capped at MAX_SHIELD_BALANCE across all types.
   * Returns how many were actually credited (0 when capped out or Pro).
   *
   * Rolling rate limit: at most 2 awards per 7 days — exactly the honest
   * maximum (one weekly boundary + at most one monthly boundary can fall in
   * any 7-day span). Without it, breaking and retro-repairing a streak
   * re-crosses an already-paid boundary and farms extra shields.
   */
  static async earnForStreakIncrease(
    userId: string,
    oldStreak: number,
    newStreak: number
  ): Promise<number> {
    const earned = shieldsEarnedBetween(oldStreak, newStreak);
    if (earned <= 0) return 0;

    const supabase = createAdminSupabase();
    const inventory = await this.getInventory(userId);

    // Rolling-window award history lives on the milestone_shield row.
    const { data: milestoneRow } = await supabase
      .from('streak_shields')
      .select('metadata')
      .eq('user_id', userId)
      .eq('shield_type', 'milestone_shield')
      .maybeSingle();

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentAwards: string[] = (milestoneRow?.metadata?.recent_awards || []).filter(
      (ts: string) => new Date(ts).getTime() > weekAgo
    );
    const rateHeadroom = Math.max(0, MAX_AWARDS_PER_WEEK - recentAwards.length);

    const capHeadroom = Math.max(0, SHIELD_RULES.MAX_SHIELD_BALANCE - inventory.available);
    const credited = Math.min(earned, capHeadroom, rateHeadroom);
    if (credited <= 0) return 0;

    const now = new Date().toISOString();
    const { error } = await supabase.from('streak_shields').upsert(
      {
        user_id: userId,
        shield_type: 'milestone_shield',
        available_count: inventory.breakdown.milestone_shield + credited,
        metadata: {
          ...(milestoneRow?.metadata || {}),
          recent_awards: [...recentAwards, ...Array(credited).fill(now)],
        },
      },
      { onConflict: 'user_id,shield_type' }
    );
    if (error) throw error;

    await this.mirrorLegacyBalance(userId, inventory.available + credited);
    return credited;
  }

  /**
   * Refund one shield of the given type (e.g. a duplicate-protection race
   * consumed a shield for a day that was already covered). Keeps the legacy
   * mirror in sync.
   */
  static async refund(userId: string, type: ShieldType): Promise<void> {
    const supabase = createAdminSupabase();
    const { data: row } = await supabase
      .from('streak_shields')
      .select('available_count')
      .eq('user_id', userId)
      .eq('shield_type', type)
      .maybeSingle();
    if (!row) return;

    await supabase
      .from('streak_shields')
      .update({
        available_count: Math.min(SHIELD_RULES.MAX_SHIELD_BALANCE, row.available_count + 1),
      })
      .eq('user_id', userId)
      .eq('shield_type', type);

    const inventory = await this.getInventory(userId);
    await this.mirrorLegacyBalance(userId, inventory.available);
  }

  /** Credit purchased shields (IAP / promo). Also capped. */
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
    const { error } = await supabase
      .from('engagement_streaks')
      .update({ streak_freezes_available: mirrored })
      .eq('user_id', userId);
    // Mirror failures must never fail the primary operation.
    if (error) console.error('[StreakShieldService.mirrorLegacyBalance] Error:', error);
  }
}
