/**
 * Retention fix 1: the guaranteed Day-1 morning push, against an in-memory DB.
 * Real: Day1MorningPushService + lib/journey/day1-morning.ts. Stubbed: the
 * orchestrator send (policy covered in quiet-hours-deferral-flow / push tests)
 * and remote config.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { Day1MorningPushService } from '../day1-morning-push-service';
import { NotificationOrchestrator } from '../notification-orchestrator';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
const rc = vi.hoisted(() => ({ on: 'on', hour: 8 }));
vi.mock('@/lib/remote-config/service', () => ({
  RemoteConfigService: { enumValue: async () => rc.on, value: async () => rc.hour },
}));

const U = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const SIGNUP = '2026-11-09T23:00:00Z'; // 17:00 Chicago, Nov 9
const NOW = new Date('2026-11-10T14:10:00Z'); // 08:10 Chicago, Nov 10

let db: FakeSupabase;
let send: MockInstance<typeof NotificationOrchestrator.send>;

beforeEach(() => {
  db = new FakeSupabase({
    profiles: {
      uniqueKey: ['id'],
      rows: [{ id: U, email: 'person@gmail.com', created_at: SIGNUP, timezone: 'America/Chicago', onboarding_completed: true, is_admin: false, is_active: true, metadata: {}, last_active_at: SIGNUP }],
    },
    push_tokens: { rows: [{ user_id: U, device_name: 'iPhone16,2', is_active: true }] },
    notification_preferences: { rows: [] },
    streak_claims: { rows: [] },
    user_attribution: { rows: [] },
    notification_log: { rows: [] },
    fitcircle_members: { rows: [] },
    fitcircles: { rows: [] },
    challenges: { rows: [] },
    daily_tracking: { rows: [] },
    food_log_entries: { rows: [] },
    engagement_streaks: { rows: [] },
    app_opens: { rows: [] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  send = vi.spyOn(NotificationOrchestrator, 'send').mockResolvedValue({ sent: true });
  rc.on = 'on';
  rc.hour = 8;
});
afterEach(() => vi.restoreAllMocks());

const sentData = () => send.mock.calls[0][2] as Record<string, any>;

describe('Day1MorningPushService.run', () => {
  it('sends once at 08:xx local the morning after sign-up: "neither" → start a circle', async () => {
    const r = await Day1MorningPushService.run({ now: NOW });
    expect(r).toMatchObject({ candidates: 1, due: 1, sent: 1, variants: { start_circle: 1 } });
    expect(send).toHaveBeenCalledWith(U, 'day1_morning', expect.objectContaining({ screen: 'circles', dedupeKey: `day1_morning:${U}`, localDate: '2026-11-10', variant: 'start_circle' }));
  });

  it('not before 08:00 local, not on the sign-up day', async () => {
    expect((await Day1MorningPushService.run({ now: new Date('2026-11-10T13:50:00Z') })).sent).toBe(0); // 07:50
    expect((await Day1MorningPushService.run({ now: new Date('2026-11-10T01:00:00Z') })).sent).toBe(0); // 19:00 Nov 9
    expect(send).not.toHaveBeenCalled();
  });

  it('logged a meal on Day 0 → breakfast to keep the streak going', async () => {
    db.getRows('food_log_entries').push({ id: 'f1', user_id: U, entry_type: 'food', deleted_at: null, created_at: '2026-11-10T01:00:00Z' });
    db.getRows('engagement_streaks').push({ user_id: U, current_streak: 1 });
    await Day1MorningPushService.run({ now: NOW });
    expect(sentData()).toMatchObject({ variant: 'meal_logged', screen: 'food_log', title: 'Good morning', body: 'Log breakfast to keep your streak going.' });
  });

  it('in a circle with a friend who synced steps → their real rank, opens that circle', async () => {
    db.getRows('fitcircle_members').push(
      { fitcircle_id: 'c1', user_id: U, status: 'active', joined_at: '2026-11-10T00:00:00Z' },
      { fitcircle_id: 'c1', user_id: FRIEND, status: 'active', joined_at: '2026-11-01T00:00:00Z' }
    );
    db.getRows('fitcircles').push({ id: 'c1', name: 'Office Walkers', visibility: 'private', status: 'active' });
    db.getRows('daily_tracking').push({ user_id: U, tracking_date: '2026-11-09', steps: 6412 }, { user_id: FRIEND, tracking_date: '2026-11-09', steps: 9000 });
    await Day1MorningPushService.run({ now: NOW });
    expect(sentData()).toMatchObject({ variant: 'circle_rank', screen: 'circle_detail', circleId: 'c1', body: 'You finished #2 of 2 with 6,412 steps. Today is a new race.' });
  });

  it('the public demo circle does not count as "in a circle"', async () => {
    db.getRows('fitcircle_members').push({ fitcircle_id: 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be', user_id: U, status: 'active', joined_at: SIGNUP });
    db.getRows('fitcircles').push({ id: 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be', name: 'FitCircle Demo', visibility: 'public', status: 'active' });
    await Day1MorningPushService.run({ now: NOW });
    expect(sentData().variant).toBe('start_circle');
  });

  it('skips a user who already opened the app this morning (07:30 local)', async () => {
    db.getRows('profiles')[0].last_active_at = '2026-11-10T13:30:00Z';
    const r = await Day1MorningPushService.run({ now: NOW });
    expect(r.skipped.opened_this_morning).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('a 1 a.m. session is still Day 0: the push goes out', async () => {
    db.getRows('profiles')[0].last_active_at = '2026-11-10T07:00:00Z'; // 01:00 Chicago
    expect((await Day1MorningPushService.run({ now: NOW })).sent).toBe(1);
  });

  it('one attempt ever: an existing day1_morning log row (even a quiet-hours hold) blocks a resend', async () => {
    db.getRows('notification_log').push({ user_id: U, notification_type: 'day1_morning', suppressed: true, sent_at: '2026-11-10T14:00:00Z', data: {} });
    const r = await Day1MorningPushService.run({ now: NOW });
    expect(r.skipped.already_attempted).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips test accounts and users without a push device', async () => {
    db.getRows('profiles')[0].email = 'qa@fitcircle.ai';
    expect((await Day1MorningPushService.run({ now: NOW })).skipped.test_user).toBe(1);
    db.getRows('profiles')[0].email = 'person@gmail.com';
    db.getRows('push_tokens').length = 0;
    expect((await Day1MorningPushService.run({ now: NOW })).skipped.no_device).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('remote config: day1_morning_push=off stops it; day1_morning_push_hour moves it', async () => {
    rc.on = 'off';
    expect((await Day1MorningPushService.run({ now: NOW })).skipped.switched_off).toBe(1);
    rc.on = 'on';
    rc.hour = 9;
    expect((await Day1MorningPushService.run({ now: NOW })).sent).toBe(0);
    expect((await Day1MorningPushService.run({ now: new Date('2026-11-10T15:05:00Z') })).sent).toBe(1);
  });

  it('times the morning in the device zone even when notification prefs still hold the New York default', async () => {
    db.getRows('notification_preferences').push({ user_id: U, quiet_hours_timezone: 'America/New_York' });
    // 08:10 New York = 07:10 Chicago → not yet.
    expect((await Day1MorningPushService.run({ now: new Date('2026-11-10T13:10:00Z') })).sent).toBe(0);
    expect((await Day1MorningPushService.run({ now: NOW })).sent).toBe(1);
  });

  it('onboarding not finished: "finish setup", unless a setup push already went out this morning', async () => {
    db.getRows('profiles')[0].onboarding_completed = false;
    db.getRows('notification_log').push({ user_id: U, notification_type: 'onboarding_finish_reminder', suppressed: false, sent_at: '2026-11-10T13:00:00Z', data: { touch: 1 } });
    expect((await Day1MorningPushService.run({ now: NOW })).skipped.setup_push_this_morning).toBe(1);
    db.getRows('notification_log').length = 0;
    await Day1MorningPushService.run({ now: NOW });
    expect(sentData()).toMatchObject({ variant: 'finish_setup', screen: 'dashboard' });
  });
});
