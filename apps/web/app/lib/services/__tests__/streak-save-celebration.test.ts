/**
 * Streak save offers (docs/ENGAGEMENT_115_SPEC.md §5.3) and milestone celebrations (§5.4):
 * eligibility (zombie, too short, expiry at the grace end), opened marking, markSaved, the
 * webhook backstop applying once, the milestone push only without streak_celebration_v1, and
 * the pending celebration + ack.
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
const sc = vi.hoisted(() => ({ shields: { total: 0, unlimited: false } as any, activated: [] as string[], activateError: null as any }));
vi.mock('../streak-claiming-service', async () => {
  const { StreakClaimError } = await import('../../types/streak-claiming');
  return {
    StreakClaimingService: {
      resolveTimezone: async () => 'America/New_York',
      getAvailableShields: async () => sc.shields,
      activateFreeze: async (_u: string, date: string) => {
        if (sc.activateError) throw new StreakClaimError('dup', sc.activateError);
        sc.activated.push(date);
        return { shieldType: 'unlimited', remaining: 0, unlimited: true };
      },
    },
  };
});

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { resetRemoteConfigCache } from '@/lib/remote-config/service';

import { StreakCelebrationService } from '../streak-celebration-service';
import { StreakSaveService } from '../streak-save-service';

const U = '11111111-1111-4111-8111-111111111111';
let db: HomeFeedFakeDb;
const claim = (day: string, extra: Record<string, unknown> = {}) =>
  db.rows('streak_claims').push({ user_id: U, claim_date: day, claim_method: 'manual_entry', metadata: {}, ...extra });

beforeEach(() => {
  db = new HomeFeedFakeDb();
  Object.assign(db.tables, { streak_claims: [], streak_save_offers: [], streak_shields: [], notification_log: [], remote_config_rules: [], remote_config_defaults: [] });
  setHomeFeedDb(db);
  resetRemoteConfigCache();
  sc.shields = { total: 0, unlimited: false };
  sc.activated = [];
  sc.activateError = null;
  send.mockReset().mockResolvedValue({ sent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T15:00:00Z')); // 10:00 New York
  for (const d of ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']) claim(d);
});
afterEach(() => vi.useRealTimers());

describe('GET save-offer eligibility', () => {
  it('eligible: D = yesterday, 5-day run, free with no shields → paywall; the offer is created opened', async () => {
    const r = await StreakSaveService.getOffer(U);
    expect(r).toEqual({
      eligible: true, offer_id: expect.any(String), missed_date: '2026-11-12', lost_streak: 5, restored_streak: 6,
      expires_at: '2026-11-14T08:00:00.000Z', path: 'paywall', shields_available: 0, unlimited: false,
    });
    expect(db.rows('streak_save_offers')).toEqual([expect.objectContaining({ missed_date: '2026-11-12', status: 'offered', opened_at: expect.any(String) })]);
    // A second call reuses the row.
    const again = await StreakSaveService.getOffer(U);
    expect(again.eligible && again.offer_id).toBe(r.eligible && r.offer_id);
    expect(db.rows('streak_save_offers')).toHaveLength(1);
  });

  it('?peek=1 is read-only: no row created, opened_at never set (cards can poll it)', async () => {
    expect(await StreakSaveService.getOffer(U, { peek: true })).toMatchObject({ eligible: true, offer_id: null, missed_date: '2026-11-12' });
    expect(db.rows('streak_save_offers')).toEqual([]);
    db.rows('streak_save_offers').push({ id: 'push-made', user_id: U, missed_date: '2026-11-12', lost_streak: 5, status: 'offered', opened_at: null, expires_at: '2026-11-14T08:00:00.000Z' });
    expect(await StreakSaveService.getOffer(U, { peek: true })).toMatchObject({ offer_id: 'push-made' });
    expect(db.rows('streak_save_offers')[0].opened_at).toBeNull();
    // …so the webhook rescue does not fire for a peeked-only offer.
    expect(await StreakSaveService.applyAfterPurchase(U)).toBe(0);
  });

  it('restored_streak counts today when it is already claimed; Pro / shields → activate', async () => {
    claim('2026-11-13');
    sc.shields = { total: 0, unlimited: true };
    expect(await StreakSaveService.getOffer(U)).toMatchObject({ eligible: true, restored_streak: 7, path: 'activate', unlimited: true });
    sc.shields = { total: 1, unlimited: false };
    expect(await StreakSaveService.getOffer(U)).toMatchObject({ path: 'activate', shields_available: 1 });
  });

  it('marks an offer the D+1 push created as opened (first open only)', async () => {
    db.rows('streak_save_offers').push({ id: 'offer-1', user_id: U, missed_date: '2026-11-12', lost_streak: 5, status: 'offered', opened_at: null, expires_at: '2026-11-14T08:00:00.000Z' });
    const r = await StreakSaveService.getOffer(U);
    expect(r).toMatchObject({ offer_id: 'offer-1' });
    expect(db.rows('streak_save_offers')[0].opened_at).toEqual(expect.any(String));
  });

  it('ineligible: too short, zombie guard, nothing to save, expired after the grace end', async () => {
    db.rows('streak_claims').length = 0;
    claim('2026-11-10');
    claim('2026-11-11');
    expect(await StreakSaveService.getOffer(U)).toEqual({ eligible: false, reason: 'too_short' });

    db.rows('streak_claims').length = 0;
    for (const d of ['2026-11-07', '2026-11-08', '2026-11-09']) claim(d);
    claim('2026-11-10', { claim_method: 'freeze', metadata: { auto_applied: true } });
    claim('2026-11-11', { claim_method: 'freeze', metadata: { auto_applied: true } });
    expect(await StreakSaveService.getOffer(U)).toEqual({ eligible: false, reason: 'zombie_guard' });

    db.rows('streak_claims').length = 0;
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) claim(d);
    expect(await StreakSaveService.getOffer(U)).toEqual({ eligible: false, reason: 'nothing_to_save' });

    // D = Nov 12 broke; at 02:59 New York on Nov 14 (grace) the offer still stands; at 03:00 it expired.
    db.rows('streak_claims').length = 0;
    for (const d of ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']) claim(d);
    vi.setSystemTime(new Date('2026-11-14T07:59:00Z'));
    expect(await StreakSaveService.getOffer(U)).toMatchObject({ eligible: true, missed_date: '2026-11-12' });
    vi.setSystemTime(new Date('2026-11-14T08:00:00Z'));
    expect(await StreakSaveService.getOffer(U)).toEqual({ eligible: false, reason: 'expired' });
  });
});

describe('saving', () => {
  it('activate marks the offered row saved (once)', async () => {
    db.rows('streak_save_offers').push({ id: 'o1', user_id: U, missed_date: '2026-11-12', status: 'offered', opened_at: null, expires_at: '2026-11-14T08:00:00.000Z' });
    expect(await StreakSaveService.markSaved(U, '2026-11-12', 'shield')).toBe(true);
    expect(db.rows('streak_save_offers')[0]).toMatchObject({ status: 'saved', method: 'shield', saved_at: expect.any(String) });
    expect(await StreakSaveService.markSaved(U, '2026-11-12', 'pro_unlimited')).toBe(false);
    expect(db.rows('streak_save_offers')[0].method).toBe('shield');
  });

  it('webhook backstop: opened + unexpired offers are protected and marked after_purchase, exactly once', async () => {
    db.rows('streak_save_offers').push(
      { id: 'open', user_id: U, missed_date: '2026-11-12', status: 'offered', opened_at: '2026-11-13T14:00:00Z', expires_at: '2026-11-14T08:00:00.000Z' },
      { id: 'unopened', user_id: U, missed_date: '2026-11-05', status: 'offered', opened_at: null, expires_at: '2026-11-14T08:00:00.000Z' },
      { id: 'expired', user_id: U, missed_date: '2026-11-01', status: 'offered', opened_at: '2026-11-02T00:00:00Z', expires_at: '2026-11-03T08:00:00.000Z' }
    );
    expect(await StreakSaveService.applyAfterPurchase(U)).toBe(1);
    expect(sc.activated).toEqual(['2026-11-12']);
    expect(db.rows('streak_save_offers').find((o) => o.id === 'open')).toMatchObject({ status: 'saved', method: 'after_purchase' });
    expect(db.rows('streak_save_offers').find((o) => o.id === 'unopened')!.status).toBe('offered');
    // A second webhook delivery changes nothing.
    expect(await StreakSaveService.applyAfterPurchase(U)).toBe(0);
    expect(sc.activated).toEqual(['2026-11-12']);
  });

  it('webhook backstop when the client already saved the day (ALREADY_CLAIMED): no double save', async () => {
    db.rows('streak_save_offers').push({ id: 'open', user_id: U, missed_date: '2026-11-12', status: 'offered', opened_at: '2026-11-13T14:00:00Z', expires_at: '2026-11-14T08:00:00.000Z' });
    sc.activateError = 'ALREADY_CLAIMED';
    expect(await StreakSaveService.applyAfterPurchase(U)).toBe(0);
  });

  it('no table yet (migration 138 not applied) never throws', async () => {
    delete (db.tables as any).streak_save_offers;
    await expect(StreakSaveService.applyAfterPurchase(U)).resolves.toBeTypeOf('number');
    await expect(StreakSaveService.markSaved(U, '2026-11-12', 'shield')).resolves.toBeTypeOf('boolean');
  });
});

describe('milestone celebrations', () => {
  it('push: copy, route, dedupe; streak_milestone_push off → no push', async () => {
    await StreakCelebrationService.notifyMilestone(U, { days: 7, name: '1-Week Warrior', shieldsGranted: 1, boundaryDay: '2026-11-13' });
    expect(send).toHaveBeenCalledWith(U, 'milestone_achieved', expect.objectContaining({
      title: '7-day streak', body: '1-Week Warrior: 7 days in a row. Tap to celebrate. You earned a streak shield.',
      route: 'streak_milestone', milestone: 7, dedupeKey: 'streak_milestone:7:2026-11-13',
    }));
    db.rows('remote_config_defaults').push({ config_key: 'streak_milestone_push', value: 'off', updated_by: null, updated_at: '2026-11-13T00:00:00Z' });
    resetRemoteConfigCache();
    expect(await StreakCelebrationService.notifyMilestone(U, { days: 14, name: 'x', shieldsGranted: 0, boundaryDay: '2026-11-13' })).toEqual({ sent: false, reason: 'switched_off' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('pending celebration is served within 72 h and cleared by ack (idempotent, keeps other metadata)', async () => {
    db.rows('streak_shields').push({
      user_id: U, shield_type: 'milestone_shield', available_count: 1,
      metadata: { paid_boundaries: ['7:2026-11-13'], pending_celebration: { days: 7, name: '1-Week Warrior', icon: 'flame', day: '2026-11-13', at: '2026-11-13T14:00:00Z', shieldsGranted: 1 } },
    });
    expect(await StreakCelebrationService.getPending(U)).toEqual({ milestone: 7, name: '1-Week Warrior', icon: 'flame', shields_granted: 1, reached_on: '2026-11-13' });
    await StreakCelebrationService.ack(U, 30); // a different milestone: no-op
    expect(await StreakCelebrationService.getPending(U)).not.toBeNull();
    await StreakCelebrationService.ack(U, 7);
    expect(await StreakCelebrationService.getPending(U)).toBeNull();
    expect(db.rows('streak_shields')[0].metadata).toEqual({ paid_boundaries: ['7:2026-11-13'] });
    await expect(StreakCelebrationService.ack(U, 7)).resolves.toBeUndefined();
  });
});
