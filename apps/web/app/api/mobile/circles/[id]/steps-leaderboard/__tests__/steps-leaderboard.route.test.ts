import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

const requireMobileAuth = vi.fn();
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { GET } from '../route';

const CIRCLE = '7d3f3a7d-1e1e-4ab1-85b5-bff9f619f0bf';
const ANI = 'd15217cf-28ec-4d31-bd2c-908330e8993a';
const ABHA = '4850c193-f591-4169-9173-e26bd35242c7';
const PAT = 'b7bf9d1d-074f-4fca-84c9-0e44baeefb0f';
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TZ = 'America/New_York';

const call = (id = CIRCLE, tz: string | null = TZ) =>
  GET(
    new Request(`http://localhost/api/mobile/circles/${id}/steps-leaderboard`, {
      headers: tz ? { 'x-client-timezone': tz } : {},
    }) as any,
    { params: Promise.resolve({ id }) }
  );

let db: CircleFakeDb;

function seed() {
  db.tables.fitcircles = [
    {
      id: CIRCLE, creator_id: ANI, name: 'Nov steps challenge', type: 'weight_loss', status: 'active',
      start_date: '2026-11-02T00:00:00+00:00', end_date: '2026-11-30T00:00:00+00:00', timezone: TZ,
    },
  ];
  db.tables.fitcircle_members = [ANI, ABHA, PAT].map((user_id) => ({
    id: db.newId(), fitcircle_id: CIRCLE, user_id, status: 'active', joined_at: '2026-11-01T20:00:00Z',
  }));
  db.tables.fitcircle_members.push({ id: db.newId(), fitcircle_id: CIRCLE, user_id: OUTSIDER, status: 'dropped' });
  db.tables.profiles = [
    { id: ANI, display_name: 'Ani', avatar_url: null, preferences: {}, goals: [], timezone: 'America/Toronto' },
    { id: ABHA, display_name: 'Abha', avatar_url: 'https://x/a.png', preferences: null, goals: [{ type: 'steps', daily_steps_target: 6000 }], timezone: 'UTC' },
    { id: PAT, display_name: 'Pat', avatar_url: null, preferences: { privacy: { show_progress: false } }, goals: [], timezone: TZ },
  ];
  db.tables.challenges = [
    { id: 'ch-1', fitcircle_id: CIRCLE, name: '8,000 Steps Daily', template_id: 'steps-8k-daily', unit: 'steps', status: 'scheduled', starts_at: '2026-11-02T20:02:00Z', participant_count: 3 },
    { id: 'ch-x', fitcircle_id: CIRCLE, name: 'Pushups', template_id: 'pushups-25-daily', unit: 'reps', status: 'active', starts_at: '2026-11-02T00:00:00Z', participant_count: 1 },
  ];
  db.tables.daily_tracking = [
    { user_id: ANI, tracking_date: '2026-10-30', steps: 12000, steps_synced_at: '2026-10-30T22:00:00Z' },
    { user_id: ANI, tracking_date: '2026-11-02', steps: 9000, steps_synced_at: '2026-11-02T22:00:00Z' },
    { user_id: ANI, tracking_date: '2026-11-03', steps: 4000, steps_synced_at: '2026-11-03T15:00:00Z' },
    { user_id: ABHA, tracking_date: '2026-11-03', steps: 8800, steps_synced_at: '2026-11-03T15:00:00Z' },
    { user_id: ABHA, tracking_date: '2026-11-02', steps: null, weight_kg: 70 },
    { user_id: PAT, tracking_date: '2026-11-03', steps: 20000 },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new CircleFakeDb();
  setCircleDb(db);
  seed();
  requireMobileAuth.mockResolvedValue({ id: ANI });
});
afterEach(() => vi.useRealTimers());

describe('GET /api/mobile/circles/[id]/steps-leaderboard', () => {
  it('ranks all members by steps during the circle', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T18:00:00Z'), toFake: ['Date'] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toMatchObject({
      circle_id: CIRCLE, is_steps_circle: true, phase: 'active', today: '2026-11-03', start_date: '2026-11-02',
      end_date: '2026-11-29', total_days: 28, day_number: 2, days_until_start: 0, member_count: 3,
      daily_goal: { steps: 8000, source: 'challenge' },
      challenge: { id: 'ch-1', name: '8,000 Steps Daily', participant_count: 3 },
      default_metric: 'today_steps',
    });
    const [first, second, third] = data.members;
    expect(first).toMatchObject({ user_id: ABHA, today_steps: 8800, total_steps: 8800, goal_pct_today: 110, daily_goal_steps: 8000, goal_source: 'challenge' });
    expect(first.ranks).toEqual({ today_steps: 1, total_steps: 2, goal_pct_today: 1 });
    expect(second).toMatchObject({ user_id: ANI, is_me: true, today_steps: 4000, total_steps: 13000, goal_pct_today: 50, days_goal_met: 1, steps_synced_recently: true });
    expect(second.ranks.total_steps).toBe(1);
    expect(second.days).toEqual([{ date: '2026-11-02', steps: 9000 }, { date: '2026-11-03', steps: 4000 }]);
    // Private member: listed, no numbers, unranked.
    expect(third).toMatchObject({ user_id: PAT, steps_visible: false, today_steps: null, total_steps: null, days: [] });
    expect(third.ranks.today_steps).toBeNull();
  });

  it('shows a pre-start board with no zeros', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T23:00:00Z'), toFake: ['Date'] });
    const { data } = await (await call()).json();
    expect(data).toMatchObject({ phase: 'upcoming', today: '2026-11-01', days_until_start: 1, day_number: null });
    for (const m of data.members) {
      expect(m.today_steps).toBeNull();
      expect(m.goal_pct_today).toBeNull();
      expect(m.ranks).toEqual({ today_steps: null, total_steps: null, goal_pct_today: null });
    }
    const ani = data.members.find((m: any) => m.user_id === ANI);
    expect(ani.steps_synced_recently).toBe(true);
    expect(data.members.find((m: any) => m.user_id === ABHA).steps_synced_recently).toBe(false);
  });

  it("falls back to each member's own step goal without a daily steps challenge", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T18:00:00Z'), toFake: ['Date'] });
    db.tables.challenges = [];
    db.tables.fitcircles[0].type = 'step_count';
    const { data } = await (await call()).json();
    expect(data.daily_goal).toBeNull();
    expect(data.challenge).toBeNull();
    expect(data.is_steps_circle).toBe(true);
    const abha = data.members.find((m: any) => m.user_id === ABHA);
    expect(abha).toMatchObject({ daily_goal_steps: 6000, goal_source: 'member', goal_pct_today: 147 });
    expect(data.members.find((m: any) => m.user_id === ANI)).toMatchObject({ daily_goal_steps: 10000, goal_source: 'default' });
  });

  it('is not a steps circle without steps type or challenge', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T18:00:00Z'), toFake: ['Date'] });
    db.tables.challenges = db.tables.challenges.filter((c) => c.unit !== 'steps');
    const { data } = await (await call()).json();
    expect(data.is_steps_circle).toBe(false);
  });

  it('accepts an uppercase circle id (iOS)', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T18:00:00Z'), toFake: ['Date'] });
    const res = await call(CIRCLE.toUpperCase());
    expect(res.status).toBe(200);
  });

  it('rejects non-members, unknown circles and bad ids', async () => {
    requireMobileAuth.mockResolvedValue({ id: OUTSIDER });
    expect((await call()).status).toBe(403);
    requireMobileAuth.mockResolvedValue({ id: ANI });
    expect((await call('11111111-1111-4111-8111-111111111111')).status).toBe(404);
    expect((await call('nope')).status).toBe(400);
  });

  it('answers 401 for a bad token', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });
});
