import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import {
  StreakShieldService,
  grantStarterShields,
  isRecentCompletion,
} from '@/lib/services/streak-shield-service';
import { normalizeShieldRules, resolveShieldRules } from '@/lib/streaks/shield-rules';
import { SHIELD_RULES } from '@/lib/streaks/streak-config';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { StreakClaimError } from '@/lib/types/streak-claiming';

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
  resetRemoteConfigCache();
});

/** Admin Tools default for a remote-config key. */
function setRemoteDefault(key: string, value: unknown) {
  db.seed('remote_config_defaults', [{ config_key: key, value, updated_by: null, updated_at: '2026-11-13T00:00:00Z' }]);
}

const freezeRow = () => db.getRows('streak_shields').find(r => r.shield_type === 'freeze')!;
const total = () => db.getRows('streak_shields').reduce((sum, r) => sum + r.available_count, 0);

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

  it('seeds starter shields on first touch (2 by default) and records the grant', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    const inv = await StreakShieldService.getInventory(USER);
    expect(SHIELD_RULES.STARTER_SHIELDS).toBe(2);
    expect(inv.available).toBe(2);
    expect(db.getRows('streak_shields').length).toBe(3);
    expect(freezeRow().metadata.starter_grant).toMatchObject({ reason: 'lazy_first_touch', count: 2, target: 2 });
    expect(db.getRows('engagement_streaks')[0].streak_freezes_available).toBe(2); // legacy mirror
  });

  it('reports the resolved rules and cap (code defaults)', async () => {
    seedFreeUser({ freeze: 1 });
    const inv = await StreakShieldService.getInventory(USER);
    expect(inv.rules).toEqual({ earnIntervalDays: 7, starterCount: 2, maxBalance: 3 });
    expect(inv.cap).toBe(3);
  });

  it('follows remote-config overrides for starter and cap', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    setRemoteDefault('streak_shield_starter_count', 3);
    setRemoteDefault('streak_shield_max_balance', 5);
    setRemoteDefault('streak_shield_earn_interval_days', 10);
    const inv = await StreakShieldService.getInventory(USER);
    expect(inv.rules).toEqual({ earnIntervalDays: 10, starterCount: 3, maxBalance: 5 });
    expect(inv.available).toBe(3);
    expect(inv.cap).toBe(5);
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
  it('credits each 7-day crossing into milestone_shield', async () => {
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
    // 0 → 31 would earn 4, but only 1 slot is free
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

describe('new earning rules', () => {
  it('pays no monthly bonus at day 30', async () => {
    seedFreeUser();
    const award = await StreakShieldService.awardForStreakGrowth(USER, { oldStreak: 29, newStreak: 30, runEndDay: '2026-09-30' });
    expect(award.earned).toBe(0);
    expect(award.credited).toBe(0);
    expect(award.milestone?.days).toBe(30); // the celebration still fires
  });

  it('earns exactly one per 7 days on a long catch-up (0 → 31 = 4), banked up to the cap', async () => {
    seedFreeUser();
    const award = await StreakShieldService.awardForStreakGrowth(USER, { oldStreak: 0, newStreak: 31, runEndDay: '2026-08-31' });
    expect(award.earned).toBe(4);
    expect(award.credited).toBe(3);
    expect(award.capped).toBe(true);
    expect(total()).toBe(3);
  });

  it('uses the remote-config earn interval and cap', async () => {
    seedFreeUser();
    setRemoteDefault('streak_shield_earn_interval_days', 10);
    setRemoteDefault('streak_shield_max_balance', 10);
    expect(await StreakShieldService.earnForStreakIncrease(USER, 6, 7, '2026-08-07')).toBe(0);
    expect(await StreakShieldService.earnForStreakIncrease(USER, 9, 10, '2026-08-10')).toBe(1);
    expect(await StreakShieldService.earnForStreakIncrease(USER, 10, 40, '2026-09-09')).toBe(3);
    const row = db.getRows('streak_shields').find(r => r.shield_type === 'milestone_shield')!;
    expect(row.metadata.paid_boundaries[0]).toBe('10:2026-08-10');
    expect(total()).toBe(4);
  });

  it('a day already paid under an older rule (e.g. the retired 30-day bonus) is never paid again', async () => {
    seedFreeUser();
    const row = db.getRows('streak_shields').find(r => r.shield_type === 'milestone_shield')!;
    row.metadata = { paid_boundaries: ['30:2026-08-10'] };
    // Day-7 boundary of this run is 2026-08-10, which already paid a shield.
    expect(await StreakShieldService.earnForStreakIncrease(USER, 6, 7, '2026-08-10')).toBe(0);
  });

  it('a lowered cap never takes shields away, it only stops earning', async () => {
    seedFreeUser({ freeze: 3 });
    setRemoteDefault('streak_shield_max_balance', 1);
    const inv = await StreakShieldService.getInventory(USER);
    expect(inv.available).toBe(3);
    expect(await StreakShieldService.earnForStreakIncrease(USER, 6, 7)).toBe(0);
    expect(total()).toBe(3);
  });
});

describe('grantOnboardingStarter', () => {
  it('seeds a brand-new user with the starter balance (reason onboarding_starter)', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result).toEqual({ granted: 2, alreadyGranted: false, available: 2, reason: 'onboarding_starter' });
    expect(total()).toBe(2);
    expect(freezeRow().metadata.starter_grant).toMatchObject({ reason: 'onboarding_starter', count: 2, target: 2 });
    expect(db.getRows('engagement_streaks')[0].streak_freezes_available).toBe(2);
  });

  it('is idempotent: retries and replays never double-grant', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    await StreakShieldService.grantOnboardingStarter(USER);
    const again = await StreakShieldService.grantOnboardingStarter(USER);
    const third = await StreakShieldService.grantOnboardingStarter(USER);
    expect(again).toMatchObject({ granted: 0, alreadyGranted: true, available: 2 });
    expect(third.granted).toBe(0);
    expect(total()).toBe(2);
  });

  it('concurrent completions grant once', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    const results = await Promise.all([
      StreakShieldService.grantOnboardingStarter(USER),
      StreakShieldService.grantOnboardingStarter(USER),
    ]);
    expect(total()).toBe(2);
    expect(results.reduce((n, r) => n + r.granted, 0)).toBeLessThanOrEqual(2);
  });

  it('does not add on top of a lazy first-touch seed (already at the starter balance)', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    await StreakShieldService.getInventory(USER); // e.g. the home screen loaded mid-onboarding
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result).toMatchObject({ granted: 0, alreadyGranted: true });
    expect(total()).toBe(2);
  });

  it('does not refill a lazy seed the user already spent', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    await StreakShieldService.getInventory(USER);
    await StreakShieldService.consume(USER);
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result.granted).toBe(0);
    expect(total()).toBe(1);
  });

  it('tops a pre-existing row (old 1-shield starter, no grant recorded) UP to 2 once — not +2', async () => {
    seedFreeUser({ freeze: 1 });
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result).toEqual({ granted: 1, alreadyGranted: false, available: 2, reason: 'onboarding_starter' });
    expect(total()).toBe(2);
    expect(freezeRow().metadata.starter_grant).toMatchObject({ reason: 'onboarding_starter', count: 1, target: 2 });
    expect((await StreakShieldService.grantOnboardingStarter(USER)).granted).toBe(0);
    expect(total()).toBe(2);
  });

  it('never lowers a balance already at or above the starter count, but records the grant', async () => {
    seedFreeUser({ freeze: 1, milestone: 2 });
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result).toMatchObject({ granted: 0, alreadyGranted: false, available: 3 });
    expect(total()).toBe(3);
    expect(freezeRow().metadata.starter_grant.count).toBe(0);
  });

  it('follows the remote-config starter count, clamped to the max balance', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    setRemoteDefault('streak_shield_starter_count', 3);
    setRemoteDefault('streak_shield_max_balance', 1);
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result.granted).toBe(1);
    expect(total()).toBe(1);
  });

  it('a starter count of 0 grants nothing (and still records it)', async () => {
    db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
    setRemoteDefault('streak_shield_starter_count', 0);
    const result = await StreakShieldService.grantOnboardingStarter(USER);
    expect(result.granted).toBe(0);
    expect(total()).toBe(0);
    expect(freezeRow().metadata.starter_grant.reason).toBe('onboarding_starter');
  });

  it('grantStarterShields never throws', async () => {
    (createAdminSupabase as any).mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(grantStarterShields(USER)).resolves.toBeNull();
  });
});

describe('isRecentCompletion', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  it('is true within 24h of completion and false otherwise', () => {
    expect(isRecentCompletion('2026-11-13T11:00:00Z', now)).toBe(true);
    expect(isRecentCompletion('2026-11-12T12:30:00Z', now)).toBe(true);
    expect(isRecentCompletion('2026-11-12T11:00:00Z', now)).toBe(false);
    expect(isRecentCompletion('2025-01-01T00:00:00Z', now)).toBe(false);
    expect(isRecentCompletion(null, now)).toBe(false);
    expect(isRecentCompletion('garbage', now)).toBe(false);
  });
});

describe('shield rules resolution', () => {
  it('code defaults: 7 / 2 / 3', async () => {
    expect(await resolveShieldRules(USER)).toEqual({ earnIntervalDays: 7, starterCount: 2, maxBalance: 3 });
  });

  it('ignores out-of-range admin values (registry bounds) and keeps the code default', async () => {
    setRemoteDefault('streak_shield_earn_interval_days', 1); // min 3
    setRemoteDefault('streak_shield_max_balance', 50); // max 10
    expect(await resolveShieldRules(USER)).toEqual({ earnIntervalDays: 7, starterCount: 2, maxBalance: 3 });
  });

  it('falls back to code defaults when remote config cannot load', async () => {
    (createAdminSupabase as any).mockImplementation(() => {
      throw new Error('db down');
    });
    expect(await resolveShieldRules(USER)).toEqual({ earnIntervalDays: 7, starterCount: 2, maxBalance: 3 });
  });

  it('normalizeShieldRules clamps the starter to the cap and repairs junk', () => {
    expect(normalizeShieldRules({ earnIntervalDays: 7, starterCount: 3, maxBalance: 2 }).starterCount).toBe(2);
    expect(normalizeShieldRules({ earnIntervalDays: 0, starterCount: -1, maxBalance: NaN })).toEqual({
      earnIntervalDays: 7,
      starterCount: 2,
      maxBalance: 3,
    });
  });
});
