/**
 * The member "Profile" sheet across circle types, privacy and shipped clients.
 * The real MemberProgressService runs against the in-memory database; only
 * the weight-goal derivation (UserService.getUserProgress) is stubbed.
 *
 * Repro: Anki in "Nov steps challenge" (prod, 2026-11-03 member-local). The
 * old /history answered her step totals in `entries[].weight`, which shipped
 * iOS rendered as "22286.5 lbs", "3498.7 lbs" and a 0-step "Nov 4" as "0.0 lbs".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

import {
  iosCheckInHistoryProblems,
  iosEnvelopeProblems,
  iosWeightProgressProblems,
} from '../../../../__tests__/ios-models';

const requireMobileAuth = vi.fn();
const getUserProgress = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_request: unknown, response: unknown) => response,
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
vi.mock('@/lib/services/user-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/services/user-service')>();
  class TestUserService extends original.UserService {
    static getUserProgress = (...args: unknown[]) => getUserProgress(...args);
  }
  return { ...original, UserService: TestUserService };
});

import { GET as getCircleProgress } from '../circle-progress/route';
import { GET as getHistory } from '../history/route';
import { GET as getProfile } from '../profile/route';
import { GET as getProgress } from '../progress/route';

const STEPS_CIRCLE = '7d3f3a7d-1e1e-4ab1-85b5-bff9f619f0bf';
const WEIGHT_CIRCLE = '22222222-2222-4222-8222-222222222222';
const CUSTOM_CIRCLE = '33333333-3333-4333-8333-333333333333';
const WORKOUT_CIRCLE = '44444444-4444-4444-8444-444444444444';
const EMPTY_CUSTOM = '55555555-5555-4555-8555-555555555555';
const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANKI = '8668f1c9-dadd-4e5e-9c3a-e03f24bfb218';
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Handler = typeof getHistory;
const call = (handler: Handler, kind: string, circleId: string, userId: string) =>
  handler(new Request(`http://localhost/api/mobile/circles/${circleId}/users/${userId}/${kind}`) as any, {
    params: Promise.resolve({ id: circleId, userId }),
  });
const json = async (handler: Handler, kind: string, circleId: string, userId = ANKI) => {
  const res = await call(handler, kind, circleId, userId);
  return { status: res.status, body: await res.json() };
};

let db: CircleFakeDb;
const setPrefs = (preferences: Record<string, unknown>) => {
  db.tables.profiles.find((p) => p.id === ANKI)!.preferences = preferences;
};

beforeEach(() => {
  vi.clearAllMocks();
  // 2026-11-03 14:00 UTC = 09:00 in Toronto: the day of the screenshot.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T14:00:00Z'));

  db = new CircleFakeDb();
  setCircleDb(db);
  db.tables.profiles = [
    { id: ANKI, display_name: 'Anki', avatar_url: null, preferences: {}, goals: null, timezone: 'America/Toronto' },
    { id: VIEWER, display_name: 'Ani', avatar_url: null, preferences: {}, goals: null, timezone: 'America/Toronto' },
    { id: OUTSIDER, display_name: 'Out', avatar_url: null, preferences: {}, goals: null, timezone: 'UTC' },
  ];
  const circle = (id: string, type: string) => ({
    id,
    type,
    name: type,
    start_date: '2026-11-02 00:00:00+00',
    end_date: '2026-11-30 00:00:00+00',
  });
  db.tables.fitcircles = [
    circle(STEPS_CIRCLE, 'step_count'),
    circle(WEIGHT_CIRCLE, 'weight_loss'),
    circle(CUSTOM_CIRCLE, 'custom'),
    circle(WORKOUT_CIRCLE, 'workout_minutes'),
    circle(EMPTY_CUSTOM, 'custom'),
  ];
  for (const fitcircle_id of [STEPS_CIRCLE, WEIGHT_CIRCLE, CUSTOM_CIRCLE, WORKOUT_CIRCLE, EMPTY_CUSTOM]) {
    for (const user_id of [ANKI, VIEWER]) {
      db.tables.fitcircle_members.push({ id: db.newId(), fitcircle_id, user_id, status: 'active' });
    }
  }
  db.tables.challenges = [
    { id: 'ch-steps', fitcircle_id: STEPS_CIRCLE, name: '8,000 Steps Daily', unit: 'steps', goal_amount: '224000.00', status: 'active', created_at: '2026-11-01' },
    { id: 'ch-reps', fitcircle_id: CUSTOM_CIRCLE, name: 'Pushups', unit: 'reps', goal_amount: '1000', status: 'active', created_at: '2026-11-01' },
  ];
  db.tables.challenge_participants = [
    { id: 'p1', challenge_id: 'ch-steps', user_id: ANKI, goal_completion_pct: '5.22' },
  ];
  db.tables.challenge_logs = [
    { id: 'l1', challenge_id: 'ch-reps', user_id: ANKI, amount: '40', note: null, log_date: '2026-11-02' },
    { id: 'l2', challenge_id: 'ch-reps', user_id: ANKI, amount: '35', note: 'evening', log_date: '2026-11-02' },
    { id: 'l3', challenge_id: 'ch-reps', user_id: ANKI, amount: '50', note: null, log_date: '2026-11-03' },
  ];
  db.tables.exercise_logs = [
    { id: 'x1', user_id: ANKI, duration_minutes: 30, exercise_date: '2026-11-02', is_public: true, is_deleted: false },
    { id: 'x2', user_id: ANKI, duration_minutes: 15, exercise_date: '2026-11-02', is_public: true, is_deleted: false },
    { id: 'x3', user_id: ANKI, duration_minutes: 60, exercise_date: '2026-11-03', is_public: true, is_deleted: true },
  ];
  // Anki's daily_tracking as on Nov 3: steps only, plus the 0-step "tomorrow" row.
  db.tables.daily_tracking = [
    { id: 'd-oct31', user_id: ANKI, tracking_date: '2026-10-31', steps: 9380, weight_kg: null, is_public: true, notes: null },
    { id: 'd-nov2', user_id: ANKI, tracking_date: '2026-11-02', steps: 10109, weight_kg: null, is_public: true, notes: null },
    { id: 'd-nov3', user_id: ANKI, tracking_date: '2026-11-03', steps: 1587, weight_kg: 89, is_public: true, notes: null },
    { id: 'd-nov4', user_id: ANKI, tracking_date: '2026-11-04', steps: 0, weight_kg: null, is_public: true, notes: null },
    { id: 'd-w1', user_id: ANKI, tracking_date: '2026-11-02', steps: null, weight_kg: 89.5, is_public: true, notes: null },
  ];
  // Two rows for Nov 2 would not exist in prod (unique per day); keep one weigh-in per day.
  db.tables.daily_tracking = db.tables.daily_tracking.filter((r) => r.id !== 'd-w1');
  db.tables.daily_tracking.find((r) => r.id === 'd-nov2')!.weight_kg = 89.5;

  requireMobileAuth.mockResolvedValue({ id: VIEWER });
  getUserProgress.mockResolvedValue({
    starting_weight: 94,
    current_weight: 89,
    target_weight: 84,
    progress_percentage: 50,
    weight_lost: 5,
    weight_to_go: 5,
    last_updated: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET .../circle-progress', () => {
  it('steps circle: step totals as steps, no 0 / future rows, member-local dates', async () => {
    const { status, body } = await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE);

    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      circle_type: 'step_count',
      metric: 'steps',
      unit: 'steps',
      label: 'Steps',
      aggregation: 'daily_total',
      can_view: true,
      hidden_reason: null,
      timezone: 'America/Toronto',
      today: '2026-11-03',
      period: { start: '2026-11-02', end: '2026-11-30' },
    });
    expect(body.data.entries).toEqual([
      { id: 'd-nov3', date: '2026-11-03', value: 1587, change: 1587 - 10109, is_public: true, note: null },
      { id: 'd-nov2', date: '2026-11-02', value: 10109, change: null, is_public: true, note: null },
    ]);
    expect(body.data.summary).toMatchObject({
      total: 11696,
      days_logged: 2,
      today_value: 1587,
      best_day: { date: '2026-11-02', value: 10109 },
      goal: 224000,
      progress_percentage: 5.2,
      starting: null,
      current: null,
    });
  });

  it('weight circle: kg weigh-ins, change = newer − older (negative = lost)', async () => {
    const { body } = await json(getCircleProgress, 'circle-progress', WEIGHT_CIRCLE);

    expect(body.data).toMatchObject({ metric: 'weight', unit: 'kg', aggregation: 'measurement', can_view: true });
    expect(body.data.entries.map((e: any) => [e.date, e.value, e.change])).toEqual([
      ['2026-11-03', 89, -0.5],
      ['2026-11-02', 89.5, null],
    ]);
    expect(body.data.summary).toMatchObject({ starting: 94, current: 89, target: 84, change: -5, progress_percentage: 50 });
  });

  it('custom circle: the challenge\'s own unit and label, summed per day, never converted', async () => {
    const { body } = await json(getCircleProgress, 'circle-progress', CUSTOM_CIRCLE);

    expect(body.data).toMatchObject({ metric: 'custom', unit: 'reps', label: 'Pushups' });
    expect(body.data.entries.map((e: any) => [e.date, e.value])).toEqual([
      ['2026-11-03', 50],
      ['2026-11-02', 75],
    ]);
    expect(body.data.summary).toMatchObject({ total: 125, goal: 1000, progress_percentage: 12.5 });
  });

  it('workout minutes circle: minutes per day, deleted workouts left out', async () => {
    const { body } = await json(getCircleProgress, 'circle-progress', WORKOUT_CIRCLE);

    expect(body.data).toMatchObject({ metric: 'workout_minutes', unit: 'min' });
    expect(body.data.entries.map((e: any) => [e.date, e.value])).toEqual([['2026-11-02', 45]]);
  });

  it('custom circle without a challenge: metric none, nothing (never the member\'s weight)', async () => {
    const { body } = await json(getCircleProgress, 'circle-progress', EMPTY_CUSTOM);

    expect(body.data).toMatchObject({ metric: 'none', unit: null, can_view: true, entries: [] });
  });

  describe('privacy', () => {
    it('show_weight off: weight circle hidden as weight_private; a steps circle still shows', async () => {
      setPrefs({ show_weight: false });
      const weight = (await json(getCircleProgress, 'circle-progress', WEIGHT_CIRCLE)).body.data;
      expect(weight).toMatchObject({ can_view: false, hidden_reason: 'weight_private', entries: [] });
      expect(weight.summary).toMatchObject({ starting: null, current: null, target: null, change: null });

      const steps = (await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE)).body.data;
      expect(steps.can_view).toBe(true);
      expect(steps.entries).toHaveLength(2);
    });

    it('show_progress off hides every metric', async () => {
      setPrefs({ show_progress: false });
      for (const circle of [STEPS_CIRCLE, WEIGHT_CIRCLE, CUSTOM_CIRCLE]) {
        const data = (await json(getCircleProgress, 'circle-progress', circle)).body.data;
        expect(data).toMatchObject({ can_view: false, hidden_reason: 'progress_private', entries: [] });
        expect(data.summary.total).toBeNull();
      }
    });

    it('private profile → profile_private', async () => {
      setPrefs({ profile_visibility: 'private' });
      expect((await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE)).body.data.hidden_reason).toBe('profile_private');
    });

    it('a viewer who is not in the circle sees nothing', async () => {
      requireMobileAuth.mockResolvedValue({ id: OUTSIDER });
      const data = (await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE)).body.data;
      expect(data).toMatchObject({ can_view: false, hidden_reason: 'not_in_circle', entries: [] });
    });

    it('days the member marked private are left out for others, shown to the member', async () => {
      db.tables.daily_tracking.find((r) => r.id === 'd-nov2')!.is_public = false;
      const others = (await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE)).body.data;
      expect(others.entries.map((e: any) => e.id)).toEqual(['d-nov3']);

      requireMobileAuth.mockResolvedValue({ id: ANKI });
      const own = (await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE, ANKI.toUpperCase())).body.data;
      expect(own.entries.map((e: any) => e.id)).toEqual(['d-nov3', 'd-nov2']);
    });
  });

  it('unknown circle → 404, unauthenticated → 401', async () => {
    expect((await call(getCircleProgress, 'circle-progress', '99999999-9999-4999-8999-999999999999', ANKI)).status).toBe(404);
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await call(getCircleProgress, 'circle-progress', STEPS_CIRCLE, ANKI)).status).toBe(401);
  });

  it('decodes as the standard envelope', async () => {
    const { body } = await json(getCircleProgress, 'circle-progress', STEPS_CIRCLE);
    expect(iosEnvelopeProblems(body)).toEqual([]);
  });
});

/**
 * Shipped clients (iOS 1.1.0 / 1.1.1, Android 1.1.1) read /profile, /progress
 * and /history and treat `weight` as kilograms. The server alone must stop
 * them showing step totals as weights.
 */
describe('shipped-client compatibility (legacy /profile, /progress, /history)', () => {
  it('steps circle /history: no step totals in `weight` any more — an empty list that still decodes', async () => {
    const { status, body } = await json(getHistory, 'history', STEPS_CIRCLE);

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ entries: [], total_count: 0, has_more: false, can_view: true, circle_metric: 'steps' });
    expect(JSON.stringify(body)).not.toContain('10109');
    expect(iosEnvelopeProblems(body)).toEqual([]);
    expect(iosCheckInHistoryProblems(body.data)).toEqual([]);
  });

  it('steps circle /progress: data null, so neither app renders a weight card', async () => {
    const { status, body } = await json(getProgress, 'progress', STEPS_CIRCLE);

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, data: null, error: null, meta: { metric: 'steps', unit: 'steps' } });
    expect(iosEnvelopeProblems(body)).toEqual([]);
    expect(getUserProgress).not.toHaveBeenCalled();
  });

  it('steps circle /profile: no weights; the badge is the steps goal %', async () => {
    const { body } = await json(getProfile, 'profile', STEPS_CIRCLE);

    expect(body.data).toMatchObject({
      display_name: 'Anki',
      current_weight: null,
      starting_weight: null,
      target_weight: null,
      weight_unit: null,
      progress_percentage: 5.2,
    });
  });

  it('weight circle /history: real kg weigh-ins, older → newer change, decodes as iOS CheckInHistory', async () => {
    const { body } = await json(getHistory, 'history', WEIGHT_CIRCLE);

    expect(body.data.entries).toEqual([
      { id: 'd-nov3', date: '2026-11-03', weight: 89, weight_change: -0.5, is_public: true, note: null, notes: null },
      { id: 'd-nov2', date: '2026-11-02', weight: 89.5, weight_change: null, is_public: true, note: null, notes: null },
    ]);
    expect(body.data).toMatchObject({ metric: 'weight', unit: 'kg', can_view: true });
    expect(iosCheckInHistoryProblems(body.data)).toEqual([]);
  });

  it('weight circle /progress: unchanged weight card plus metric/unit, decodes as iOS WeightProgressResponse', async () => {
    const { body } = await json(getProgress, 'progress', WEIGHT_CIRCLE);

    expect(body.data).toMatchObject({ starting_weight: 94, current_weight: 89, target_weight: 84, weight_unit: 'kg', can_view: true, metric: 'weight', unit: 'kg' });
    expect(iosWeightProgressProblems(body.data)).toEqual([]);
  });

  it('show_weight off: weight /history is private (was: every weigh-in shown), /progress can_view false', async () => {
    setPrefs({ show_weight: false });

    const history = (await json(getHistory, 'history', WEIGHT_CIRCLE)).body;
    expect(history.data).toMatchObject({ entries: [], can_view: false });
    expect(iosCheckInHistoryProblems(history.data)).toEqual([]);

    const progress = (await json(getProgress, 'progress', WEIGHT_CIRCLE)).body;
    expect(progress.data).toMatchObject({ can_view: false, current_weight: null, starting_weight: null });
    expect(iosWeightProgressProblems(progress.data)).toEqual([]);

    const profile = (await json(getProfile, 'profile', WEIGHT_CIRCLE)).body;
    expect(profile.data).toMatchObject({ current_weight: null, starting_weight: null, target_weight: null });
  });

  it('custom / workout circles never fall back to the member\'s weigh-ins', async () => {
    for (const circle of [CUSTOM_CIRCLE, WORKOUT_CIRCLE, EMPTY_CUSTOM]) {
      const { body } = await json(getHistory, 'history', circle);
      expect(body.data.entries).toEqual([]);
      expect((await json(getProgress, 'progress', circle)).body.data).toBeNull();
    }
  });
});
