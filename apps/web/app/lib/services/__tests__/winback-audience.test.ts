import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Lifecycle audience gate + win-back ladder, end to end through the
// orchestrator (docs/PUSH_NOTIFICATIONS.md §8): in-memory Supabase, stubbed FCM.
//  - habit pushes suppressed for lapsed ('lapsed_user') / test ('test_user') users
//  - momentum_at_risk at most once per 3 days ('type_interval') + new copy
//  - test accounts get no Push Sent analytics event
//  - WinbackService: dry run sends nothing; a real run sends once per episode
//  - GET /api/cron/winback: cron-secret auth + dry run
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  db: null as any,
  calls: [] as Array<{ userId: string; n: any }>,
  scans: { total: 5, remaining: 3 } as { total: number | null; remaining: number | null },
}));

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => h.db }));
vi.mock('../notification-preferences-service', () => ({
  NotificationPreferencesService: {
    isTypeEnabled: async () => true,
    getPreferences: async () => ({ quiet_hours_start: null, quiet_hours_end: null, quiet_hours_timezone: 'America/New_York' }),
  },
}));
vi.mock('../push-service', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    PushService: {
      sendPush: async (userId: string, n: any, report?: { activeTokens: number; platforms: string[] }) => {
        h.calls.push({ userId, n });
        if (report) {
          report.activeTokens = 1;
          report.platforms = ['ios'];
        }
        return 1;
      },
    },
  };
});
vi.mock('../usage-service', () => ({ UsageService: { foodAiAllowance: async () => h.scans } }));
vi.mock('../../utils/after-response', () => ({ runAfterResponse: () => {} }));

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { pendingPushSentEvents, resetPushSentEvents } from '../../notifications/push-sent-events';
import { NotificationOrchestrator } from '../notification-orchestrator';
import { WinbackService } from '../winback-service';

const NOW = new Date('2026-11-13T23:30:00Z'); // 18:30 in New York
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const ACTIVE = 'a0000000-0000-4000-8000-000000000001';
const LAPSED = 'a0000000-0000-4000-8000-000000000002';
const TESTER = 'a0000000-0000-4000-8000-000000000003';
const TEAM = 'a0000000-0000-4000-8000-000000000009';
const DORMANT = 'a0000000-0000-4000-8000-000000000004';

const logs = () => h.db.getRows('notification_log') as any[];
const lastLog = () => logs().at(-1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.db = new FakeSupabase({ notification_log: {}, profiles: { uniqueKey: ['id'] } });
  h.db.seed('profiles', [
    { id: ACTIVE, email: 'active.person@gmail.com', timezone: 'America/New_York', created_at: daysAgo(40), last_active_at: daysAgo(1) },
    { id: LAPSED, email: 'lapsed.person@gmail.com', timezone: 'America/New_York', created_at: daysAgo(40), last_active_at: daysAgo(3), subscription_tier: 'free', longest_streak: 0 },
    { id: TEAM, email: 'ani@fitcircle.ai', timezone: 'America/New_York', created_at: daysAgo(40), last_active_at: daysAgo(0) },
    { id: TESTER, email: 'qa@example.com', timezone: 'America/New_York', created_at: daysAgo(40), last_active_at: daysAgo(0) },
    { id: DORMANT, email: 'gone.person@gmail.com', timezone: 'America/New_York', created_at: daysAgo(90), last_active_at: daysAgo(45) },
  ]);
  h.db.seed('push_tokens', [ACTIVE, LAPSED, TESTER, DORMANT, TEAM].map((user_id) => ({ id: `t-${user_id}`, user_id, is_active: true })));
  h.calls = [];
  h.scans = { total: 5, remaining: 3 };
  process.env.AMPLITUDE_SERVER_API_KEY = 'test-amplitude-key';
  resetPushSentEvents();
  NotificationOrchestrator.resetInProcessGuards();
});

describe('audience gate in NotificationOrchestrator.send', () => {
  it('habit pushes go to active users only', async () => {
    expect(await NotificationOrchestrator.send(ACTIVE, 'meal_reminder_lunch', { mealType: 'lunch', localDate: '2026-11-13' })).toEqual({ sent: true });
    expect(await NotificationOrchestrator.send(LAPSED, 'meal_reminder_lunch', { mealType: 'lunch', localDate: '2026-11-13' })).toEqual({ sent: false, reason: 'lapsed_user' });
    expect(lastLog()).toMatchObject({ user_id: LAPSED, suppressed: true, suppression_reason: 'lapsed_user' });
    expect(await NotificationOrchestrator.send(DORMANT, 'circle_streak_milestone', { circleName: 'Crew', streakDays: 7 })).toEqual({ sent: false, reason: 'dormant_user' });
    // Transactional: a real member's chat still reaches a dormant user.
    expect(await NotificationOrchestrator.send(DORMANT, 'chat_message', { friendName: 'Priya', circleName: 'Crew', preview: 'hi', circleId: 'c1' })).toMatchObject({ sent: true });
    expect(h.calls.map((c) => c.userId)).toEqual([ACTIVE, DORMANT]);
  });

  it('test accounts: no nudges, chat still delivered, and no Push Sent events at all', async () => {
    expect(await NotificationOrchestrator.send(TESTER, 'momentum_at_risk', { currentMomentum: 4 })).toEqual({ sent: false, reason: 'test_user' });
    expect(lastLog()).toMatchObject({ suppression_reason: 'test_user', data: expect.objectContaining({ testUser: 'qa' }) });
    expect(await NotificationOrchestrator.send(TESTER, 'chat_message', { friendName: 'Priya', circleName: 'Crew', preview: 'hi', circleId: 'c1' })).toMatchObject({ sent: true });
    expect(pendingPushSentEvents().filter((e) => e.user_id === TESTER)).toEqual([]);
    // A real user's rows still produce events.
    await NotificationOrchestrator.send(ACTIVE, 'momentum_at_risk', { currentMomentum: 4 });
    expect(pendingPushSentEvents().filter((e) => e.user_id === ACTIVE)).toHaveLength(1);
  });

  it('team (internal) accounts get nudges like real users, tagged and kept out of Push Sent analytics', async () => {
    expect(await NotificationOrchestrator.send(TEAM, 'momentum_at_risk', { currentMomentum: 4 })).toEqual({ sent: true });
    expect(lastLog()).toMatchObject({ suppressed: false, data: expect.objectContaining({ testUser: 'internal' }) });
    expect(pendingPushSentEvents().filter((e) => e.user_id === TEAM)).toEqual([]);
  });

  it('momentum_at_risk: new copy and at most once per 3 days', async () => {
    expect(await NotificationOrchestrator.send(ACTIVE, 'momentum_at_risk', { currentMomentum: 4, shieldsRemaining: 2 })).toEqual({ sent: true });
    expect(h.calls[0].n).toMatchObject({ title: 'Keep your 4-day streak going', body: 'One meal or workout logged today makes it 5 days. If today gets away from you, a shield covers it (2 left).' });
    // Pretend that one went out 2 days ago (the DB stamps sent_at).
    for (const r of logs()) r.sent_at = daysAgo(2);
    expect(await NotificationOrchestrator.send(ACTIVE, 'momentum_at_risk', { currentMomentum: 6 })).toEqual({ sent: false, reason: 'type_interval' });
    for (const r of logs()) r.sent_at = daysAgo(3);
    expect(await NotificationOrchestrator.send(ACTIVE, 'momentum_at_risk', { currentMomentum: 7 })).toEqual({ sent: true });
    // Streak 0: no "0-day streak".
    expect(NotificationOrchestrator.getNotificationContent('momentum_at_risk', { currentMomentum: 0 })!.title).toBe('One log starts a streak');
    expect(NotificationOrchestrator.getNotificationContent('momentum_at_risk', { currentMomentum: 3 })!.body).not.toMatch(/No shields|!/);
  });
});

describe('WinbackService', () => {
  it('dry run: decides and builds copy, sends nothing', async () => {
    const r = await WinbackService.run({ dryRun: true, now: NOW });
    expect(r.due).toEqual({ day3: 1, day7: 0, day14: 0, day30: 0 });
    const d = r.decisions.find((x) => x.userId === LAPSED)!;
    expect(d).toMatchObject({ step: 'day3', stage: 'lapsed_3', lapseStart: daysAgo(3).slice(0, 10), copy: { variant: 'scans_left', screen: 'food_log' } });
    expect(d.copy!.body).toContain('3 free meal scans left');
    expect(r.decisions.some((x) => x.userId === TESTER && x.step)).toBe(false);
    expect(h.calls).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });

  it('sends the step once per lapse episode (idempotent across runs)', async () => {
    const first = await WinbackService.run({ now: NOW });
    expect(first.sent).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ userId: LAPSED, n: { data: expect.objectContaining({ type: 'winback_day3', category: 'journey', screen: 'food_log', route: 'log_meal_camera' }) } });
    for (const r of logs()) r.sent_at = r.sent_at ?? NOW.toISOString();
    NotificationOrchestrator.resetInProcessGuards();
    const second = await WinbackService.run({ now: new Date(NOW.getTime() + 2 * 86_400_000) }); // day 5: same band
    expect(second.decisions.find((x) => x.userId === LAPSED)?.skip).toBe('already_sent');
    expect(h.calls.filter((c) => c.userId === LAPSED)).toHaveLength(1);
    // Meanwhile ACTIVE (last seen 1 day before NOW) has lapsed and starts its own episode.
    expect(second.decisions.find((x) => x.userId === ACTIVE)?.step).toBe('day3');
  });

  it('Pro users and 0-left users never see a scans count', async () => {
    h.scans = { total: 5, remaining: 0 };
    const r = await WinbackService.run({ dryRun: true, now: NOW });
    expect(r.decisions.find((x) => x.userId === LAPSED)!.copy!.variant).toBe('manual_log');
    h.db.getRows('profiles').find((p: any) => p.id === LAPSED).subscription_tier = 'premium';
    NotificationOrchestrator.resetInProcessGuards();
    const pro = await WinbackService.run({ dryRun: true, now: NOW });
    expect(pro.decisions.find((x) => x.userId === LAPSED)!.copy!.variant).toBe('two_taps');
  });
});

describe('GET /api/cron/winback', () => {
  it('fails closed without the cron secret, and dry-runs without sending', async () => {
    process.env.CRON_SECRET = 'cron-test';
    const { GET } = await import('../../../api/cron/winback/route');
    const { NextRequest } = await import('next/server');
    const unauth = await GET(new NextRequest('http://localhost/api/cron/winback?dry_run=1'));
    expect(unauth.status).toBe(401);
    const res = await GET(
      new NextRequest(`http://localhost/api/cron/winback?dry_run=1&all_windows=1&as_of=${encodeURIComponent(NOW.toISOString())}`, { headers: { authorization: 'Bearer cron-test' } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, dryRun: true, due: { day3: 1 } });
    expect(h.calls).toHaveLength(0);
    const bad = await GET(new NextRequest('http://localhost/api/cron/winback?as_of=2026-11-13', { headers: { authorization: 'Bearer cron-test' } }));
    expect(bad.status).toBe(400);
  });
});

describe('1.1.5 streak pushes on the wire (ENGAGEMENT_115_SPEC §5.2, §5.4)', () => {
  const dataOf = (i: number) => h.calls[i].n.data;

  it('dont_miss_twice: food_log + camera route + slot/variant/day keys; workout → exercise_log; unknown routes dropped', async () => {
    expect(
      await NotificationOrchestrator.send(ACTIVE, 'dont_miss_twice', {
        title: "Don't miss two days", body: "You usually log lunch around 12 pm. Snap today's and you're back on track.",
        screen: 'food_log', route: 'log_meal_camera', mealType: 'lunch', variant: 'meal', missedDate: '2026-11-12', streakDays: 0, dedupeKey: 'dmt:2026-11-12',
      })
    ).toEqual({ sent: true });
    expect(h.calls[0].n).toMatchObject({ title: "Don't miss two days" });
    expect(dataOf(0)).toMatchObject({
      type: 'dont_miss_twice', category: 'momentum', screen: 'food_log', route: 'log_meal_camera', mealType: 'lunch',
      variant: 'meal', missedDate: '2026-11-12', streakDays: '0', dedupeKey: 'dmt:2026-11-12', notification_id: expect.any(String),
    });
    NotificationOrchestrator.resetInProcessGuards();
    await NotificationOrchestrator.send(LAPSED, 'dont_miss_twice', { screen: 'exercise_log', variant: 'workout', missedDate: '2026-11-12' });
    expect(lastLog()).toMatchObject({ suppression_reason: 'lapsed_user' }); // habit push: active users only
    h.db.getRows('notification_log').length = 0;
    await NotificationOrchestrator.send(ACTIVE, 'dont_miss_twice', { title: 'x', body: 'y', screen: 'exercise_log', route: 'evil', variant: 'workout', missedDate: '2026-11-11', dedupeKey: 'dmt:2026-11-11' });
    expect(dataOf(1)).toMatchObject({ screen: 'exercise_log' });
    expect(dataOf(1).route).toBeUndefined();
  });

  it('streak_save_offer: streaks + streak_save route + offer keys; one per 44 h; milestone_achieved: streaks + streak_milestone', async () => {
    await NotificationOrchestrator.send(ACTIVE, 'streak_save_offer', {
      title: 'Save your 12-day streak', body: 'You missed yesterday. A streak shield can still keep all 12 days. Today only.',
      route: 'streak_save', missedDate: '2026-11-12', lostStreak: 12, offerId: 'o-1', dedupeKey: 'streak_save:2026-11-12',
    });
    expect(dataOf(0)).toMatchObject({ type: 'streak_save_offer', screen: 'streaks', route: 'streak_save', missedDate: '2026-11-12', lostStreak: '12', offerId: 'o-1' });
    NotificationOrchestrator.resetInProcessGuards();
    for (const r of logs()) r.sent_at = daysAgo(1); // the DB stamps sent_at: delivered 24 h ago
    expect(await NotificationOrchestrator.send(ACTIVE, 'streak_save_offer', { title: 'a', body: 'b', missedDate: '2026-11-13', dedupeKey: 'streak_save:2026-11-13' })).toEqual({ sent: false, reason: 'type_interval' });

    await NotificationOrchestrator.send(ACTIVE, 'milestone_achieved', { title: '7-day streak', body: '1-Week Warrior: 7 days in a row. Tap to celebrate.', route: 'streak_milestone', milestone: 7, dedupeKey: 'streak_milestone:7:2026-11-13' });
    expect(h.calls.at(-1)!.n).toMatchObject({ title: '7-day streak', data: expect.objectContaining({ type: 'milestone_achieved', category: 'celebration', screen: 'streaks', route: 'streak_milestone', milestone: '7' }) });
  });

  it('a delivered D+1 push replaces the win-back day 3 step', async () => {
    h.db.seed('notification_log', [{ id: 'n1', user_id: LAPSED, notification_type: 'dont_miss_twice', data: { missedDate: daysAgo(1).slice(0, 10) }, suppressed: false, sent_at: daysAgo(0.5) }]);
    const r = await WinbackService.run({ dryRun: true, now: NOW });
    expect(r.decisions.find((x) => x.userId === LAPSED)).toMatchObject({ skip: 'replaced_by_dont_miss_twice' });
  });
});
