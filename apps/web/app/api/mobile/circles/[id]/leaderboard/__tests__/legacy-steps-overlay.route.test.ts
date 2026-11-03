import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

const requireMobileAuth = vi.fn();
const getLeaderboard = vi.fn();
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a) }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
vi.mock('@/lib/services/circle-service', () => ({
  CircleService: {
    getCircle: async () => ({ id: CIRCLE, creator_id: ANI }),
    getCircleMembers: async () => [{ user_id: ANI }, { user_id: BEA }],
    getLeaderboard: (...a: unknown[]) => getLeaderboard(...a),
  },
}));

import { GET } from '../route';

const CIRCLE = '7d3f3a7d-1e1e-4ab1-85b5-bff9f619f0bf';
const ANI = 'd15217cf-28ec-4d31-bd2c-908330e8993a';
const BEA = '4850c193-f591-4169-9173-e26bd35242c7';

const goalRow = (user_id: string, rank: number) => ({
  rank, user_id, display_name: user_id === ANI ? 'Ani' : 'Bea', avatar_url: null, progress_percentage: 0, streak_days: 0,
  last_check_in_at: null, checked_in_today: false, high_fives_received: 0,
  current_value: null, starting_value: null, target_value: null, goal_type: null, goal_unit: null,
});

const call = () =>
  GET(
    new Request(`http://localhost/api/mobile/circles/${CIRCLE}/leaderboard`, { headers: { 'x-client-timezone': 'America/New_York' } }) as any,
    { params: Promise.resolve({ id: CIRCLE }) }
  );

let db: CircleFakeDb;
beforeEach(() => {
  db = new CircleFakeDb();
  setCircleDb(db);
  db.tables.fitcircles = [{ id: CIRCLE, creator_id: ANI, type: 'weight_loss', start_date: '2026-11-02', end_date: '2026-11-30', timezone: 'America/New_York' }];
  db.tables.fitcircle_members = [ANI, BEA].map((user_id) => ({ id: db.newId(), fitcircle_id: CIRCLE, user_id, status: 'active' }));
  db.tables.profiles = [
    { id: ANI, display_name: 'Ani', preferences: {}, goals: [], timezone: 'America/New_York' },
    { id: BEA, display_name: 'Bea', preferences: {}, goals: [], timezone: 'America/New_York' },
  ];
  db.tables.challenges = [{ id: 'c', fitcircle_id: CIRCLE, name: '8,000 Steps Daily', template_id: 'steps-8k-daily', unit: 'steps', status: 'active', participant_count: 2 }];
  db.tables.daily_tracking = [
    { user_id: ANI, tracking_date: '2026-11-02', steps: 4000 },
    { user_id: BEA, tracking_date: '2026-11-02', steps: 10000 },
    { user_id: BEA, tracking_date: '2026-11-03', steps: 2000 },
  ];
  requireMobileAuth.mockResolvedValue({ id: ANI });
  getLeaderboard.mockResolvedValue([goalRow(ANI, 1), goalRow(BEA, 2)]);
  vi.useFakeTimers({ now: new Date('2026-11-03T18:00:00Z'), toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('GET /api/mobile/circles/[id]/leaderboard — steps circle, shipped apps', () => {
  it('fills the goal fields from steps so old rows stop reading "No goal set"', async () => {
    const { data } = await (await call()).json();
    // 18:00 UTC = 13:00 New York on day 2: 1 + 13/24 goal-days -> 8,000 x 1.5417 = 12,333.
    expect(data[0]).toMatchObject({ rank: 1, user_id: BEA, progress_percentage: 97, current_value: 12, target_value: 12.3, goal_unit: 'k steps', starting_value: null });
    expect(data[1]).toMatchObject({ rank: 2, user_id: ANI, progress_percentage: 32, current_value: 4, target_value: 12.3 });
  });

  it('reflects a new step sync on the very next request, with no-store (nothing cached)', async () => {
    const first = await call();
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    db.tables.daily_tracking.push({ user_id: ANI, tracking_date: '2026-11-03', steps: 9000 });
    const { data } = await (await call()).json();
    // 13,000 total now beats Bea's 12,000.
    expect(data[0]).toMatchObject({ rank: 1, user_id: ANI, progress_percentage: 105, current_value: 13 });
  });

  it('serves members who joined after the first load (fresh roster each request)', async () => {
    const ADI = '7e42674a-8755-4045-a8b5-dca2488dd32b';
    db.tables.fitcircle_members.push({ id: db.newId(), fitcircle_id: CIRCLE, user_id: ADI, status: 'active' });
    db.tables.profiles.push({ id: ADI, display_name: 'Aditya', preferences: {}, goals: [], timezone: 'America/Toronto' });
    db.tables.daily_tracking.push({ user_id: ADI, tracking_date: '2026-11-03', steps: 2063 });
    getLeaderboard.mockResolvedValue([goalRow(ANI, 1), goalRow(BEA, 2), { ...goalRow(ADI, 3), display_name: 'Aditya' }]);
    const { data } = await (await call()).json();
    expect(data.map((e: any) => e.user_id)).toEqual([BEA, ANI, ADI]);
    expect(data[2]).toMatchObject({ rank: 3, progress_percentage: 17, current_value: 2.1, target_value: 12.3 });
  });

  it('decodes as the shipped iOS 1.1.0 / Android <= 1.1.1 LeaderboardEntry', async () => {
    // iOS 1.1.0 Core/Models/LeaderboardModels.swift (Codable, no key strategy): user_id UUID,
    // display_name String, rank Int required; every other field Double?/String?/Int?/Bool?.
    // Rows print "%.1f <goal_unit> -> %.1f <goal_unit> goal" when current_value > 0.
    const body = await (await call()).json();
    expect(body.success).toBe(true);
    for (const e of body.data) {
      expect(e.user_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(typeof e.display_name).toBe('string');
      expect(Number.isInteger(e.rank)).toBe(true);
      for (const k of ['progress_percentage', 'current_value', 'target_value', 'starting_value']) {
        expect(e[k] === null || typeof e[k] === 'number').toBe(true);
      }
      for (const k of ['goal_unit', 'goal_type', 'avatar_url']) expect(e[k] === null || typeof e[k] === 'string').toBe(true);
      // starting_value must stay null or the weight-only "x of y" line appears.
      expect(e.starting_value).toBeNull();
      // Rendered line: "%.1f k steps -> %.1f k steps goal"; nothing claims per-day/today.
      expect(e.goal_unit).toBe('k steps');
      expect(Number.isInteger(e.progress_percentage)).toBe(true);
    }
  });

  it('keeps the last day of a circle stored with a 23:59 end', async () => {
    db.tables.fitcircles[0].end_date = '2026-11-03T23:59:59+00:00';
    db.tables.fitcircles[0].start_date = '2026-11-02T00:00:00+00:00';
    const { data } = await (await call()).json();
    // Nov 3 is still a circle day (not "completed"), so it counts toward the total.
    expect(data[0]).toMatchObject({ user_id: BEA, current_value: 12 });
  });

  it('leaves non-steps circles alone', async () => {
    db.tables.challenges = [];
    const { data } = await (await call()).json();
    expect(data[0]).toMatchObject({ user_id: ANI, current_value: null, goal_unit: null });
  });

  it('keeps the goal board when the steps read fails', async () => {
    db.tables.fitcircles = [];
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data[0].user_id).toBe(ANI);
  });
});
