import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreakShieldService } from '@/lib/services/streak-shield-service';
import { StreakClaimError } from '@/lib/types/streak-claiming';
import { SHIELD_RULES } from '@/lib/streaks/streak-config';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { makeStreakDb, type FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');

const USER = 'user-1';
let db: FakeSupabase;

function seedFreeUser(shields: { freeze?: number; milestone?: number; purchased?: number } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: shields.freeze ?? 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: shields.milestone ?? 0 },
    { user_id: USER, shield_type: 'purchased', available_count: shields.purchased ?? 0 },
  ]);
  db.seed('engagement_streaks', [{ user_id: USER, current_streak: 5, streak_freezes_available: 0 }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
});

describe('hasUnlimitedShields', () => {
  it('premium and enterprise tiers are unlimited; free is not', async () => {
    db.seed('profiles', [
      { id: 'p1', subscription_tier: 'premium' },
      { id: 'p2', subscription_tier: 'enterprise' },
      { id: 'p3', subscription_tier: 'free' },
    ]);
    expect(await StreakShieldService.hasUnlimitedShields('p1')).toBe(true);
    expect(await StreakShieldService.hasUnlimitedShields('p2')).toBe(true);
    expect(await StreakShieldService.hasUnlimitedShields('p3')).toBe(false);
    expect(await StreakShieldService.hasUnlimitedShields('missing')).toBe(false);
  });
});

describe('getInventory', () => {
  it('sums the three shield types', async () => {
    seedFreeUser({ freeze: 1, milestone: 2, purchased: 0 });
    const inv = await StreakShieldService.getInventory(USER);
    expect(inv.available).toBe(3);
    expect(inv.unlimited).toBe(false);
    expect(inv.breakdown).toEqual({ freeze: 1, milestone_shield: 2, purchased: 0 });
  });

  it('seeds starter shields on first touch', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    const inv = await StreakShieldService.getInventory(USER);
    expect(inv.available).toBe(SHIELD_RULES.STARTER_SHIELDS);
    expect(db.getRows('streak_shields').length).toBe(3);
  });
});

describe('consume', () => {
  it('consumes in freeze → milestone → purchased order', async () => {
    seedFreeUser({ freeze: 1, milestone: 1, purchased: 1 });

    const first = await StreakShieldService.consume(USER);
    expect(first.consumedType).toBe('freeze');
    expect(first.remaining).toBe(2);

    const second = await StreakShieldService.consume(USER);
    expect(second.consumedType).toBe('milestone_shield');

    const third = await StreakShieldService.consume(USER);
    expect(third.consumedType).toBe('purchased');

    await expect(StreakShieldService.consume(USER)).rejects.toThrowError(StreakClaimError);
  });

  it('throws NO_SHIELDS_AVAILABLE with an upsell hint when empty', async () => {
    seedFreeUser();
    try {
      await StreakShieldService.consume(USER);
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(StreakClaimError);
      expect(e.code).toBe('NO_SHIELDS_AVAILABLE');
      expect(e.details?.upsell).toBe('pro_unlimited_shields');
    }
  });

  it('Pro users never decrement a balance', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'premium' }]);
    db.seed('streak_shields', [
      { user_id: USER, shield_type: 'freeze', available_count: 1 },
      { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
      { user_id: USER, shield_type: 'purchased', available_count: 0 },
    ]);

    const result = await StreakShieldService.consume(USER);
    expect(result.consumedType).toBe('pro_unlimited');
    expect(result.unlimited).toBe(true);

    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(1); // untouched
  });

  it('mirrors the remaining total into the legacy column', async () => {
    seedFreeUser({ freeze: 2 });
    await StreakShieldService.consume(USER);
    const record = db.getRows('engagement_streaks')[0];
    expect(record.streak_freezes_available).toBe(1);
  });
});

describe('earnForStreakIncrease', () => {
  it('credits weekly + monthly crossings into milestone_shield', async () => {
    seedFreeUser();
    const credited = await StreakShieldService.earnForStreakIncrease(USER, 6, 7);
    expect(credited).toBe(1);
    const row = db.getRows('streak_shields').find(r => r.shield_type === 'milestone_shield');
    expect(row!.available_count).toBe(1);
  });

  it('caps the total balance at MAX_SHIELD_BALANCE', async () => {
    seedFreeUser({ freeze: SHIELD_RULES.MAX_SHIELD_BALANCE });
    const credited = await StreakShieldService.earnForStreakIncrease(USER, 6, 7);
    expect(credited).toBe(0);
  });

  it('partially credits up to the cap', async () => {
    seedFreeUser({ freeze: SHIELD_RULES.MAX_SHIELD_BALANCE - 1 });
    // 0 → 31 would earn 5, but only 1 slot is free
    const credited = await StreakShieldService.earnForStreakIncrease(USER, 0, 31);
    expect(credited).toBe(1);
  });

  it('returns 0 when no boundary crossed', async () => {
    seedFreeUser();
    expect(await StreakShieldService.earnForStreakIncrease(USER, 8, 9)).toBe(0);
  });

  it('pays each calendar boundary day once — a retro gap-fill cannot re-earn it', async () => {
    seedFreeUser();
    // Run A: 7 days ending 2026-08-10 → the day-7 boundary fell on 08-10.
    expect(await StreakShieldService.earnForStreakIncrease(USER, 6, 7, '2026-08-10')).toBe(1);
    // Streak "breaks" (gap on 08-11), user restarts 08-12/08-13 (streak 2),
    // then retro-claims 08-11: the merged run is 10 days ending 08-13, so
    // the day-7 boundary is 08-13 - 3 = 08-10 — already paid → nothing.
    expect(await StreakShieldService.earnForStreakIncrease(USER, 2, 10, '2026-08-13')).toBe(0);
    // A genuinely new boundary (day 14 on 08-17) still pays.
    expect(await StreakShieldService.earnForStreakIncrease(USER, 13, 14, '2026-08-17')).toBe(1);
    const row = db.getRows('streak_shields').find(r => r.shield_type === 'milestone_shield');
    expect(row!.available_count).toBe(2);
    expect(row!.metadata.paid_boundaries).toEqual(['7:2026-08-10', '7:2026-08-17']);
  });

  it('honest catch-ups are not truncated (no rolling rate limit)', async () => {
    seedFreeUser();
    // 0 → 21 in one retroactive sweep crosses 7, 14, 21 → 3 shields (cap is 3).
    expect(await StreakShieldService.earnForStreakIncrease(USER, 0, 21, '2026-08-21')).toBe(3);
  });

  it('dedupes milestone celebrations by day and reports capped earns', async () => {
    seedFreeUser({ freeze: SHIELD_RULES.MAX_SHIELD_BALANCE });
    // 0 → 7 celebrates day 3 (08-06) and day 7 (08-10); the highest is reported.
    const first = await StreakShieldService.awardForStreakGrowth(USER, {
      oldStreak: 0,
      newStreak: 7,
      runEndDay: '2026-08-10',
    });
    expect(first.milestone?.days).toBe(7);
    expect(first.earned).toBe(1);
    expect(first.credited).toBe(0);
    expect(first.capped).toBe(true);

    const again = await StreakShieldService.awardForStreakGrowth(USER, {
      oldStreak: 2,
      newStreak: 10,
      runEndDay: '2026-08-13',
    });
    expect(again.milestone).toBeNull();
    expect(again.earned).toBe(0);
  });
});

describe('creditPurchased', () => {
  it('credits purchased shields up to the cap', async () => {
    seedFreeUser({ freeze: SHIELD_RULES.MAX_SHIELD_BALANCE - 1 });
    expect(await StreakShieldService.creditPurchased(USER, 3)).toBe(1);
    const row = db.getRows('streak_shields').find(r => r.shield_type === 'purchased');
    expect(row!.available_count).toBe(1);
  });
});
