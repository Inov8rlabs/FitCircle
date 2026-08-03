/**
 * Unit tests for EngagementStreakService (claims-derived, shield-service
 * backed). The previous version of this file was comment-only placeholders
 * with zero assertions; these are real behavioral tests on the in-memory
 * FakeSupabase.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { StreakError } from '@/lib/types/streak';
import { addDays } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { makeStreakDb, type FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));

const USER = 'user-1';
const NOW = new Date('2026-08-03T12:00:00Z');
const TODAY = '2026-08-03';

let db: FakeSupabase;

function seedUser(opts: { tier?: string; shields?: number; claims?: string[]; paused?: boolean } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: opts.tier ?? 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: opts.shields ?? 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [
    {
      user_id: USER,
      current_streak: 0,
      longest_streak: 0,
      streak_freezes_available: opts.shields ?? 0,
      streak_freezes_used_this_week: 0,
      paused: opts.paused ?? false,
      pause_start_date: null,
      pause_end_date: null,
      last_engagement_date: null,
    },
  ]);
  for (const day of opts.claims ?? []) {
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day, claim_method: 'explicit', timezone: 'UTC', metadata: {} },
    ]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('updateEngagementStreak', () => {
  it('derives the streak from consecutive claims', async () => {
    seedUser({ claims: [addDays(TODAY, -2), addDays(TODAY, -1), TODAY] });
    const result = await EngagementStreakService.updateEngagementStreak(USER);
    expect(result.current_streak).toBe(3);
    expect(result.longest_streak).toBe(3);
  });

  it("today unclaimed doesn't break the streak", async () => {
    seedUser({ claims: [addDays(TODAY, -2), addDays(TODAY, -1)] });
    const result = await EngagementStreakService.updateEngagementStreak(USER);
    expect(result.current_streak).toBe(2);
  });

  it('a gap breaks the streak down to the trailing run', async () => {
    seedUser({ claims: [addDays(TODAY, -5), addDays(TODAY, -4), addDays(TODAY, -1), TODAY] });
    const result = await EngagementStreakService.updateEngagementStreak(USER);
    expect(result.current_streak).toBe(2);
  });

  it('never lowers longest_streak', async () => {
    seedUser({ claims: [TODAY] });
    db.getRows('engagement_streaks')[0].longest_streak = 30;
    const result = await EngagementStreakService.updateEngagementStreak(USER);
    expect(result.current_streak).toBe(1);
    expect(result.longest_streak).toBe(30);
  });

  it('does not update while paused', async () => {
    seedUser({ paused: true, claims: [TODAY] });
    db.getRows('engagement_streaks')[0].current_streak = 12;
    const result = await EngagementStreakService.updateEngagementStreak(USER);
    expect(result.current_streak).toBe(12); // untouched
  });
});

describe('applyFreeze', () => {
  it('protects a missed day and restores the streak', async () => {
    seedUser({ shields: 1, claims: [addDays(TODAY, -3), addDays(TODAY, -2), TODAY] });

    const result = await EngagementStreakService.applyFreeze(USER, addDays(TODAY, -1));

    expect(result.current_streak).toBe(4);
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(0);
  });

  it('maps shield exhaustion to NO_FREEZES_AVAILABLE with an upsell hint', async () => {
    seedUser({ shields: 0, claims: [addDays(TODAY, -2), TODAY] });
    try {
      await EngagementStreakService.applyFreeze(USER, addDays(TODAY, -1));
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(StreakError);
      expect(e.code).toBe('NO_FREEZES_AVAILABLE');
      expect(e.details?.upsell).toBe('pro_unlimited_shields');
    }
  });

  it('rejects dates outside the past-7-days window', async () => {
    seedUser({ shields: 1 });
    await expect(
      EngagementStreakService.applyFreeze(USER, addDays(TODAY, -8))
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
    await expect(EngagementStreakService.applyFreeze(USER, TODAY)).rejects.toMatchObject({
      code: 'INVALID_DATE_RANGE',
    });
  });

  it('rejects already-claimed days as DATE_HAS_ACTIVITY', async () => {
    seedUser({ shields: 1, claims: [addDays(TODAY, -1)] });
    await expect(
      EngagementStreakService.applyFreeze(USER, addDays(TODAY, -1))
    ).rejects.toMatchObject({ code: 'DATE_HAS_ACTIVITY' });
  });
});

describe('getEngagementStreak', () => {
  it('reports the live shield inventory, not the stale mirror', async () => {
    seedUser({ shields: 2, claims: [TODAY] });
    db.getRows('engagement_streaks')[0].streak_freezes_available = 99; // stale mirror
    const result = await EngagementStreakService.getEngagementStreak(USER);
    expect(result.freezes_available).toBe(2);
    expect(result.shields_unlimited).toBe(false);
  });

  it('flags unlimited shields for Pro users', async () => {
    seedUser({ tier: 'premium', claims: [TODAY] });
    const result = await EngagementStreakService.getEngagementStreak(USER);
    expect(result.shields_unlimited).toBe(true);
  });

  it('corrects a stale current_streak on read', async () => {
    seedUser({ claims: [addDays(TODAY, -1), TODAY] });
    db.getRows('engagement_streaks')[0].current_streak = 40; // stale
    const result = await EngagementStreakService.getEngagementStreak(USER);
    expect(result.current_streak).toBe(2);
    expect(db.getRows('engagement_streaks')[0].current_streak).toBe(2);
  });
});

describe('pause / resume', () => {
  it('pauses and rejects double-pause', async () => {
    seedUser();
    await EngagementStreakService.pauseStreak(USER, addDays(TODAY, 10));
    expect(db.getRows('engagement_streaks')[0].paused).toBe(true);
    await expect(EngagementStreakService.pauseStreak(USER)).rejects.toMatchObject({
      code: 'ALREADY_PAUSED',
    });
  });

  it('rejects pauses longer than 90 days', async () => {
    seedUser();
    await expect(
      EngagementStreakService.pauseStreak(USER, addDays(TODAY, 91))
    ).rejects.toMatchObject({ code: 'PAUSE_TOO_LONG' });
  });

  it('resume bridges the paused gap so the streak survives', async () => {
    seedUser({ claims: [addDays(TODAY, -6), addDays(TODAY, -5)] });
    db.getRows('engagement_streaks')[0].paused = true;
    db.getRows('engagement_streaks')[0].pause_start_date = addDays(TODAY, -4);
    db.getRows('engagement_streaks')[0].pause_end_date = TODAY;

    await EngagementStreakService.resumeStreak(USER);

    const record = db.getRows('engagement_streaks')[0];
    expect(record.paused).toBe(false);
    // -6, -5 claimed + bridge -4..-1 → streak of 6 (today free pass)
    expect(record.current_streak).toBe(6);
  });

  it('rejects resume when not paused', async () => {
    seedUser();
    await expect(EngagementStreakService.resumeStreak(USER)).rejects.toMatchObject({
      code: 'NOT_PAUSED',
    });
  });
});

describe('purchaseFreeze', () => {
  it('credits a purchased shield', async () => {
    seedUser({ shields: 0 });
    await EngagementStreakService.purchaseFreeze(USER);
    const purchased = db.getRows('streak_shields').find(r => r.shield_type === 'purchased');
    expect(purchased!.available_count).toBe(1);
  });

  it('throws at the balance cap', async () => {
    seedUser({ shields: 3 });
    await expect(EngagementStreakService.purchaseFreeze(USER)).rejects.toMatchObject({
      code: 'NO_FREEZES_AVAILABLE',
    });
  });
});

describe('recordActivity', () => {
  it('records history and refreshes the derived streak', async () => {
    seedUser({ claims: [TODAY] });
    await EngagementStreakService.recordActivity(USER, 'weight_log', 'ref-1', TODAY);
    expect(
      db.getRows('engagement_activities').filter(a => a.activity_date === TODAY).length
    ).toBe(1);
    expect(db.getRows('engagement_streaks')[0].current_streak).toBe(1);
  });

  it('is idempotent for duplicate activities', async () => {
    seedUser();
    await EngagementStreakService.recordActivity(USER, 'weight_log', 'ref-1', TODAY);
    await EngagementStreakService.recordActivity(USER, 'weight_log', 'ref-1', TODAY);
    expect(db.getRows('engagement_activities').length).toBe(1);
  });
});
