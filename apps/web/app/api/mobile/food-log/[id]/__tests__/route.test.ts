import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = { update: [] as any[] };

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/food-log-image-service', () => ({ FoodLogImageService: {} }));
vi.mock('@/lib/services/food-log-service', () => ({
  FoodLogService: {
    updateEntry: async (entryId: string, userId: string, data: any) => {
      calls.update.push(data);
      return {
        data: {
          id: entryId,
          user_id: userId,
          entry_type: 'food',
          meal_type: 'lunch',
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

import { PATCH } from '../route';

const ID = '11111111-1111-4111-8111-111111111111';
const patch = (body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/mobile/food-log/${ID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as any,
    { params: Promise.resolve({ id: ID }) }
  );

describe('PATCH /api/mobile/food-log/[id]', () => {
  beforeEach(() => {
    calls.update = [];
  });

  it('entry_type "snack" without a meal_type files the entry as a snack', async () => {
    const res = await patch({ entry_type: 'snack', notes: 'Trail mix', is_private: false });
    expect(res.status).toBe(200);
    expect(calls.update[0]).toEqual({ meal_type: 'snack', notes: 'Trail mix', is_private: false });
    const body = await res.json();
    expect(body.data.entry_type).toBe('food');
    expect(body.data.meal_type).toBe('snack');
  });

  it('entry_type "snack" keeps another meal_type the client sent', async () => {
    await patch({ entry_type: 'snack', meal_type: 'breakfast' });
    expect(calls.update[0]).toEqual({ meal_type: 'breakfast' });
  });

  it('OLD request shape: the full iOS metadata body with entry_type "food" is unchanged', async () => {
    const res = await patch({
      entry_type: 'food',
      meal_type: 'dinner',
      notes: 'Salmon',
      is_private: true,
      logged_at: '2026-09-28T19:00:00Z',
      nutrition_data: { calories: 610, protein_g: 42, carbs_g: 30, fat_g: 33 },
    });
    expect(res.status).toBe(200);
    expect(calls.update[0]).toEqual({
      meal_type: 'dinner',
      notes: 'Salmon',
      is_private: true,
      logged_at: '2026-09-28T19:00:00Z',
      nutrition_data: { calories: 610, protein_g: 42, carbs_g: 30, fat_g: 33 },
      // Re-timing a meal moves its day with it (UTC here: no timezone in the test).
      entry_date: '2026-09-28',
    });
  });

  it('an explicit null is "field not sent", not a 400', async () => {
    const res = await patch({ notes: null, water_ml: null, meal_type: 'lunch' });
    expect(res.status).toBe(200);
    expect(calls.update[0]).toEqual({ meal_type: 'lunch' });
  });

  it('validation errors keep code + details and carry a readable message', async () => {
    const res = await patch({ meal_type: 'brunch' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('meal_type');
    expect(body.error.message).toMatch(/^meal_type: /);
    expect(calls.update).toHaveLength(0);
  });
});
