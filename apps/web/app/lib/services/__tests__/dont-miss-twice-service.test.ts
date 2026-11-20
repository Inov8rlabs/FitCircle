/**
 * DontMissTwiceService.run (docs/ENGAGEMENT_115_SPEC.md §5.2) against an in-memory DB:
 * send hour, type choice, offer row, one per D across reruns, dry run without side effects,
 * the kill switches, and the night-push retirement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('../../supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
const send = vi.fn();
vi.mock('../notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return { ...real, NotificationOrchestrator: { ...real.NotificationOrchestrator, send: (...a: any[]) => send(...a) } };
});
const streak = vi.hoisted(() => ({ outcome: null as any, shields: { total: 0, unlimited: false } as any, calls: 0, onBreak: null as null | (() => void) }));
vi.mock('../streak-claiming-service', () => ({
  StreakClaimingService: {
    checkAndBreakStreak: async () => {
      streak.calls++;
      streak.onBreak?.();
      return streak.outcome;
    },
    getAvailableShields: async () => streak.shields,
  },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { resetRemoteConfigCache } from '@/lib/remote-config/service';

import { DontMissTwiceService } from '../dont-miss-twice-service';

const U = '11111111-1111-4111-8111-111111111111';
// 2026-11-13 14:20 UTC = 09:20 New York. D = 2026-11-12, D−1 = 2026-11-11.
const NOW = new Date('2026-11-13T14:20:00Z');
const ON = { DONT_MISS_TWICE_PUSH_ENABLED: 'true' };

let db: HomeFeedFakeDb;
const claim = (day: string, extra: Record<string, unknown> = {}) =>
  db.rows('streak_claims').push({ user_id: U, claim_date: day, claim_method: 'manual_entry', timezone: 'America/New_York', metadata: {}, claimed_at: `${day}T15:00:00Z`, ...extra });
const breakfastAt9 = (day: string) =>
  db.rows('food_log_entries').push({ user_id: U, entry_type: 'food', meal_type: 'breakfast', logged_at: `${day}T14:05:00Z`, deleted_at: null });

beforeEach(() => {
  db = new HomeFeedFakeDb();
  Object.assign(db.tables, {
    push_tokens: [], notification_preferences: [], notification_log: [], streak_claims: [], streak_save_offers: [],
    food_log_entries: [], exercise_logs: [], remote_config_rules: [], remote_config_defaults: [],
  });
  setHomeFeedDb(db);
  resetRemoteConfigCache();
  streak.outcome = { broken: true, zombieGuard: false, lostStreak: 6, shieldApplied: false, paywallEligible: true, currentStreak: 0 };
  streak.shields = { total: 0, unlimited: false };
  streak.calls = 0;
  streak.onBreak = null;
  send.mockReset().mockImplementation(async (userId: string, type: string, data: any) => {
    db.rows('notification_log').push({ user_id: userId, notification_type: type, data, suppressed: false, sent_at: NOW.toISOString() });
    return { sent: true };
  });
  db.rows('push_tokens').push({ user_id: U, is_active: true });
  db.rows('profiles').push({ id: U, timezone: 'America/New_York', subscription_tier: 'free' });
  for (const d of ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']) {
    claim(d);
    breakfastAt9(d); // first log 09:05 New York → send hour 9
  }
});
afterEach(() => vi.useRealTimers());

describe('DontMissTwiceService.run', () => {
  it('kill switch: env off → no run at all (and no protect-or-break)', async () => {
    const r = await DontMissTwiceService.run({ now: NOW, env: {} });
    expect(r).toMatchObject({ enabled: false, candidates: 0, sent: 0 });
    expect(streak.calls).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('free user, 6-day streak broke with no shield → streak_save_offer at the send hour, with an offer row', async () => {
    const r = await DontMissTwiceService.run({ now: NOW, env: ON });
    expect(r).toMatchObject({ enabled: true, sent: 1, byType: { streak_save_offer: 1 } });
    expect(streak.calls).toBe(1);
    const offers = db.rows('streak_save_offers');
    expect(offers).toEqual([expect.objectContaining({ user_id: U, missed_date: '2026-11-12', lost_streak: 6, status: 'offered', expires_at: '2026-11-14T08:00:00.000Z' })]);
    expect(send).toHaveBeenCalledWith(U, 'streak_save_offer', expect.objectContaining({
      title: 'Save your 6-day streak',
      body: 'You missed yesterday. A streak shield can still keep all 6 days. Today only.',
      route: 'streak_save', missedDate: '2026-11-12', lostStreak: 6, offerId: offers[0].id, dedupeKey: 'streak_save:2026-11-12',
    }));
  });

  it('one per D: a rerun (same hour or later) sends nothing', async () => {
    await DontMissTwiceService.run({ now: NOW, env: ON });
    const again = await DontMissTwiceService.run({ now: NOW, env: ON, allHours: true });
    expect(again.sent).toBe(0);
    expect(again.skipped.already_sent).toBe(1);
    expect(db.rows('streak_save_offers')).toHaveLength(1);
  });

  it('outside the send hour → nothing (send hour = modal first log, 9 am here)', async () => {
    const r = await DontMissTwiceService.run({ now: new Date('2026-11-13T16:20:00Z'), env: ON });
    expect(r.sent).toBe(0);
    expect(r.skipped.outside_send_hour).toBe(1);
    expect(streak.calls).toBe(0);
  });

  it('the nightly cron shielded D → dont_miss_twice shield_saved (no offer)', async () => {
    streak.outcome = { broken: false, zombieGuard: false, lostStreak: 0 };
    streak.shields = { total: 1, unlimited: false };
    streak.onBreak = () => claim('2026-11-12', { claim_method: 'freeze', metadata: { auto_applied: true } });
    const r = await DontMissTwiceService.run({ now: NOW, env: ON });
    expect(r.byType).toEqual({ dont_miss_twice: 1 });
    expect(send).toHaveBeenCalledWith(U, 'dont_miss_twice', expect.objectContaining({
      title: 'A shield saved your 7-day streak',
      body: 'Log breakfast today to keep it going. 1 shield left.',
      screen: 'food_log', route: 'log_meal_camera', mealType: 'breakfast', variant: 'shield_saved',
      missedDate: '2026-11-12', streakDays: 7, localDate: '2026-11-13', dedupeKey: 'dmt:2026-11-12',
    }));
    expect(db.rows('streak_save_offers')).toEqual([]);
  });

  it('below the save minimum → streak_restart; save offer switched off → the activity variant', async () => {
    streak.outcome = { broken: true, zombieGuard: false, lostStreak: 2 };
    await DontMissTwiceService.run({ now: NOW, env: ON });
    expect(send).toHaveBeenLastCalledWith(U, 'dont_miss_twice', expect.objectContaining({ variant: 'streak_restart' }));

    db.rows('notification_log').length = 0;
    db.rows('remote_config_defaults').push({ config_key: 'streak_save_offer', value: 'off', updated_by: null, updated_at: '2026-11-13T00:00:00Z' });
    resetRemoteConfigCache();
    streak.outcome = { broken: true, zombieGuard: false, lostStreak: 6 };
    await DontMissTwiceService.run({ now: NOW, env: ON });
    expect(send).toHaveBeenLastCalledWith(U, 'dont_miss_twice', expect.objectContaining({
      variant: 'meal', body: "You usually log breakfast around 9 am. Snap today's and you're back on track.",
    }));
  });

  it('skips: the user claimed D or today, D was not a first miss, the per-user switch is off', async () => {
    claim('2026-11-13');
    expect((await DontMissTwiceService.run({ now: NOW, env: ON })).skipped.claimed_today).toBe(1);
    db.rows('streak_claims').length = 0;
    claim('2026-11-09');
    expect((await DontMissTwiceService.run({ now: NOW, env: ON })).skipped.not_first_miss).toBe(1);
    claim('2026-11-11');
    db.rows('remote_config_defaults').push({ config_key: 'dont_miss_twice_push', value: 'off', updated_by: null, updated_at: '2026-11-13T00:00:00Z' });
    resetRemoteConfigCache();
    expect((await DontMissTwiceService.run({ now: NOW, env: ON })).skipped.switched_off).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('a claim that races in during the job (after protect-or-break) stops the push', async () => {
    streak.onBreak = () => claim('2026-11-13');
    const r = await DontMissTwiceService.run({ now: NOW, env: ON });
    expect(r.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('dry run: decisions + copy, no protect-or-break, no offer, no push (works with the env off)', async () => {
    const r = await DontMissTwiceService.run({ now: NOW, dryRun: true, allHours: true, env: {} });
    expect(r).toMatchObject({ dryRun: true, enabled: false, sent: 0 });
    expect(r.decisions[0]).toMatchObject({ userId: U, missedDate: '2026-11-12', sendHour: 9, type: 'streak_save_offer', copy: { title: 'Save your 6-day streak' } });
    expect(streak.calls).toBe(0);
    expect(db.rows('streak_save_offers')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    // With a shield left, the dry run predicts the nightly save.
    streak.shields = { total: 2, unlimited: false };
    const r2 = await DontMissTwiceService.run({ now: NOW, dryRun: true, allHours: true, env: {} });
    expect(r2.decisions[0]).toMatchObject({ type: 'dont_miss_twice', variant: 'shield_saved' });
  });
});
