/**
 * meta.milestones on POST /api/mobile/food-log: `meals_logged_3_days` is
 * reported once per user, on the create that adds their 3rd distinct local day
 * with food (Android logs it as a Google Ads conversion).
 *
 * Real route + services over the in-memory Supabase fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST } from '../route';

const deferred: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, after: (cb: () => unknown) => void deferred.push(cb) };
});

vi.mock('@/lib/supabase-admin');
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: { onActivity: vi.fn() } }));
vi.mock('@/lib/services/circle-streak-service', () => ({
  CircleStreakService: { onMemberActivity: vi.fn() },
}));
vi.mock('@/lib/services/circle-meal-post-service', () => ({
  CircleMealPostService: {
    isShareableMeal: () => false,
    onMealLogged: vi.fn(async () => undefined),
    onMealDeleted: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: { enabled: false, reconcileEntry: vi.fn() },
}));

// 03:30 UTC on Oct 20 is 23:30 on Oct 19 in Toronto: the local day is the 19th.
const NOW = new Date('2026-10-20T03:30:00Z');
const TZ = 'America/Toronto';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ID1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ID2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

const PROFILE = {
  id: USER,
  email: 'a@example.com',
  subscription_tier: 'free',
  timezone: TZ,
  created_at: '2026-01-01T00:00:00Z',
  preferences: {},
  metadata: { seeded_by: 'qa' },
};

let db: FakeSupabase;

function food(id: string, entry_date: string, extra: Record<string, unknown> = {}) {
  return { id, user_id: USER, entry_type: 'food', entry_date, deleted_at: null, ...extra };
}

function seed(entries: Record<string, unknown>[]) {
  db.seed('profiles', [{ ...PROFILE, metadata: { ...PROFILE.metadata } }]);
  db.seed('feature_flags', [
    { name: 'food_logging', is_enabled: true, allowed_tiers: ['free', 'premium'], rollout_percentage: 0 },
  ]);
  db.seed('food_log_entries', entries);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: 1 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0, metadata: {} },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [{ user_id: USER, current_streak: 1, longest_streak: 1, paused: false, total_points: 0 }]);
  db.seed('streak_claims', [
    { user_id: USER, claim_date: '2026-10-19', claim_method: 'explicit', timezone: TZ, metadata: {} },
  ]);
}

const headers = { 'content-type': 'application/json', 'x-client-timezone': TZ };
const post = async (body: Record<string, unknown>) => {
  const res = await POST(
    new NextRequest('http://localhost/api/mobile/food-log', { method: 'POST', headers, body: JSON.stringify(body) })
  );
  return { status: res.status, body: await res.json() };
};
const meal = (extra: Record<string, unknown> = {}) => ({ entry_type: 'food', meal_type: 'lunch', title: 'Salad', ...extra });
const metadata = () => db.getRows('profiles')[0].metadata;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  deferred.length = 0;
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'] },
    food_log_entries: { uniqueKey: ['id'] },
    streak_claims: { uniqueKey: ['user_id', 'claim_date'] },
    streak_shields: { uniqueKey: ['user_id', 'shield_type'] },
    engagement_streaks: { uniqueKey: ['user_id'] },
    engagement_activities: { uniqueKey: ['user_id', 'activity_date', 'activity_type', 'reference_id'] },
  });
  (createAdminSupabase as any).mockReturnValue(db);
  authedUser = { ...PROFILE };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/mobile/food-log — meta.milestones', () => {
  it('reports meals_logged_3_days on the first meal of the 3rd distinct local day, and records it', async () => {
    seed([food('e1', '2026-10-15'), food('e2', '2026-10-15'), food('e3', '2026-10-17')]);

    const { status, body } = await post(meal({ id: ID1 }));

    expect(status).toBe(201);
    expect(body.data.entry_date).toBe('2026-10-19'); // the user's local day, not UTC's 20th
    expect(body.meta.milestones).toEqual(['meals_logged_3_days']);
    expect(metadata()).toEqual({
      seeded_by: 'qa', // other metadata keys kept
      milestones: { meals_logged_3_days: { at: NOW.toISOString(), entry_id: ID1 } },
    });
  });

  it('is reported once: a second meal the same day, and a 4th day, do not report it', async () => {
    seed([food('e1', '2026-10-15'), food('e3', '2026-10-17')]);
    expect((await post(meal({ id: ID1 }))).body.meta.milestones).toEqual(['meals_logged_3_days']);

    expect((await post(meal({ id: ID2 }))).body.meta.milestones).toBeUndefined();
    const nextDay = await post(meal({ logged_at: '2026-10-21T15:00:00Z' }));
    expect(nextDay.body.data.entry_date).toBe('2026-10-21');
    expect(nextDay.body.meta.milestones).toBeUndefined();
  });

  it('a retried create (same id) that reached it reports it again — the first response was lost', async () => {
    seed([food('e1', '2026-10-15'), food('e3', '2026-10-17')]);
    await post(meal({ id: ID1 }));

    const retry = await post(meal({ id: ID1 }));
    expect(retry.status).toBe(200);
    expect(retry.body.meta.duplicate).toBe(true);
    expect(retry.body.meta.milestones).toEqual(['meals_logged_3_days']);
  });

  it('never fires again after days are deleted and re-logged', async () => {
    seed([food('e1', '2026-10-15'), food('e3', '2026-10-17')]);
    await post(meal({ id: ID1 }));
    // Delete the 19th; logging the 21st makes it 3 days again.
    for (const r of db.getRows('food_log_entries')) if (r.id === ID1) r.deleted_at = NOW.toISOString();
    expect((await post(meal({ logged_at: '2026-10-21T15:00:00Z' }))).body.meta.milestones).toBeUndefined();
  });

  it('does not fire for days 1–2, for users already past 3 days, or for water / supplements', async () => {
    seed([food('e1', '2026-10-15')]);
    expect((await post(meal())).body.meta.milestones).toBeUndefined(); // 2nd day

    db = new FakeSupabase({ profiles: { uniqueKey: ['id'] }, food_log_entries: { uniqueKey: ['id'] }, streak_claims: { uniqueKey: ['user_id', 'claim_date'] }, streak_shields: { uniqueKey: ['user_id', 'shield_type'] }, engagement_streaks: { uniqueKey: ['user_id'] }, engagement_activities: { uniqueKey: ['user_id', 'activity_date', 'activity_type', 'reference_id'] } });
    (createAdminSupabase as any).mockReturnValue(db);
    seed([food('e1', '2026-10-10'), food('e2', '2026-10-12'), food('e3', '2026-10-14')]);
    expect((await post(meal())).body.meta.milestones).toBeUndefined(); // 4th day, reached before launch
    expect(metadata().milestones).toBeUndefined();
  });

  it('ignores water, deleted rows and other users when counting days', async () => {
    seed([
      food('e1', '2026-10-15'),
      food('w1', '2026-10-16', { entry_type: 'water' }),
      food('d1', '2026-10-17', { deleted_at: '2026-10-18T00:00:00Z' }),
      { ...food('o1', '2026-10-18'), user_id: OTHER },
    ]);
    expect((await post(meal())).body.meta.milestones).toBeUndefined(); // only the 2nd real day

    const water = await post({ entry_type: 'water', water_ml: 250, logged_at: '2026-10-21T15:00:00Z' });
    expect(water.body.meta.milestones).toBeUndefined();
    expect((await post(meal({ logged_at: '2026-10-21T15:00:00Z' }))).body.meta.milestones).toEqual([
      'meals_logged_3_days',
    ]);
  });

  it('a failed milestone check never fails the create', async () => {
    seed([food('e1', '2026-10-15'), food('e3', '2026-10-17')]);
    db.getRows('profiles').length = 0; // profile row unreadable → no milestone
    const { status, body } = await post(meal());
    expect(status).toBe(201);
    expect(body.meta.milestones).toBeUndefined();
  });
});
