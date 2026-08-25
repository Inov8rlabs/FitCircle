/**
 * Unit tests for StreakClaimingService (claims-derived streak engine).
 * Uses the in-memory FakeSupabase so behavior — not mock call order — is
 * what's asserted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { StreakClaimError } from '@/lib/types/streak-claiming';
import { addDays } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { makeStreakDb, type FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));

const USER = 'user-1';
const TZ = 'UTC';
// Fixed clock: 2026-08-03T12:00:00Z (noon — outside the 3am grace window)
const NOW = new Date('2026-08-03T12:00:00Z');
const TODAY = '2026-08-03';

let db: FakeSupabase;

function seedUser(opts: { tier?: string; shields?: number; claims?: string[] } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: opts.tier ?? 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: opts.shields ?? 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [
    { user_id: USER, current_streak: 0, longest_streak: 0, streak_freezes_available: 0, total_claims: 0, paused: false },
  ]);
  for (const day of opts.claims ?? []) {
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day, claim_method: 'explicit', timezone: TZ, metadata: {} },
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

describe('claimStreak', () => {
  it('claims today and returns the new streak count', async () => {
    seedUser({ claims: [addDays(TODAY, -2), addDays(TODAY, -1)] });

    const result = await StreakClaimingService.claimStreak(USER, TODAY, TZ, 'explicit');

    expect(result.success).toBe(true);
    expect(result.streakCount).toBe(3);
    const record = db.getRows('engagement_streaks')[0];
    expect(record.current_streak).toBe(3);
    expect(record.longest_streak).toBe(3);
    expect(record.total_claims).toBe(1);
  });

  it('rejects an already-claimed day', async () => {
    seedUser({ claims: [TODAY] });
    await expect(
      StreakClaimingService.claimStreak(USER, TODAY, TZ, 'explicit')
    ).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });
  });

  it("rejects the user's local tomorrow, honouring their timezone", async () => {
    seedUser();
    // Server time is Aug 3 noon UTC; in Tokyo it is already Aug 3 21:00,
    // so Aug 4 is still the future there.
    await expect(
      StreakClaimingService.claimStreak(USER, '2026-08-04', 'Asia/Tokyo', 'explicit')
    ).rejects.toMatchObject({ code: 'FUTURE_DATE' });
  });

  it("allows claiming the user's local today even when UTC lags behind", async () => {
    seedUser();
    // At Aug 3 20:00 UTC it is already Aug 4 in Tokyo → claimable there.
    vi.setSystemTime(new Date('2026-08-03T20:00:00Z'));
    const result = await StreakClaimingService.claimStreak(USER, '2026-08-04', 'Asia/Tokyo', 'explicit');
    expect(result.success).toBe(true);
  });

  it('rejects days outside the retroactive window', async () => {
    seedUser();
    await expect(
      StreakClaimingService.claimStreak(USER, addDays(TODAY, -8), TZ, 'retroactive')
    ).rejects.toMatchObject({ code: 'TOO_OLD' });
  });

  it('a retroactive claim bridging a gap restores the full streak', async () => {
    // Claimed: -4, -3, [gap at -2], -1, today unclaimed
    seedUser({ claims: [addDays(TODAY, -4), addDays(TODAY, -3), addDays(TODAY, -1)] });

    const result = await StreakClaimingService.claimStreak(USER, addDays(TODAY, -2), TZ, 'retroactive');
    expect(result.streakCount).toBe(4);
  });

  it('a retroactive gap-fill does not re-grant a shield or re-fire a milestone', async () => {
    // Run of 7 ending at -4 (boundary paid on -4), gap at -3, then -2 and -1.
    const older = Array.from({ length: 7 }, (_, i) => addDays(TODAY, -(4 + i)));
    seedUser({ claims: [...older, addDays(TODAY, -2), addDays(TODAY, -1)] });
    db.getRows('streak_shields').find(r => r.shield_type === 'milestone_shield')!.metadata = {
      paid_boundaries: [`7:${addDays(TODAY, -4)}`],
      celebrated_milestone_days: [addDays(TODAY, -4), addDays(TODAY, -8)],
    };

    const result = await StreakClaimingService.claimStreak(USER, addDays(TODAY, -3), TZ, 'retroactive');
    expect(result.streakCount).toBe(10);
    expect(result.milestone).toBeUndefined();
    const row = db.getRows('streak_shields').find(r => r.shield_type === 'milestone_shield');
    expect(row!.available_count).toBe(0);
  });

  it('claiming today auto-shields a missed yesterday so the streak survives', async () => {
    // -3, -2 claimed, -1 missed, 1 shield in the bank.
    seedUser({ shields: 1, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });
    const result = await StreakClaimingService.claimStreak(USER, TODAY, TZ, 'explicit');
    expect(result.streakCount).toBe(4);
    expect(result.shieldAutoApplied).toBe(addDays(TODAY, -1));
    const freezeRow = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freezeRow!.available_count).toBe(0);
    expect(db.getRows('streak_claims').some(c => c.claim_date === addDays(TODAY, -1) && c.claim_method === 'freeze')).toBe(true);
  });

  it('without shields, claiming today after a miss starts a fresh streak', async () => {
    seedUser({ shields: 0, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });
    const result = await StreakClaimingService.claimStreak(USER, TODAY, TZ, 'explicit');
    expect(result.streakCount).toBe(1);
    expect(result.shieldAutoApplied).toBeUndefined();
  });

  it('awards a milestone and earned shields when crossing day 7', async () => {
    const claims = Array.from({ length: 6 }, (_, i) => addDays(TODAY, -(i + 1)));
    seedUser({ claims });

    const result = await StreakClaimingService.claimStreak(USER, TODAY, TZ, 'explicit');

    expect(result.streakCount).toBe(7);
    expect(result.milestone?.milestone).toBe(7);
    expect(result.milestone?.shieldsGranted).toBe(1);
    const milestoneRow = db
      .getRows('streak_shields')
      .find(r => r.shield_type === 'milestone_shield');
    expect(milestoneRow!.available_count).toBe(1);
  });

  it('does not award shields between milestones', async () => {
    seedUser({ claims: [addDays(TODAY, -1)] });
    const result = await StreakClaimingService.claimStreak(USER, TODAY, TZ, 'explicit');
    expect(result.streakCount).toBe(2);
    expect(result.milestone).toBeUndefined();
  });
});

describe('activateFreeze', () => {
  it('consumes a shield and protects the day, restoring the streak', async () => {
    seedUser({ shields: 1, claims: [addDays(TODAY, -3), addDays(TODAY, -2), TODAY] });

    const result = await StreakClaimingService.activateFreeze(USER, addDays(TODAY, -1), TZ);

    expect(result.shieldType).toBe('freeze');
    expect(result.remaining).toBe(0);
    const claim = db
      .getRows('streak_claims')
      .find(c => c.claim_date === addDays(TODAY, -1));
    expect(claim?.claim_method).toBe('freeze');
    expect(db.getRows('engagement_streaks')[0].current_streak).toBe(4);
  });

  it('throws NO_SHIELDS_AVAILABLE for a free user with no shields', async () => {
    seedUser({ shields: 0, claims: [addDays(TODAY, -2)] });
    await expect(
      StreakClaimingService.activateFreeze(USER, addDays(TODAY, -1), TZ)
    ).rejects.toMatchObject({ code: 'NO_SHIELDS_AVAILABLE' });
  });

  it('Pro users protect days without consuming anything', async () => {
    seedUser({ tier: 'premium', shields: 0, claims: [addDays(TODAY, -2)] });

    const result = await StreakClaimingService.activateFreeze(USER, addDays(TODAY, -1), TZ);
    expect(result.unlimited).toBe(true);
    expect(result.shieldType).toBe('pro_unlimited');
  });

  it('refuses to shield an already-claimed day (no shield burned)', async () => {
    seedUser({ shields: 1, claims: [addDays(TODAY, -1)] });
    await expect(
      StreakClaimingService.activateFreeze(USER, addDays(TODAY, -1), TZ)
    ).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(1);
  });

  it('refuses to shield today or the future', async () => {
    seedUser({ shields: 1 });
    await expect(StreakClaimingService.activateFreeze(USER, TODAY, TZ)).rejects.toMatchObject({
      code: 'FUTURE_DATE',
    });
  });
});

describe('checkAndBreakStreak', () => {
  it('does nothing when yesterday is claimed', async () => {
    seedUser({ claims: [addDays(TODAY, -1)] });
    const result = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(result).toMatchObject({ broken: false, shieldApplied: false, paywallEligible: false });
  });

  it('reports what happened so the cron can notify', async () => {
    seedUser({ shields: 2, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });
    const result = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(result).toMatchObject({ shieldApplied: true, broken: false, shieldsRemaining: 1, unlimited: false, currentStreak: 3 });

    seedUser; // (second user scenario)
    db.getRows('streak_claims').length = 0;
    db.getRows('streak_shields').forEach(r => (r.available_count = 0));
    db.seed('streak_claims', [
      { user_id: USER, claim_date: addDays(TODAY, -3), claim_method: 'explicit', timezone: TZ, metadata: {} },
      { user_id: USER, claim_date: addDays(TODAY, -2), claim_method: 'explicit', timezone: TZ, metadata: {} },
    ]);
    const broken = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(broken).toMatchObject({ broken: true, paywallEligible: true, lostStreak: 2, currentStreak: 0, shieldsRemaining: 0 });
  });

  it('auto-applies a shield for a missed yesterday', async () => {
    seedUser({ shields: 1, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });

    const result = await StreakClaimingService.checkAndBreakStreak(USER);

    expect(result.shieldApplied).toBe(true);
    expect(result.broken).toBe(false);
    const claim = db.getRows('streak_claims').find(c => c.claim_date === addDays(TODAY, -1));
    expect(claim?.metadata?.auto_applied).toBe(true);
  });

  it('breaks the streak and flags paywall eligibility when out of shields', async () => {
    seedUser({ shields: 0, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });

    const result = await StreakClaimingService.checkAndBreakStreak(USER);

    expect(result.broken).toBe(true);
    expect(result.paywallEligible).toBe(true);
    expect(db.getRows('engagement_streaks')[0].current_streak).toBe(0);
  });

  it('Pro users are auto-protected without shields but never flagged for paywall', async () => {
    seedUser({ tier: 'premium', shields: 0, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });

    const result = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(result.shieldApplied).toBe(true);
    expect(result.broken).toBe(false);
  });

  it('stops auto-protecting after MAX_CONSECUTIVE_AUTO_PROTECTS days (zombie guard)', async () => {
    // -4 and -3 claimed, then -2 and -1 were BOTH auto-protected already? No:
    // seed 2 consecutive auto-freeze days (-3, -2) after a real claim at -4;
    // yesterday (-1) missed → third consecutive auto-protect must be refused
    // even for Pro, so the streak breaks.
    db.seed('profiles', [{ id: USER, subscription_tier: 'premium' }]);
    db.seed('engagement_streaks', [
      { user_id: USER, current_streak: 3, longest_streak: 3, streak_freezes_available: 0, paused: false },
    ]);
    db.seed('streak_claims', [
      { user_id: USER, claim_date: addDays(TODAY, -4), claim_method: 'explicit', timezone: TZ, metadata: {} },
      { user_id: USER, claim_date: addDays(TODAY, -3), claim_method: 'freeze', timezone: TZ, metadata: { auto_applied: true } },
      { user_id: USER, claim_date: addDays(TODAY, -2), claim_method: 'freeze', timezone: TZ, metadata: { auto_applied: true } },
    ]);

    const result = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(result.shieldApplied).toBe(false);
    expect(result.broken).toBe(true);
    // Pro users are never paywall-flagged — they already pay.
    expect(result.paywallEligible).toBe(false);
  });

  it('skips users still inside the 3am grace window', async () => {
    vi.setSystemTime(new Date('2026-08-03T01:00:00Z')); // 01:00 UTC
    seedUser({ shields: 1, claims: [addDays(TODAY, -3), addDays(TODAY, -2)] });

    const result = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(result).toMatchObject({ broken: false, shieldApplied: false, paywallEligible: false });
    // No shield burned during grace.
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(1);
  });

  it('does nothing for users with no streak to protect', async () => {
    seedUser({ shields: 1, claims: [addDays(TODAY, -10)] });
    const result = await StreakClaimingService.checkAndBreakStreak(USER);
    expect(result.broken).toBe(false);
    expect(result.shieldApplied).toBe(false);
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(1);
  });
});

describe('recovery', () => {
  it('purchased recovery writes a claim row and restores the streak', async () => {
    seedUser({ claims: [addDays(TODAY, -3), addDays(TODAY, -2), TODAY] });

    await StreakClaimingService.startRecovery(USER, addDays(TODAY, -1), 'purchased');

    const claim = db.getRows('streak_claims').find(c => c.claim_date === addDays(TODAY, -1));
    expect(claim).toBeTruthy();
    expect(db.getRows('engagement_streaks')[0].current_streak).toBe(4);
  });

  it('weekend warrior restores only after required actions complete', async () => {
    seedUser({ claims: [addDays(TODAY, -3), addDays(TODAY, -2), TODAY] });

    const info = await StreakClaimingService.startRecovery(USER, addDays(TODAY, -1), 'weekend_warrior');
    expect(info.actionsRemaining).toBe(2);

    const done1 = await StreakClaimingService.completeRecoveryAction(USER, info.recovery.id);
    expect(done1).toBe(false);
    expect(db.getRows('streak_claims').find(c => c.claim_date === addDays(TODAY, -1))).toBeFalsy();

    const done2 = await StreakClaimingService.completeRecoveryAction(USER, info.recovery.id);
    expect(done2).toBe(true);
    expect(db.getRows('streak_claims').find(c => c.claim_date === addDays(TODAY, -1))).toBeTruthy();
  });
});

describe('getClaimableDays', () => {
  it('returns 8 entries (today + 7 back) with correct claimable flags', async () => {
    seedUser({ claims: [addDays(TODAY, -1)] });
    db.seed('daily_tracking', [
      { user_id: USER, tracking_date: TODAY, steps: 5000 },
    ]);

    const days = await StreakClaimingService.getClaimableDays(USER, TZ);

    expect(days.length).toBe(8);
    const today = days.find(d => d.date === TODAY)!;
    expect(today.canClaim).toBe(true);
    expect(today.hasHealthData).toBe(true);
    const yesterday = days.find(d => d.date === addDays(TODAY, -1))!;
    expect(yesterday.claimed).toBe(true);
    expect(yesterday.canClaim).toBe(false);
    // The 8th entry back is outside the 7-day window → not claimable.
    const oldest = days[days.length - 1];
    expect(oldest.date).toBe(addDays(TODAY, -7));
    expect(oldest.canClaim).toBe(false);
  });
});

describe('getAvailableShields', () => {
  it('reports totals plus the unlimited flag', async () => {
    seedUser({ tier: 'premium', shields: 2 });
    const shields = await StreakClaimingService.getAvailableShields(USER);
    expect(shields.total).toBe(2);
    expect(shields.unlimited).toBe(true);
    expect(shields.cap).toBeGreaterThan(0);
  });
});

describe('autoClaimForManualLog', () => {
  it('claims the user-local day the entry occurred on, not the server date', async () => {
    // 2026-08-02 23:30 in Los Angeles is 2026-08-03 06:30 UTC.
    seedUser();
    const result = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: '2026-08-03T06:30:00.000Z',
      timezone: 'America/Los_Angeles',
      source: 'food_log',
      referenceId: 'entry-1',
    });

    expect(result.claimed).toBe(true);
    expect(result.day).toBe('2026-08-02');
    const claim = db.getRows('streak_claims')[0];
    expect(claim.claim_date).toBe('2026-08-02');
    expect(claim.claim_method).toBe('manual_entry');
    expect(claim.metadata.source).toBe('food_log');
    expect(claim.metadata.reference_id).toBe('entry-1');
  });

  it('reports alreadyClaimed with the current streak instead of throwing', async () => {
    seedUser({ claims: [addDays(TODAY, -1), TODAY] });
    const result = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: `${TODAY}T12:00:00.000Z`,
      timezone: TZ,
      source: 'beverage_log',
    });
    expect(result.claimed).toBe(false);
    expect(result.alreadyClaimed).toBe(true);
    expect(result.streakCount).toBe(2);
    expect(db.getRows('streak_claims')).toHaveLength(2);
  });

  it('skips future-dated and out-of-window entries without writing a claim', async () => {
    seedUser();
    const future = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: addDays(TODAY, 1),
      timezone: TZ,
      source: 'food_log',
    });
    expect(future).toMatchObject({ claimed: false, alreadyClaimed: false, skipped: 'future' });

    const old = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: addDays(TODAY, -20),
      timezone: TZ,
      source: 'exercise_log',
    });
    expect(old).toMatchObject({ claimed: false, skipped: 'outside_window' });
    expect(db.getRows('streak_claims')).toHaveLength(0);
  });

  it('falls back to the timezone of the last claim when the client sent none', async () => {
    seedUser();
    db.getRows('streak_claims').length = 0;
    db.seed('streak_claims', [
      { user_id: USER, claim_date: addDays(TODAY, -3), claim_method: 'explicit', timezone: 'Asia/Kolkata', metadata: {} },
    ]);
    // 2026-08-03 20:00 UTC is already 2026-08-04 01:30 in Kolkata — but
    // NOW is 2026-08-03T12:00Z (17:30 IST), so "today" in IST is still 08-03
    // and a log stamped 2026-08-03T19:00Z (00:30 IST on the 4th) is "future".
    const result = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: '2026-08-03T19:00:00.000Z',
      timezone: null,
      source: 'food_log',
    });
    expect(result.day).toBe('2026-08-04');
    expect(result.skipped).toBe('future');
  });

  it('surfaces the milestone (and earned shield) from the underlying claim', async () => {
    seedUser({ claims: Array.from({ length: 6 }, (_, i) => addDays(TODAY, -(i + 1))) });
    const result = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: `${TODAY}T10:00:00.000Z`,
      timezone: TZ,
      source: 'food_log',
    });
    expect(result.claimed).toBe(true);
    expect(result.streakCount).toBe(7);
    expect(result.milestone?.milestone).toBe(7);
    expect(result.milestone?.shieldsGranted).toBeGreaterThan(0);
  });

  it('never throws — a database failure becomes skipped:error', async () => {
    seedUser();
    (createAdminSupabase as any).mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await StreakClaimingService.autoClaimForManualLog(USER, {
      occurredAt: TODAY,
      timezone: TZ,
      source: 'food_log',
    });
    expect(result).toMatchObject({ claimed: false, alreadyClaimed: false, skipped: 'error' });
  });
});
