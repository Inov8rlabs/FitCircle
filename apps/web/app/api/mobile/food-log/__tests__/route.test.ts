import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks: auth, feature flag, service, streak claim -----------------------------
const calls = { create: [] as any[] };

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
vi.mock('@/lib/services/food-log-service', () => ({
  FoodLogService: {
    // Echo what would be stored, like the real insert(...).select().single().
    createEntry: async (userId: string, data: any) => {
      calls.create.push(data);
      return {
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          user_id: userId,
          is_private: false,
          logged_at: '2026-09-28T10:00:00.000Z',
          created_at: '2026-09-28T10:00:01.000Z',
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

/** `entry_type` values each shipped client can decode in a response. */
const SWIFT_FOOD_CATEGORY = ['food', 'snack', 'water', 'supplement']; // FoodLog.swift FoodCategory
const KOTLIN_FOOD_CATEGORY = ['food', 'snack', 'water', 'supplement']; // FoodLogModels.kt FoodCategory
const DB_ENTRY_TYPES = ['food', 'water', 'supplement']; // food_log_entries_entry_type_check

describe('POST /api/mobile/food-log', () => {
  beforeEach(() => {
    calls.create = [];
  });

  it('accepts the iOS 1.0 manual Snack body (entry_type "snack") — was a 400', async () => {
    const res = await post({
      entry_type: 'snack',
      notes: 'Apple and peanut butter',
      is_private: false,
      logged_at: '2026-09-28T10:00:00Z',
    });
    expect(res.status).toBe(201);

    // Stored as the value the DB constraint allows, with the snack meal slot.
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].entry_type).toBe('food');
    expect(calls.create[0].meal_type).toBe('snack');
    expect(DB_ENTRY_TYPES).toContain(calls.create[0].entry_type);

    // Response: the stored value — decodable by both shipped clients.
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.entry_type).toBe('food');
    expect(body.data.meal_type).toBe('snack');
    expect(SWIFT_FOOD_CATEGORY).toContain(body.data.entry_type);
    expect(KOTLIN_FOOD_CATEGORY).toContain(body.data.entry_type);
    // The keys the Swift FoodLogEntry decoder requires.
    for (const key of ['id', 'user_id', 'entry_type', 'is_private', 'logged_at', 'created_at']) {
      expect(body.data[key]).not.toBeUndefined();
      expect(body.data[key]).not.toBeNull();
    }
  });

  it('keeps a meal_type the client sent together with entry_type "snack"', async () => {
    const res = await post({ entry_type: 'snack', meal_type: 'dinner' });
    expect(res.status).toBe(201);
    expect(calls.create[0]).toMatchObject({ entry_type: 'food', meal_type: 'dinner' });
  });

  it('OLD request shape still works and reaches the service unchanged', async () => {
    const body = {
      entry_type: 'food',
      meal_type: 'lunch',
      notes: 'Chicken bowl',
      is_private: false,
      logged_at: '2026-09-28T12:30:00Z',
      nutrition_data: { calories: 520, protein_g: 40, carbs_g: 45, fat_g: 18 },
    };
    const res = await post(body);
    expect(res.status).toBe(201);
    // The only addition: the day it was eaten, resolved on the server (UTC here: no timezone in the test).
    expect(calls.create[0]).toEqual({ ...body, entry_date: '2026-09-28' });

    await post({ entry_type: 'water', water_ml: 250 });
    expect(calls.create[1]).toEqual({ entry_type: 'water', water_ml: 250, entry_date: expect.any(String) });
  });

  it('accepts explicit nulls on optional fields', async () => {
    const res = await post({
      entry_type: 'water',
      water_ml: 330,
      meal_type: null,
      notes: null,
      nutrition_data: null,
    });
    expect(res.status).toBe(201);
    expect(calls.create[0]).toEqual({ entry_type: 'water', water_ml: 330, entry_date: expect.any(String) });
  });

  it('validation errors keep code + details and carry a readable message', async () => {
    const res = await post({ entry_type: 'dessert' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('entry_type');
    expect(typeof body.error.timestamp).toBe('string');
    expect(body.error.message).toMatch(/^entry_type: /);
    expect(calls.create).toHaveLength(0);
  });

  it('still rejects a food entry without a meal type', async () => {
    const res = await post({ entry_type: 'food', notes: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
