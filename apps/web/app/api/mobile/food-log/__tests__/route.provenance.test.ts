import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/mobile/food-log — provenance columns + draft reconciliation hook (migration 097).

const calls = { create: [] as any[], reconcile: [] as any[], after: 0 };

vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return {
    ...original,
    // `after()` needs a request scope in Next; run the callback inline here.
    after: (cb: () => unknown) => {
      calls.after++;
      return cb();
    },
  };
});
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/feature-flag-service', () => ({
  FeatureFlagService: { isFeatureEnabled: async () => ({ enabled: true }) },
}));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: { autoClaimForManualLog: async () => null },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: {
    get enabled() {
      return process.env.NUTRITION_TRAINING_CAPTURE === 'true';
    },
    reconcileEntry: async (...args: unknown[]) => {
      calls.reconcile.push(args);
    },
  },
}));
vi.mock('@/lib/services/food-log-service', () => ({
  FoodLogService: {
    createEntry: async (userId: string, data: any) => {
      calls.create.push(data);
      return {
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          user_id: userId,
          is_private: false,
          logged_at: '2026-10-13T10:00:00.000Z',
          created_at: '2026-10-13T10:00:01.000Z',
          ...data,
        },
        error: null,
      };
    },
  },
}));

import { POST } from '../route';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/mobile/food-log', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as any
  );

const photoMeal = {
  entry_type: 'food',
  meal_type: 'lunch',
  title: 'Chicken and rice',
  nutrition_data: {
    calories: 406,
    protein_g: 41,
    items: [{ name: 'grilled chicken breast', grams: 120, calories: 198, protein_g: 37 }],
  },
};

describe('POST /api/mobile/food-log — provenance', () => {
  const originalFlag = process.env.NUTRITION_TRAINING_CAPTURE;
  beforeEach(() => {
    calls.create = [];
    calls.reconcile = [];
    calls.after = 0;
  });
  afterEach(() => {
    process.env.NUTRITION_TRAINING_CAPTURE = originalFlag;
  });

  it('passes explicit provenance fields through to the service', async () => {
    const res = await post({
      ...photoMeal,
      input_method: 'photo',
      nutrition_source: 'llm_vision',
      llm_confidence: 0.83,
      food_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(res.status).toBe(201);
    expect(calls.create[0]).toMatchObject({
      input_method: 'photo',
      nutrition_source: 'llm_vision',
      llm_confidence: 0.83,
      food_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('rejects unknown provenance values instead of storing garbage', async () => {
    expect((await post({ ...photoMeal, input_method: 'telepathy' })).status).toBe(400);
    expect((await post({ ...photoMeal, nutrition_source: 'guess' })).status).toBe(400);
    expect((await post({ ...photoMeal, llm_confidence: 7 })).status).toBe(400);
    expect((await post({ ...photoMeal, food_id: 'not-a-uuid' })).status).toBe(400);
    expect(calls.create).toHaveLength(0);
  });

  it('with capture on: reconciles after the response, handing over the stored entry + explicit values', async () => {
    process.env.NUTRITION_TRAINING_CAPTURE = 'true';
    const res = await post({ ...photoMeal, input_method: 'photo' });
    expect(res.status).toBe(201);
    expect(calls.after).toBe(1);
    expect(calls.reconcile).toHaveLength(1);
    const [userId, entry, explicit] = calls.reconcile[0];
    expect(userId).toBe('user-1');
    expect(entry).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', entry_type: 'food' });
    expect(entry.nutrition_data.items).toHaveLength(1);
    expect(explicit).toEqual({ input_method: 'photo', nutrition_source: undefined, llm_confidence: undefined });
  });

  it('with capture off (default): the create path is untouched — no after(), no reconcile', async () => {
    process.env.NUTRITION_TRAINING_CAPTURE = 'false';
    const res = await post(photoMeal);
    expect(res.status).toBe(201);
    expect(calls.after).toBe(0);
    expect(calls.reconcile).toHaveLength(0);
    // And the body a shipped client sent is stored exactly as before (plus entry_date).
    expect(calls.create[0]).toEqual({ ...photoMeal, entry_date: expect.any(String) });
  });
});
