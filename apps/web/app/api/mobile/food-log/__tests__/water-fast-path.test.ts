/**
 * Water logging fast path (Hydration card, optimistic UI):
 *  - POST /api/mobile/food-log with entry_type water: lean path, `data.hydration`,
 *    idempotent on the client-supplied id, deferred side effects still run.
 *  - DELETE /api/mobile/food-log/[id] (Undo) returns `data.hydration` for water.
 *  - Non-water creates keep their contract.
 *
 * Real route handlers and services (feature flag, food log, streak claim, vitals)
 * over the in-memory Supabase fake; every query is logged so the tests can pin
 * which reads happen before the response and which work runs after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { DELETE } from '../[id]/route';
import { POST } from '../route';

// --- after(): queue instead of running, so "after the response" is observable ---
const deferred: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, after: (cb: () => unknown) => void deferred.push(cb) };
});
async function flushAfter() {
  while (deferred.length) await deferred.shift()!();
}

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
const mealPosts = vi.hoisted(() => ({ logged: [] as any[], deleted: [] as string[] }));
vi.mock('@/lib/services/circle-meal-post-service', () => ({
  CircleMealPostService: {
    isShareableMeal: (e: any) => e.entry_type === 'food' && !e.is_private,
    onMealLogged: vi.fn(async (e: any) => void mealPosts.logged.push(e.id)),
    onMealDeleted: vi.fn(async (id: string) => void mealPosts.deleted.push(id)),
  },
}));
const training = vi.hoisted(() => ({ reconciled: [] as any[] }));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: {
    enabled: true,
    reconcileEntry: vi.fn(async (...args: any[]) => void training.reconciled.push(args)),
  },
}));

// 03:30 UTC on Oct 20 is 23:30 on Oct 19 in Toronto: "today" must be the 19th.
const NOW = new Date('2026-10-20T03:30:00Z');
const TZ = 'America/Toronto';
const TODAY = '2026-10-19';
const YESTERDAY = '2026-10-18';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ENTRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let db: FakeSupabase;
let queryLog: string[];

const PROFILE = {
  id: USER,
  email: 'a@example.com',
  subscription_tier: 'free',
  timezone: TZ,
  created_at: '2026-01-01T00:00:00Z',
  preferences: { hydration: { daily_water_ml_target: 2500 } },
};

function seed({ claimedToday }: { claimedToday: boolean }) {
  db.seed('profiles', [PROFILE]);
  db.seed('feature_flags', [
    { name: 'food_logging', is_enabled: true, allowed_tiers: ['free', 'premium'], rollout_percentage: 0 },
  ]);
  db.seed('food_log_entries', [
    { id: 'e-1', user_id: USER, entry_type: 'water', water_ml: 500, entry_date: TODAY, deleted_at: null },
    // Excluded from today's total: deleted, another day, another user.
    { id: 'e-2', user_id: USER, entry_type: 'water', water_ml: 1000, entry_date: TODAY, deleted_at: '2026-10-19T12:00:00Z' },
    { id: 'e-3', user_id: USER, entry_type: 'water', water_ml: 700, entry_date: YESTERDAY, deleted_at: null },
    { id: 'e-4', user_id: OTHER, entry_type: 'water', water_ml: 900, entry_date: TODAY, deleted_at: null },
  ]);
  db.seed('beverage_logs', [
    { id: 'b-1', user_id: USER, category: 'water', volume_ml: 250, entry_date: TODAY, deleted_at: null },
  ]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: 1 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0, metadata: {} },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [{ user_id: USER, current_streak: 1, longest_streak: 1, paused: false, total_points: 0 }]);
  const claims = claimedToday ? [YESTERDAY, TODAY] : [YESTERDAY];
  db.seed(
    'streak_claims',
    claims.map((d) => ({ user_id: USER, claim_date: d, claim_method: 'explicit', timezone: TZ, metadata: {} }))
  );
}

function makeDb() {
  const fake = new FakeSupabase({
    profiles: { uniqueKey: ['id'] },
    food_log_entries: { uniqueKey: ['id'] },
    streak_claims: { uniqueKey: ['user_id', 'claim_date'] },
    streak_shields: { uniqueKey: ['user_id', 'shield_type'] },
    engagement_streaks: { uniqueKey: ['user_id'] },
    engagement_activities: { uniqueKey: ['user_id', 'activity_date', 'activity_type', 'reference_id'] },
  });
  // Log "table:op" for every query the code under test makes.
  const from = fake.from.bind(fake);
  (fake as any).from = (table: string) => {
    const q: any = from(table);
    let op = 'select';
    for (const m of ['insert', 'update', 'upsert']) {
      const orig = q[m].bind(q);
      q[m] = (...args: any[]) => ((op = m), orig(...args));
    }
    const record = () => queryLog.push(`${table}:${op}`);
    for (const m of ['single', 'maybeSingle']) {
      const orig = q[m].bind(q);
      q[m] = (...args: any[]) => (record(), orig(...args));
    }
    const then = q.then.bind(q);
    q.then = (res: any, rej: any) => (record(), then(res, rej));
    return q;
  };
  return fake;
}

const headers = { 'content-type': 'application/json', 'x-client-timezone': TZ };
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/mobile/food-log', { method: 'POST', headers, body: JSON.stringify(body) }));
const del = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/mobile/food-log/${id}`, { method: 'DELETE', headers }), {
    params: Promise.resolve({ id }),
  });
const rows = (table: string) => db.getRows(table);
const liveWater = () => rows('food_log_entries').filter((r) => r.user_id === USER && r.entry_type === 'water');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  deferred.length = 0;
  queryLog = [];
  mealPosts.logged = [];
  mealPosts.deleted = [];
  training.reconciled = [];
  db = makeDb();
  (createAdminSupabase as any).mockReturnValue(db);
  authedUser = { ...PROFILE }; // requireMobileAuth returns profiles.*
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/mobile/food-log — water', () => {
  it('creates the entry under the client id and returns today\'s hydration in the user\'s timezone', async () => {
    seed({ claimedToday: true });

    const res = await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250, is_private: false });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: ENTRY_ID, user_id: USER, entry_type: 'water', water_ml: 250, entry_date: TODAY });
    // 500 (earlier entry) + 250 (water beverage) + 250 (this one); deleted / other-day / other-user rows excluded.
    expect(body.data.hydration).toEqual({ todayMl: 1000, goalMl: 2500, date: TODAY });
    // Streak contract unchanged: already claimed today, streak 2.
    expect(body.meta.streak).toMatchObject({ claimed: false, alreadyClaimed: true, day: TODAY, streakCount: 2 });
    expect(body.meta.duplicate).toBeUndefined();
  });

  it('falls back to the default goal and matches GET /vitals/summary when no goal is set', async () => {
    seed({ claimedToday: true });
    authedUser = { ...PROFILE, preferences: {} };

    const body = await (await post({ entry_type: 'water', water_ml: 300 })).json();
    expect(body.data.hydration).toEqual({ todayMl: 1050, goalMl: 2000, date: TODAY });

    const { VitalsService } = await import('@/lib/services/vitals-service');
    db.getRows('profiles')[0].preferences = {};
    const summary = await VitalsService.getSummary(USER, { days: 7, timezone: TZ });
    expect(summary.water.today_ml).toBe(body.data.hydration.todayMl);
    expect(summary.water.goal_ml).toBe(body.data.hydration.goalMl);
    expect(summary.period.end).toBe(body.data.hydration.date);
  });

  it('takes the lean path: no profile re-reads, one streak read, audit after the response, no meal/training work', async () => {
    seed({ claimedToday: true });

    const res = await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    expect(res.status).toBe(201);

    // Before the response: flag, insert, the two hydration reads, ONE streak read.
    expect([...queryLog].sort()).toEqual(
      [
        'feature_flags:select',
        'food_log_entries:insert',
        'food_log_entries:select',
        'beverage_logs:select',
        'streak_claims:select',
      ].sort()
    );
    expect(queryLog).not.toContain('profiles:select'); // auth's profile is reused
    expect(rows('food_log_audit')).toHaveLength(0); // not yet

    // After the response: the audit row lands; nothing meal-related was scheduled.
    await flushAfter();
    expect(rows('food_log_audit')).toEqual([
      expect.objectContaining({ food_log_entry_id: ENTRY_ID, user_id: USER, action: 'create' }),
    ]);
    expect(mealPosts.logged).toEqual([]);
    expect(training.reconciled).toEqual([]);
    expect(rows('streak_claims')).toHaveLength(2); // nothing new claimed
  });

  it('first log of the day still claims the streak before responding (meta.streak drives the celebration)', async () => {
    seed({ claimedToday: false });

    const body = await (await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 })).json();

    expect(body.meta.streak).toMatchObject({ claimed: true, day: TODAY, streakCount: 2 });
    expect(rows('streak_claims').map((c) => c.claim_date).sort()).toEqual([YESTERDAY, TODAY]);
    expect(rows('streak_claims').find((c) => c.claim_date === TODAY)?.metadata).toMatchObject({
      source: 'food_log',
      reference_id: ENTRY_ID,
    });
    expect(body.data.hydration).toEqual({ todayMl: 1000, goalMl: 2500, date: TODAY });

    await flushAfter();
    expect(rows('food_log_audit')).toHaveLength(1);
  });

  it('is idempotent: a retried request with the same id returns the stored entry with 200, no duplicate', async () => {
    seed({ claimedToday: true });
    const req = { id: ENTRY_ID, entry_type: 'water', water_ml: 250, is_private: false };

    const first = await post(req);
    await flushAfter();
    const retry = await post(req);
    const retryBody = await retry.json();
    await flushAfter();

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retryBody.success).toBe(true);
    expect(retryBody.meta.duplicate).toBe(true);
    expect(retryBody.data).toMatchObject({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    // Counted once.
    expect(liveWater().filter((r) => r.id === ENTRY_ID)).toHaveLength(1);
    expect(retryBody.data.hydration).toEqual({ todayMl: 1000, goalMl: 2500, date: TODAY });
    // The retry re-reports the (idempotent) streak and writes no second audit row.
    expect(retryBody.meta.streak).toMatchObject({ alreadyClaimed: true, streakCount: 2 });
    expect(rows('food_log_audit')).toHaveLength(1);
  });

  it('a retry after Undo returns the (deleted) entry instead of resurrecting it', async () => {
    seed({ claimedToday: true });
    await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    await del(ENTRY_ID);

    const retry = await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    const body = await retry.json();

    expect(retry.status).toBe(200);
    expect(body.data.deleted_at).toBeTruthy();
    expect(body.data.hydration.todayMl).toBe(750); // 500 + 250 beverage; the undone glass stays gone
  });

  it('rejects an id that belongs to another user\'s entry with 409 and leaves it untouched', async () => {
    seed({ claimedToday: true });
    db.seed('food_log_entries', [{ id: ENTRY_ID, user_id: OTHER, entry_type: 'water', water_ml: 100, entry_date: TODAY }]);

    const res = await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('ID_CONFLICT');
    expect(rows('food_log_entries').filter((r) => r.id === ENTRY_ID)).toEqual([
      expect.objectContaining({ user_id: OTHER, water_ml: 100 }),
    ]);
  });

  it('ignores a missing or non-UUID id (server generates one), as before', async () => {
    seed({ claimedToday: true });

    const a = await (await post({ id: 'local-123', entry_type: 'water', water_ml: 250 })).json();
    const b = await (await post({ entry_type: 'water', water_ml: 250 })).json();

    expect(a.data.id).not.toBe('local-123');
    expect(b.data.id).toBeTruthy();
    expect(a.data.id).not.toBe(b.data.id);
    expect(b.data.hydration.todayMl).toBe(1250);
  });

  it('omits hydration (and still succeeds) when it cannot be computed', async () => {
    seed({ claimedToday: true });
    const { VitalsService } = await import('@/lib/services/vitals-service');
    const spy = vi.spyOn(VitalsService, 'getHydrationToday').mockRejectedValueOnce(new Error('db down'));

    const res = await post({ entry_type: 'water', water_ml: 250 });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.hydration).toBeUndefined();
    expect(body.data.entry_type).toBe('water');
    spy.mockRestore();
  });
});

describe('POST /api/mobile/food-log — non-water unchanged', () => {
  it('a meal: 201, no hydration, meta.streak, meal post + audit after the response', async () => {
    seed({ claimedToday: true });
    const { VitalsService } = await import('@/lib/services/vitals-service');
    const hydrationSpy = vi.spyOn(VitalsService, 'getHydrationToday');

    const res = await post({ entry_type: 'food', meal_type: 'lunch', notes: 'Chicken bowl', is_private: false });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ entry_type: 'food', meal_type: 'lunch', notes: 'Chicken bowl', entry_date: TODAY });
    expect(body.data).not.toHaveProperty('hydration');
    expect(body.meta.streak).toMatchObject({ alreadyClaimed: true, streakCount: 2 });
    expect(body.meta).not.toHaveProperty('duplicate');
    expect(hydrationSpy).not.toHaveBeenCalled();
    hydrationSpy.mockRestore();

    expect(mealPosts.logged).toEqual([]);
    await flushAfter();
    expect(mealPosts.logged).toEqual([body.data.id]);
    expect(training.reconciled).toHaveLength(1);
    expect(rows('food_log_audit')).toEqual([expect.objectContaining({ action: 'create', food_log_entry_id: body.data.id })]);
  });

  it('a supplement: 201, no hydration', async () => {
    seed({ claimedToday: true });
    const res = await post({ entry_type: 'supplement', supplement_name: 'Vitamin D' });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.supplement_name).toBe('Vitamin D');
    expect(body.data).not.toHaveProperty('hydration');
  });
});

describe('DELETE /api/mobile/food-log/[id] — Undo', () => {
  it('soft-deletes the water entry and returns the reduced hydration total', async () => {
    seed({ claimedToday: true });
    await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    await flushAfter();

    const res = await del(ENTRY_ID);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      deleted: true,
      entryId: ENTRY_ID,
      hydration: { todayMl: 750, goalMl: 2500, date: TODAY },
    });
    const row = rows('food_log_entries').find((r) => r.id === ENTRY_ID)!;
    expect(row.deleted_at).toBeTruthy(); // soft delete: the row stays

    await flushAfter();
    expect(rows('food_log_audit').map((a) => a.action)).toEqual(['create', 'delete']);
    expect(mealPosts.deleted).toEqual([]); // water never had a meal card
  });

  it('a retried Undo succeeds again (deleted: false — nothing left to delete — with the hydration total)', async () => {
    seed({ claimedToday: true });
    await post({ id: ENTRY_ID, entry_type: 'water', water_ml: 250 });
    await del(ENTRY_ID);
    const again = await del(ENTRY_ID);
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.data).toMatchObject({ deleted: false, entryId: ENTRY_ID });
    expect(body.data.hydration.todayMl).toBe(750);
  });

  it('is owner-only: another user\'s entry is not deleted and no hydration leaks', async () => {
    seed({ claimedToday: true });
    const res = await del('e-4'); // OTHER's water
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.data).toBeNull();
    expect(rows('food_log_entries').find((r) => r.id === 'e-4')!.deleted_at).toBeNull();
  });

  it('deleting a meal returns no hydration and tombstones its chat card after the response', async () => {
    seed({ claimedToday: true });
    db.seed('food_log_entries', [{ id: 'meal-1', user_id: USER, entry_type: 'food', meal_type: 'lunch', entry_date: TODAY }]);

    const body = await (await del('meal-1')).json();
    expect(body.data).toEqual({ deleted: true, entryId: 'meal-1' });
    expect(mealPosts.deleted).toEqual([]);
    await flushAfter();
    expect(mealPosts.deleted).toEqual(['meal-1']);
  });
});
