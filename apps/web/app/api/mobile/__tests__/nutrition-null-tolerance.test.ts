/**
 * Explicit JSON nulls on OPTIONAL request fields used to be a 400 on these routes
 * (zod `.optional()` rejects null). Older Android builds serialise unset values as
 * null, so valid requests failed. One test per route proves the null is tolerated,
 * and one proves the request shape accepted before still reaches the service unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Record<string, any[]> = {};
const record = (name: string, args: any[]) => {
  (calls[name] ??= []).push(args);
};

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/services/usage-service', () => {
  class UpgradeRequiredError extends Error {
    constructor(
      public readonly feature: string,
      public readonly used: number,
      public readonly limit: number
    ) {
      super('UPGRADE_REQUIRED');
    }
  }
  return { UpgradeRequiredError };
});
vi.mock('@/lib/services/nutrition-intelligence-service', () => ({
  NutritionIntelligenceService: {
    estimateItem: async (...args: any[]) => {
      record('estimateItem', args);
      return { name: args[1], calories: 100 };
    },
  },
}));
vi.mock('@/lib/services/foods-service', () => ({
  FoodsService: {
    listCustomFoods: async () => [],
    createCustomFood: async (...args: any[]) => {
      record('createCustomFood', args);
      return { id: 'food-1', ...args[1] };
    },
  },
}));
vi.mock('@/lib/services/dietary-preferences-service', () => ({
  DietaryPreferencesService: {
    getPrefs: async () => ({ diet: 'none', allergens: [], units: 'metric' }),
    setPrefs: async (...args: any[]) => {
      record('setPrefs', args);
      return { diet: 'none', allergens: [], units: 'metric', ...args[1] };
    },
  },
}));
vi.mock('@/lib/services/group-meal-service', () => ({
  GroupMealService: {
    createGroupMeal: async (...args: any[]) => {
      record('createGroupMeal', args);
      return { id: 'meal-1', ...args[1] };
    },
  },
}));
vi.mock('@/lib/services/circle-streak-service', () => ({
  CircleStreakService: {
    useSave: async (...args: any[]) => {
      record('useSave', args);
      return { saved: true };
    },
  },
}));
vi.mock('@/lib/services/health-nutrition-service', () => ({
  HealthNutritionService: {
    getState: async () => [],
    importBatch: async (...args: any[]) => {
      record('importBatch', args);
      return { received: args[1].items.length, imported: 0, skipped: 0, lastSyncAt: 'now' };
    },
    setEnabled: async (...args: any[]) => {
      record('setEnabled', args);
      return [];
    },
  },
}));
vi.mock('@/lib/services/fitzy-service', () => ({
  FitzyService: {
    chat: async (...args: any[]) => {
      record('fitzyChat', args);
      return { answer: 'Hi', disclaimer: 'd' };
    },
  },
}));
vi.mock('@/lib/services/nutrition-coach-service', () => ({
  NutritionCoachService: {
    ask: async (...args: any[]) => {
      record('coachAsk', args);
      return { answer: 'Hi', disclaimer: 'd' };
    },
  },
}));
vi.mock('@/lib/services/nutrition-challenge-service', () => ({
  NutritionChallengeService: {
    setConfig: async (...args: any[]) => {
      record('setConfig', args);
      return { metricType: args[2], targetValue: args[3] };
    },
  },
}));
vi.mock('@/lib/services/food-privacy-service', () => ({
  FoodPrivacyService: class {
    async getTier() {
      return 'full';
    }
    async setTier(...args: any[]) {
      record('setTier', args);
      return args[2];
    }
  },
}));

import { POST as foodPrivacy } from '../circles/[id]/food-privacy/route';
import { POST as nutritionChallenge } from '../circles/[id]/nutrition-challenge/route';
import { POST as streakSave } from '../circles/[id]/streak/save/route';
import { POST as dietaryPrefs } from '../dietary-preferences/route';
import { POST as fitzyChat } from '../fitzy/chat/route';
import { POST as estimateItem } from '../food/estimate-item/route';
import { POST as customFood } from '../foods/custom/route';
import { POST as groupMeal } from '../group-meals/route';
import { POST as nutritionImport } from '../health/nutrition-import/route';
import { POST as nutritionSync } from '../health/nutrition-sync/route';
import { POST as nutritionCoach } from '../nutrition-coach/route';

const CIRCLE = '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23';
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const req = (body: unknown) =>
  new Request('http://localhost/api/mobile/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;
const circleCtx = { params: Promise.resolve({ id: CIRCLE }) };

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
});

describe('estimate-item', () => {
  it('accepts null grams / quantity / servingUnit', async () => {
    const res = await estimateItem(req({ name: 'banana', grams: null, quantity: null, servingUnit: null }));
    expect(res.status).toBe(200);
    expect(calls.estimateItem[0]).toEqual(['user-1', 'banana', undefined, undefined, undefined]);
  });

  it('OLD request shape is unchanged', async () => {
    const res = await estimateItem(req({ name: 'rice', grams: 150, quantity: 1, servingUnit: 'cup' }));
    expect(res.status).toBe(200);
    expect(calls.estimateItem[0]).toEqual(['user-1', 'rice', 150, 1, 'cup']);
  });

  it('still validates: an empty name keeps its own message, code and details', async () => {
    const res = await estimateItem(req({ name: '  ' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Name is empty');
    expect(body.error.details.issues).toBeInstanceOf(Array);
  });
});

describe('custom food', () => {
  const per100g = { calories: 200, proteinG: 10, carbsG: 20, fatG: 5 };

  it('accepts nulls on optional fields (top level and inside per100g)', async () => {
    const res = await customFood(
      req({
        name: 'Granola',
        brand: null,
        servingSizeG: null,
        servingUnit: null,
        per100g: { ...per100g, fiberG: null, sugarG: null },
        recipeIngredients: null,
        recipeServings: null,
      })
    );
    expect(res.status).toBe(201);
    expect(calls.createCustomFood[0][1]).toEqual({ name: 'Granola', per100g });
  });

  it('OLD request shape is unchanged', async () => {
    const body = {
      name: 'Granola',
      brand: 'Oats Co',
      servingSizeG: 45,
      servingUnit: 'bowl',
      per100g: { ...per100g, fiberG: 6, sugarG: 12 },
    };
    const res = await customFood(req(body));
    expect(res.status).toBe(201);
    expect(calls.createCustomFood[0][1]).toEqual(body);
  });

  it('a required macro that is null is still a 400, now with a readable message', async () => {
    const res = await customFood(req({ name: 'Granola', per100g: { ...per100g, calories: null } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('per100g.calories');
    expect(body.error.message).toMatch(/^per100g\.calories: /);
  });
});

describe('dietary preferences', () => {
  it('accepts null diet / allergens / units', async () => {
    const res = await dietaryPrefs(req({ diet: 'vegan', allergens: null, units: null }));
    expect(res.status).toBe(200);
    expect(calls.setPrefs[0][1]).toEqual({ diet: 'vegan' });
  });

  it('OLD request shape is unchanged', async () => {
    const body = { diet: 'vegetarian', allergens: ['peanuts'], units: 'imperial' };
    const res = await dietaryPrefs(req(body));
    expect(res.status).toBe(200);
    expect(calls.setPrefs[0][1]).toEqual(body);
  });

  it('unknown keys are still rejected (strict schema)', async () => {
    const res = await dietaryPrefs(req({ diet: 'vegan', favouriteColour: 'blue' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('group meals', () => {
  const base = { fitcircleId: CIRCLE, name: 'Team lunch', mealType: 'lunch' };

  it('accepts nulls on optional fields', async () => {
    const res = await groupMeal(req({ ...base, restaurantName: null, photoUrl: null, macros: null }));
    expect(res.status).toBe(201);
    expect(calls.createGroupMeal[0][1]).toEqual({ ...base, taggedUserIds: [] });
  });

  it('flat macro keys (iOS / older Android) are no longer lost', async () => {
    const res = await groupMeal(
      req({ ...base, calories: 650, proteinG: 40, carbsG: 55, fatG: 22, taggedUserIds: [USER] })
    );
    expect(res.status).toBe(201);
    expect(calls.createGroupMeal[0][1]).toEqual({
      ...base,
      macros: { calories: 650, proteinG: 40, carbsG: 55, fatG: 22 },
      taggedUserIds: [USER],
    });
  });

  it('flat keys with nulls keep the values that were filled in', async () => {
    const res = await groupMeal(req({ ...base, calories: 650, proteinG: null, carbsG: null, fatG: null }));
    expect(res.status).toBe(201);
    expect(calls.createGroupMeal[0][1].macros).toEqual({ calories: 650 });
  });

  it('OLD request shape (nested macros) is unchanged', async () => {
    const body = {
      ...base,
      restaurantName: 'Nopa',
      macros: { calories: 500, proteinG: 30, carbsG: 40, fatG: 10 },
      taggedUserIds: [USER],
    };
    const res = await groupMeal(req(body));
    expect(res.status).toBe(201);
    expect(calls.createGroupMeal[0][1]).toEqual(body);
  });

  it('validation errors keep code + details and carry a readable message', async () => {
    const res = await groupMeal(req({ ...base, mealType: 'brunch' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('mealType');
    expect(body.error.message).toMatch(/^mealType: /);
  });
});

describe('circle streak save', () => {
  it('accepts a null date (defaults to today) — already tolerated, kept that way', async () => {
    const res = await streakSave(req({ coveredUserId: USER, date: null }), circleCtx);
    expect(res.status).toBe(200);
    const [circleId, saver, covered, date] = calls.useSave[0];
    expect([circleId, saver, covered]).toEqual([CIRCLE, 'user-1', USER]);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('OLD request shape is unchanged', async () => {
    const res = await streakSave(req({ coveredUserId: USER, date: '2026-09-27' }), circleCtx);
    expect(res.status).toBe(200);
    expect(calls.useSave[0]).toEqual([CIRCLE, 'user-1', USER, '2026-09-27']);
  });
});

describe('nutrition import', () => {
  const item = { externalId: 'hc-1', loggedAt: '2026-09-28T08:00:00Z', name: 'Oatmeal' };

  it('accepts nulls on optional item fields and cursor', async () => {
    const res = await nutritionImport(
      req({
        platform: 'healthconnect',
        cursor: null,
        items: [{ ...item, mealType: null, calories: null, proteinG: null, carbsG: null, fatG: null }],
      })
    );
    expect(res.status).toBe(200);
    expect(calls.importBatch[0][1]).toEqual({
      platform: 'healthconnect',
      cursor: null, // the schema accepts null here, so it is kept
      items: [{ ...item, calories: null, proteinG: null, carbsG: null, fatG: null }],
    });
  });

  it('OLD request shape is unchanged', async () => {
    const body = {
      platform: 'healthkit',
      cursor: 'abc',
      items: [{ ...item, mealType: 'breakfast', calories: 300, proteinG: 10, carbsG: 50, fatG: 6 }],
    };
    const res = await nutritionImport(req(body));
    expect(res.status).toBe(200);
    expect(calls.importBatch[0][1]).toEqual(body);
  });

  it('validation errors keep code + details and carry a readable message', async () => {
    const res = await nutritionImport(req({ platform: 'fitbit', items: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('platform');
    expect(body.error.message).toMatch(/^platform: /);
  });
});

describe('nutrition sync toggle', () => {
  it('OLD request shape is unchanged; a bad platform has a readable message', async () => {
    const ok = await nutritionSync(req({ platform: 'healthkit', enabled: true }));
    expect(ok.status).toBe(200);
    expect(calls.setEnabled[0]).toEqual(['user-1', 'healthkit', true]);

    const bad = await nutritionSync(req({ platform: 'healthkit', enabled: null }));
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/^enabled: /);
  });
});

describe('Fitzy chat', () => {
  const messages = [{ role: 'user', content: 'How much protein do I need?' }];

  it('accepts circleId: null (chat without a circle)', async () => {
    const res = await fitzyChat(req({ messages, circleId: null }));
    expect(res.status).toBe(200);
    expect(calls.fitzyChat[0]).toEqual(['user-1', messages, undefined]);
    expect((await res.json()).data).toEqual({ answer: 'Hi', disclaimer: 'd' });
  });

  it('OLD request shapes are unchanged', async () => {
    await fitzyChat(req({ messages }));
    expect(calls.fitzyChat[0]).toEqual(['user-1', messages, undefined]);
    await fitzyChat(req({ messages, circleId: CIRCLE }));
    expect(calls.fitzyChat[1]).toEqual(['user-1', messages, CIRCLE]);
  });

  it('still validates: no messages keeps its own message', async () => {
    const res = await fitzyChat(req({ messages: [], circleId: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('At least one message is required');
  });
});

describe('nutrition coach', () => {
  it('accepts circleId: null', async () => {
    const res = await nutritionCoach(req({ question: 'Is oatmeal good?', circleId: null }));
    expect(res.status).toBe(200);
    expect(calls.coachAsk[0]).toEqual(['user-1', 'Is oatmeal good?', undefined]);
  });

  it('OLD request shape is unchanged', async () => {
    await nutritionCoach(req({ question: 'Is oatmeal good?', circleId: CIRCLE }));
    expect(calls.coachAsk[0]).toEqual(['user-1', 'Is oatmeal good?', CIRCLE]);
  });
});

describe('nutrition challenge config', () => {
  it('OLD request shapes are unchanged (targetValue value / null / absent)', async () => {
    const a = await nutritionChallenge(req({ metricType: 'calorie_target', targetValue: 2000 }), circleCtx);
    expect(a.status).toBe(200);
    expect(calls.setConfig[0]).toEqual([CIRCLE, 'user-1', 'calorie_target', 2000]);

    await nutritionChallenge(req({ metricType: 'calorie_target', targetValue: null }), circleCtx);
    expect(calls.setConfig[1]).toEqual([CIRCLE, 'user-1', 'calorie_target', null]);

    await nutritionChallenge(req({ metricType: 'calorie_target' }), circleCtx);
    expect(calls.setConfig[2]).toEqual([CIRCLE, 'user-1', 'calorie_target', null]);
  });

  it('validation errors keep code + details and carry a readable message', async () => {
    const res = await nutritionChallenge(req({ metricType: 'vibes' }), circleCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeInstanceOf(Array);
    expect(body.error.message).toMatch(/^metricType: /);
  });
});

describe('food privacy tier', () => {
  it('OLD request shape is unchanged; a null tier is still a 400 with the same message', async () => {
    const ok = await foodPrivacy(req({ tier: 'summary' }), circleCtx);
    expect(ok.status).toBe(200);
    expect(calls.setTier[0]).toEqual([CIRCLE, 'user-1', 'summary']);

    const bad = await foodPrivacy(req({ tier: null }), circleCtx);
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('tier must be one of: full, summary, private');
  });
});
