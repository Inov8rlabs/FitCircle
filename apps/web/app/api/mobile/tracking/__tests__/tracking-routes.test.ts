import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase } from '@/lib/services/__tests__/helpers/fake-supabase';

const requireMobileAuth = vi.fn();
const upsertDailyTracking = vi.fn();
const getDailyTrackingWithStats = vi.fn();
const canClaimStreak = vi.fn();
const claimStreak = vi.fn();
const calculateCurrentStreak = vi.fn();
const updateGoalCompletion = vi.fn();

let fake = createFakeSupabase();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => fake.client }));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    upsertDailyTracking: (...a: unknown[]) => upsertDailyTracking(...a),
    getDailyTrackingWithStats: (...a: unknown[]) => getDailyTrackingWithStats(...a),
  },
}));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: {
    canClaimStreak: (...a: unknown[]) => canClaimStreak(...a),
    claimStreak: (...a: unknown[]) => claimStreak(...a),
    calculateCurrentStreak: (...a: unknown[]) => calculateCurrentStreak(...a),
  },
}));
vi.mock('@/lib/services/daily-goals', () => ({
  DailyGoalService: { updateGoalCompletion: (...a: unknown[]) => updateGoalCompletion(...a) },
}));
vi.mock('@/lib/utils/timezone', () => ({
  getUserTimezone: async () => 'UTC',
  getTodayInTimezone: () => '2026-09-28',
  isWithinLastNDays: () => true,
  normalizeDateString: (d: string) => d,
}));

import { POST as bulkSync } from '../bulk-sync/route';
import { PUT } from '../daily/[date]/route';
import { POST as dailyPost } from '../daily/route';

const DATE = '2026-09-27';
const ROW = {
  id: 'row-1',
  user_id: 'user-1',
  tracking_date: DATE,
  weight_kg: 80,
  steps: 9000,
  mood_score: 7,
  energy_level: 6,
  notes: 'ok',
  steps_source: 'healthkit',
  is_override: false,
  is_public: true,
};

const json = (url: string, body: unknown, method: string) =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const put = (body: unknown, date = DATE) =>
  PUT(json(`http://localhost/api/mobile/tracking/daily/${date}`, body, 'PUT'), {
    params: Promise.resolve({ date }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fake = createFakeSupabase({ daily_tracking: [ROW] });
  requireMobileAuth.mockResolvedValue({ id: 'user-1' });
  upsertDailyTracking.mockImplementation(async (_u: string, _d: string, data: any) => ({
    ...fake.rows('daily_tracking')[0],
    ...(data.weight_kg !== undefined ? { weight_kg: data.weight_kg } : {}),
    ...(data.steps !== undefined ? { steps: data.steps } : {}),
  }));
  getDailyTrackingWithStats.mockResolvedValue({ data: [], stats: {} });
  canClaimStreak.mockResolvedValue({ canClaim: true, alreadyClaimed: false });
  claimStreak.mockResolvedValue({ streakCount: 3 });
  calculateCurrentStreak.mockResolvedValue(3);
});

describe('PUT /api/mobile/tracking/daily/[date] — clearing one metric', () => {
  it('OLD SHAPE: values update through the normal upsert and claim the streak', async () => {
    const res = await put({ weightKg: 79.5, steps: 10000 });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking).toHaveBeenCalledTimes(1);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({
      weight_kg: 79.5,
      steps: 10000,
      mood_score: undefined,
      is_override: true,
      skip_streak_tracking: false,
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.streak).toEqual({ claimed: true, count: 3 });
    expect(body).not.toHaveProperty('cleared');
  });

  it('OLD SHAPE: the privacy toggle (iOS / Android) is unchanged', async () => {
    const res = await put({ isPublic: false });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ is_public: false, weight_kg: undefined });
  });

  it.each([
    ['weightKg', 'weight_kg'],
    ['steps', 'steps'],
    ['moodScore', 'mood_score'],
    ['energyLevel', 'energy_level'],
    ['notes', 'notes'],
  ])('null %s clears only that column', async (key, column) => {
    const res = await put({ [key]: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data[column]).toBeNull();
    expect(body.cleared).toEqual([key]);

    const stored = fake.rows('daily_tracking')[0];
    for (const other of ['weight_kg', 'steps', 'mood_score', 'energy_level', 'notes'].filter((c) => c !== column)) {
      expect(stored[other]).toEqual((ROW as any)[other]);
    }
    expect(stored.steps_source).toBe('healthkit');
  });

  it('a clear is not a log: no upsert, no streak claim', async () => {
    const res = await put({ weightKg: null, autoClaimStreak: true, timezone: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking).not.toHaveBeenCalled();
    expect(canClaimStreak).not.toHaveBeenCalled();
    expect(claimStreak).not.toHaveBeenCalled();
    expect((await res.json()).streak).toEqual({ claimed: false });
  });

  it('clears several metrics at once', async () => {
    const res = await put({ moodScore: null, energyLevel: null });
    expect((await res.json()).cleared).toEqual(['moodScore', 'energyLevel']);
    expect(fake.rows('daily_tracking')[0]).toMatchObject({ mood_score: null, energy_level: null, weight_kg: 80 });
  });

  it('absent keys are left unchanged; values and clears can be mixed', async () => {
    const res = await put({ weightKg: 79, moodScore: null });
    expect(res.status).toBe(200);
    // the value goes through the normal path without the null…
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ weight_kg: 79, mood_score: undefined });
    // …and the clear is applied afterwards
    const stored = fake.rows('daily_tracking')[0];
    expect(stored.mood_score).toBeNull();
    expect(stored.steps).toBe(9000);
    expect((await res.json()).cleared).toEqual(['moodScore']);
  });

  it('clearing a day that has no row is a 404 and creates nothing', async () => {
    const res = await put({ steps: null }, '2026-09-20');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'No tracking data for this date' });
    expect(fake.rows('daily_tracking')).toHaveLength(1);
  });

  it("never touches another user's row", async () => {
    requireMobileAuth.mockResolvedValue({ id: 'user-2' });
    const res = await put({ weightKg: null });
    expect(res.status).toBe(404);
    expect(fake.rows('daily_tracking')[0].weight_kg).toBe(80);
  });

  it('null on a merely-optional field is ignored, not an error', async () => {
    const res = await put({ weightKg: 79, timezone: null, isPublic: null, autoClaimStreak: null });
    expect(res.status).toBe(200);
  });

  it('validation errors keep error + details and carry a specific message', async () => {
    const res = await put({ moodScore: 11 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.message).toContain('moodScore');
  });
});

describe('POST /api/mobile/tracking/daily — step source alias and nulls', () => {
  const post = (body: unknown) => dailyPost(json('http://localhost/api/mobile/tracking/daily', body, 'POST'));

  it('OLD SHAPE: healthkit steps are stored as healthkit and skip the streak', async () => {
    const res = await post({ trackingDate: DATE, steps: 8000, stepsSource: 'healthkit', autoClaimStreak: false });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ steps_source: 'healthkit', skip_streak_tracking: true });
  });

  it('apple_health is accepted and stored as healthkit (still auto-sync: no streak)', async () => {
    const res = await post({ trackingDate: DATE, steps: 8000, stepsSource: 'apple_health' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ steps_source: 'healthkit', skip_streak_tracking: true });
  });

  it('health_connect is accepted and stored as google_fit', async () => {
    const res = await post({ trackingDate: DATE, steps: 8000, stepsSource: 'health_connect' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ steps_source: 'google_fit', skip_streak_tracking: true });
  });

  it('OLD SHAPE: a manual entry still counts toward the streak', async () => {
    await post({ trackingDate: DATE, weightKg: 80 });
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ weight_kg: 80, skip_streak_tracking: false });
  });

  it('explicit nulls on unset fields are tolerated (what the iOS encoder and old Android send)', async () => {
    const res = await post({
      date: null,
      trackingDate: DATE,
      weightKg: 80,
      steps: null,
      moodScore: null,
      energyLevel: null,
      notes: null,
      stepsSource: null,
      stepsSyncedAt: null,
      isOverride: null,
    });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ weight_kg: 80, steps: undefined });
  });

  it('an unknown source is still rejected, with message + code + details', async () => {
    const res = await post({ trackingDate: DATE, steps: 1, stepsSource: 'fitbit' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('stepsSource');
    expect(body.error.message).toContain('stepsSource');
  });
});

describe('POST /api/mobile/tracking/bulk-sync — source alias', () => {
  const post = (body: unknown) => bulkSync(json('http://localhost/api/mobile/tracking/bulk-sync', body, 'POST'));
  const steps_data = [{ date: DATE, steps: 8000, is_override: true }];

  it('OLD SHAPE: healthkit / google_fit are unchanged', async () => {
    const res = await post({ steps_data, source: 'healthkit' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ steps_source: 'healthkit', is_override: true });
    const body = await res.json();
    expect(body.meta.source).toBe('healthkit');
    expect(body).toMatchObject({ success: true, failed_count: 0 });

    await post({ steps_data, source: 'google_fit' });
    expect(upsertDailyTracking.mock.calls[1][2]).toMatchObject({ steps_source: 'google_fit' });
  });

  it('apple_health is accepted and stored as healthkit', async () => {
    const res = await post({ steps_data, source: 'apple_health' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ steps_source: 'healthkit' });
    expect((await res.json()).meta.source).toBe('healthkit');
  });

  it('a null is_override is tolerated', async () => {
    const res = await post({ steps_data: [{ date: DATE, steps: 1, is_override: null }], source: 'healthkit' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking.mock.calls[0][2]).toMatchObject({ is_override: false });
  });

  it('manual and unknown sources are still rejected, now with a message', async () => {
    const res = await post({ steps_data, source: 'manual' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('source');
  });
});
