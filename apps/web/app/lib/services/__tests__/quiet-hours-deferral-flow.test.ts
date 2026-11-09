/**
 * Retention fix 2 end to end: NotificationOrchestrator.send HOLDS a deferrable
 * nudge that hits quiet hours (one held row, user-local quiet hours), and
 * DeferredNudgeService.releaseDue releases at most one per user at the end of
 * quiet hours, through send() again (cap, prefs, dedupe re-applied).
 * Real: orchestrator, deferral policy, release service. Stubbed: DB (in-memory),
 * preferences, FCM, remote config.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { DeferredNudgeService } from '../deferred-nudge-service';
import { NotificationOrchestrator } from '../notification-orchestrator';
import type * as PushServiceModule from '../push-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const prefs = vi.hoisted(() => ({
  current: { quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00', quiet_hours_timezone: 'America/New_York' } as Record<string, any>,
}));
vi.mock('../notification-preferences-service', () => ({
  NotificationPreferencesService: {
    isTypeEnabled: async () => true,
    getPreferences: async () => prefs.current,
  },
}));
const sendPush = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('../push-service', async (orig) => {
  const actual = await orig<typeof PushServiceModule>();
  return { ...actual, PushService: { sendPush: (...a: unknown[]) => (sendPush as any)(...a) } };
});
const rc = vi.hoisted(() => ({ deferral: 'on' }));
vi.mock('@/lib/remote-config/service', () => ({
  RemoteConfigService: { enumValue: async (key: string) => (key === 'quiet_hours_deferral' ? rc.deferral : 'on'), value: async () => 8 },
}));

const U = '11111111-1111-4111-8111-111111111111';
// Chicago (CST, UTC-6): 23:30 local = 05:30Z next day; quiet hours end 07:00 local = 13:00Z.
const NIGHT = new Date('2026-11-10T05:30:00Z');
const MORNING = new Date('2026-11-10T13:05:00Z');

let db: FakeSupabase;
const log = () => db.getRows('notification_log');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NIGHT);
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'], rows: [{ id: U, timezone: 'America/Chicago', onboarding_completed: false, last_active_at: null }] },
    notification_log: { rows: [] },
    food_log_entries: { rows: [] },
    app_opens: { rows: [] },
  });
  // Every log insert gets sent_at = "now" like the DB default.
  const realFrom = db.from.bind(db);
  (db as any).from = (t: string) => {
    const q: any = realFrom(t);
    if (t === 'notification_log') {
      const ins = q.insert.bind(q);
      q.insert = (row: any) => ins({ sent_at: new Date().toISOString(), ...row });
    }
    return q;
  };
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  NotificationOrchestrator.resetInProcessGuards();
  sendPush.mockClear();
  rc.deferral = 'on';
  prefs.current = { quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00', quiet_hours_timezone: 'America/New_York' };
});
afterEach(() => {
  vi.useRealTimers();
});

const setup = (touch = 1) => NotificationOrchestrator.send(U, 'onboarding_finish_reminder', { touch, dedupeKey: `onboarding_finish:${U}:${touch}` });

describe('send() during quiet hours', () => {
  it('holds a setup nudge: one row, released at 07:00 in the USER’s zone (not New York)', async () => {
    // 23:30 Chicago is 00:30 New York: both quiet, but the hold must end at 07:00 Chicago (13:00Z), not 07:00 NY (12:00Z).
    const res = await setup();
    expect(res).toEqual({ sent: false, reason: 'deferred', deferUntil: '2026-11-10T13:00:00.000Z' });
    expect(sendPush).not.toHaveBeenCalled();
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatchObject({ suppressed: true, suppression_reason: 'deferred_quiet_hours', data: { deferUntil: '2026-11-10T13:00:00.000Z', timezone: 'America/Chicago' } });
  });

  it('quiet hours follow the device zone: 22:30 New York is 21:30 Chicago → sends now', async () => {
    vi.setSystemTime(new Date('2026-11-10T03:30:00Z')); // 22:30 NY, 21:30 Chicago
    expect(await setup()).toEqual({ sent: true });
  });

  it('non-deferrable types are still dropped (chat, streak nudges)', async () => {
    expect(await NotificationOrchestrator.send(U, 'momentum_at_risk', { currentMomentum: 3 })).toEqual({ sent: false, reason: 'quiet_hours' });
    expect(log()[0].suppression_reason).toBe('quiet_hours');
  });

  it('kill switch: remote config quiet_hours_deferral=off → dropped as before', async () => {
    rc.deferral = 'off';
    expect(await setup()).toEqual({ sent: false, reason: 'quiet_hours' });
  });
});

describe('DeferredNudgeService.releaseDue', () => {
  it('nothing before quiet hours end', async () => {
    await setup();
    vi.setSystemTime(new Date('2026-11-10T12:30:00Z')); // 06:30 Chicago
    const r = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(r.released).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('releases at the end of quiet hours through send() (delivered row with the original dedupe key)', async () => {
    await setup();
    vi.setSystemTime(MORNING);
    const r = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(r).toMatchObject({ heldUsers: 1, released: 1, sent: 1 });
    expect(sendPush).toHaveBeenCalledTimes(1);
    const delivered = log().filter((l) => l.suppressed === false);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ notification_type: 'onboarding_finish_reminder', data: { touch: 1, dedupeKey: `onboarding_finish:${U}:1`, deferredRelease: true } });
    expect(delivered[0].data.deferUntil).toBeUndefined();
    expect(log().find((l) => l.suppressed === true)?.suppression_reason).toBe('deferred_released');
    // A second run sends nothing more.
    const again = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(again.released).toBe(0);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('no stacking: two held nudges → one released, the other superseded', async () => {
    await setup(1);
    vi.setSystemTime(new Date(NIGHT.getTime() + 60 * 60_000));
    await NotificationOrchestrator.send(U, 'day1_morning', { title: 'Good morning', body: 'Log breakfast to keep your streak going.', dedupeKey: `day1_morning:${U}` });
    expect(log().filter((l) => l.suppression_reason === 'deferred_quiet_hours')).toHaveLength(2);
    vi.setSystemTime(MORNING);
    const r = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(r).toMatchObject({ released: 1, sent: 1, closed: { deferred_superseded: 1 } });
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(log().find((l) => l.suppressed === false)?.notification_type).toBe('day1_morning');
  });

  it('released sends still obey the daily cap', async () => {
    await setup();
    vi.setSystemTime(MORNING);
    for (let i = 0; i < 3; i++) {
      log().push({ id: `n${i}`, user_id: U, notification_type: 'fitzy_daily_focus', suppressed: false, sent_at: new Date(MORNING.getTime() - (i + 1) * 60_000).toISOString(), data: {} });
    }
    const r = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(r).toMatchObject({ released: 1, sent: 0, notSent: { frequency_cap: 1 } });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('stale: onboarding finished overnight → not sent', async () => {
    await setup();
    db.getRows('profiles')[0].onboarding_completed = true;
    vi.setSystemTime(MORNING);
    const r = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(r.closed['deferred_stale:onboarding_completed']).toBe(1);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('expired: a hold not released within its window is never sent late', async () => {
    await setup();
    vi.setSystemTime(new Date('2026-11-10T20:00:00Z')); // 14:00 Chicago, > 6 h after 07:00
    const r = await DeferredNudgeService.releaseDue({ now: new Date() });
    expect(r.closed.deferred_expired).toBe(1);
    expect(sendPush).not.toHaveBeenCalled();
  });
});
