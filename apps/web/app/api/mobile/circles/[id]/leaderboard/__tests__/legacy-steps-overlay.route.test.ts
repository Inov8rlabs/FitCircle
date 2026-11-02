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
    expect(data[0]).toMatchObject({ rank: 1, user_id: BEA, progress_percentage: 75, current_value: 6, target_value: 8, goal_unit: 'k steps/day', starting_value: null });
    expect(data[1]).toMatchObject({ rank: 2, user_id: ANI, progress_percentage: 25, current_value: 2, target_value: 8 });
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
