import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// leaderboard_overtaken (snapshot → diff → push) and health_sync_update, through
// the orchestrator with an in-memory Supabase (docs/PUSH_NOTIFICATIONS.md §8.5–§8.6).
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  db: null as any,
  calls: [] as Array<{ userId: string; n: any }>,
  board: [] as Array<{ user_id: string; display_name: string; total_steps: number | null; steps_visible: boolean }>,
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
          report.platforms = ['android'];
        }
        return 1;
      },
    },
  };
});
vi.mock('../circle-steps-leaderboard-service', () => ({
  CircleStepsLeaderboardService: {
    build: async () => ({ ok: true, board: { is_steps_circle: true, phase: 'active', members: h.board } }),
  },
}));
vi.mock('../circle-service', () => ({ CircleService: { getLeaderboard: async () => [] } }));
vi.mock('../../utils/after-response', () => ({ runAfterResponse: () => {} }));

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { HealthSyncPushService } from '../health-sync-push-service';
import { LeaderboardOvertakeService } from '../leaderboard-overtake-service';
import { NotificationOrchestrator } from '../notification-orchestrator';

const NOW = new Date('2026-11-13T23:10:00Z'); // 18:10 New York
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const ids = { a: 'b0000000-0000-4000-8000-00000000000a', b: 'b0000000-0000-4000-8000-00000000000b', c: 'b0000000-0000-4000-8000-00000000000c', bot: 'b0000000-0000-4000-8000-0000000000ff' };
const CIRCLE = 'c0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.db = new FakeSupabase({ notification_log: {}, profiles: { uniqueKey: ['id'] }, circle_leaderboard_snapshots: { uniqueKey: ['circle_id', 'snapshot_date', 'metric', 'user_id'] } });
  h.db.seed('profiles', [
    { id: ids.a, email: 'ana.real@gmail.com', display_name: 'Ana Lopez', timezone: 'America/New_York', created_at: daysAgo(30), last_active_at: daysAgo(1) },
    { id: ids.b, email: 'priya.real@gmail.com', display_name: 'Priya', timezone: 'America/New_York', created_at: daysAgo(30), last_active_at: daysAgo(0.5) },
    { id: ids.c, email: 'sam.real@gmail.com', display_name: 'Sam', timezone: 'America/New_York', created_at: daysAgo(30), last_active_at: daysAgo(2) },
    { id: ids.bot, email: 'jamiesmith.12345@gmail.com', display_name: 'Jamie', timezone: 'America/New_York', created_at: daysAgo(30), last_active_at: daysAgo(0.5) },
  ]);
  h.db.seed('fitcircles', [{ id: CIRCLE, name: 'Morning Movers', type: 'step_count', status: 'active', visibility: 'invite_only', timezone: 'America/New_York', start_date: daysAgo(10), end_date: daysAgo(-10) }]);
  h.db.seed('fitcircle_members', Object.values(ids).map((user_id) => ({ fitcircle_id: CIRCLE, user_id, status: 'active' })));
  h.calls = [];
  NotificationOrchestrator.resetInProcessGuards();
});

const snap = (date: string, values: Record<string, number>) =>
  h.db.seed(
    'circle_leaderboard_snapshots',
    Object.entries(values).map(([k, value]) => ({ circle_id: CIRCLE, user_id: (ids as any)[k], snapshot_date: date, metric: 'total_steps', value }))
  );
const board = (values: Record<string, number>) => {
  h.board = Object.entries(values).map(([k, v]) => ({ user_id: (ids as any)[k], display_name: k === 'b' ? 'Priya' : k === 'a' ? 'Ana Lopez' : k === 'c' ? 'Sam' : 'Jamie', total_steps: v, steps_visible: true }));
};

describe('LeaderboardOvertakeService', () => {
  it('snapshots, diffs against yesterday and pushes one genuine pass', async () => {
    snap('2026-11-12', { a: 20_000, b: 19_000, c: 5_000, bot: 1_000 });
    board({ a: 24_000, b: 24_340, c: 6_000, bot: 99_000 }); // Priya passed Ana; the robot "passed" everyone
    const r = await LeaderboardOvertakeService.run({ now: NOW });
    expect(r.circlesSnapshotted).toBe(1);
    expect(h.db.getRows('circle_leaderboard_snapshots').filter((x: any) => x.snapshot_date === '2026-11-13')).toHaveLength(4);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      userId: ids.a,
      n: {
        title: 'Priya just moved past you in Morning Movers',
        body: "You're 340 steps behind #2. About 4 minutes of walking gets it back.",
        data: expect.objectContaining({ type: 'leaderboard_overtaken', category: 'circle', screen: 'circle_detail', circleId: CIRCLE }),
      },
    });
  });

  it('no previous snapshot (first day) → nothing; dry run writes nothing', async () => {
    board({ a: 24_000, b: 24_340, c: 6_000, bot: 1 });
    const r = await LeaderboardOvertakeService.run({ now: NOW, dryRun: true });
    expect(r.skippedCircles).toMatchObject({ no_previous_snapshot: 1 });
    expect(h.db.getRows('circle_leaderboard_snapshots')).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it('needs ≥ 3 recently active real members', async () => {
    h.db.getRows('profiles').find((p: any) => p.id === ids.c).last_active_at = daysAgo(20);
    snap('2026-11-12', { a: 20_000, b: 19_000, c: 5_000 });
    board({ a: 24_000, b: 24_340, c: 6_000 });
    const r = await LeaderboardOvertakeService.run({ now: NOW });
    expect(r.skippedCircles).toMatchObject({ too_few_active_members: 1 });
    expect(h.calls).toHaveLength(0);
  });

  it('once per day per user, and not the same pair again within a week', async () => {
    h.db.seed('notification_log', [
      { id: 'n1', user_id: ids.a, notification_type: 'leaderboard_overtaken', suppressed: false, sent_at: daysAgo(3), data: { circleId: CIRCLE, overtakerId: ids.b } },
    ]);
    snap('2026-11-12', { a: 20_000, b: 19_000, c: 5_000 });
    board({ a: 24_000, b: 24_340, c: 6_000 });
    const r = await LeaderboardOvertakeService.run({ now: NOW });
    expect(r.decisions[0]).toMatchObject({ recipientId: ids.a, skip: 'repeat_pair' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('HealthSyncPushService', () => {
  it('a lapsed user gets the workout update; a recently-open user does not', async () => {
    h.db.getRows('profiles').find((p: any) => p.id === ids.a).last_active_at = daysAgo(8);
    const workouts = [{ exerciseType: 'running', minutes: 32, date: '2026-11-13' }];
    const r = await HealthSyncPushService.onWorkoutsSynced(ids.a, { workouts, platform: 'android', streak: { claimed: true, day: '2026-11-13', streakCount: 1 } }, { now: NOW, settleMs: 0 });
    expect(r.result).toEqual({ sent: true });
    expect(h.calls[0].n).toMatchObject({
      title: 'Your 32-min run synced from Health Connect',
      body: "That counts toward today's streak. Tap to see your week.",
      data: expect.objectContaining({ type: 'health_sync_update', category: 'celebration', screen: 'exercise_log' }),
    });
    h.db.getRows('profiles').find((p: any) => p.id === ids.b).last_active_at = new Date(NOW.getTime() - 3_600_000).toISOString();
    const open = await HealthSyncPushService.onWorkoutsSynced(ids.b, { workouts, platform: 'android' }, { now: NOW, settleMs: 0 });
    expect(open.skip).toBe('recently_open');
  });

  it('at most one per day, never for robots, steps goal from the profile', async () => {
    h.db.getRows('profiles').find((p: any) => p.id === ids.a).last_active_at = daysAgo(8);
    h.db.getRows('profiles').find((p: any) => p.id === ids.a).goals = [{ type: 'steps', daily_steps_target: 8000 }];
    const first = await HealthSyncPushService.onStepsSynced(ids.a, { entries: [{ date: '2026-11-13', steps: 8_500 }], platform: 'ios' }, { now: NOW, settleMs: 0 });
    expect(first.update?.title).toBe('You hit your 8,000-step goal');
    expect(first.result).toEqual({ sent: true });
    for (const r of h.db.getRows('notification_log')) r.sent_at = r.sent_at ?? NOW.toISOString();
    NotificationOrchestrator.resetInProcessGuards();
    const again = await HealthSyncPushService.onWorkoutsSynced(ids.a, { workouts: [{ exerciseType: 'walking', minutes: 40, date: '2026-11-13' }], platform: 'ios' }, { now: NOW, settleMs: 0 });
    expect(again.result).toEqual({ sent: false, reason: 'type_interval' });
    h.db.getRows('profiles').find((p: any) => p.id === ids.bot).last_active_at = daysAgo(8);
    const bot = await HealthSyncPushService.onWorkoutsSynced(ids.bot, { workouts: [{ exerciseType: 'walking', minutes: 40, date: '2026-11-13' }], platform: 'android' }, { now: NOW, settleMs: 0 });
    expect(bot.skip).toBe('test_user');
  });
});
