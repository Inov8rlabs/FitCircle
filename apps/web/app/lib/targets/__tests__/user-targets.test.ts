import { describe, expect, it } from 'vitest';

import { computePlan } from '../../onboarding/plan';
import {
  applyTargetsPatch,
  DEFAULT_CALORIE_TARGET,
  DEFAULT_STEPS_TARGET,
  DEFAULT_WATER_TARGET_ML,
  savedTargets,
  targetsPatchSchema,
  targetsView,
  userCalorieTarget,
} from '../user-targets';

const NOW = new Date('2026-10-28T12:00:00Z');

describe('targetsView', () => {
  it('nothing saved: today\'s defaults, protein/carbs/fat none', () => {
    for (const p of [null, undefined, {}, { preferences: null, goals: null }]) {
      expect(targetsView(p as any)).toEqual({
        calories: DEFAULT_CALORIE_TARGET,
        proteinG: null,
        carbsG: null,
        fatG: null,
        waterMl: DEFAULT_WATER_TARGET_ML,
        steps: DEFAULT_STEPS_TARGET,
        sources: { calories: 'default', proteinG: 'none', carbsG: 'none', fatG: 'none', waterMl: 'default', steps: 'default' },
        origin: null,
        updatedAt: null,
      });
    }
  });

  it('reads the three existing stores', () => {
    const view = targetsView({
      preferences: {
        nutrition: { daily_calorie_target: 1850, daily_protein_g_target: 128, origin: 'onboarding_plan', updated_at: NOW.toISOString() },
        hydration: { daily_water_ml_target: 2700 },
      },
      goals: [{ type: 'weight', target_weight_kg: 80 }, { type: 'steps', daily_steps_target: 8000 }],
    });
    expect(view).toMatchObject({ calories: 1850, proteinG: 128, waterMl: 2700, steps: 8000, origin: 'onboarding_plan', updatedAt: NOW.toISOString() });
    expect(view.sources).toEqual({ calories: 'user', proteinG: 'user', carbsG: 'none', fatG: 'none', waterMl: 'user', steps: 'user' });
  });

  it('ignores out-of-range or junk stored values (falls back to defaults)', () => {
    const s = savedTargets({
      preferences: { nutrition: { daily_calorie_target: 50, daily_protein_g_target: 'abc', daily_fat_g_target: '60' }, hydration: { daily_water_ml_target: -1 } },
      goals: [{ type: 'steps', dailyStepsTarget: 9000 }],
    });
    expect(s).toEqual({ calories: null, proteinG: null, carbsG: null, fatG: 60, waterMl: null, steps: 9000 });
    expect(userCalorieTarget({ preferences: { nutrition: { daily_calorie_target: 2400.4 } } })).toBe(2400);
    expect(userCalorieTarget({ preferences: 'oops' })).toBeNull();
  });
});

describe('targetsPatchSchema', () => {
  it('accepts partial, rounds, allows null; rejects empty and out-of-range', () => {
    expect(targetsPatchSchema.parse({ calories: 1849.6, steps: null })).toEqual({ calories: 1850, steps: null });
    expect(targetsPatchSchema.parse({ waterMl: 2700, unknown: 1 })).toEqual({ waterMl: 2700 });
    expect(targetsPatchSchema.safeParse({}).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ origin: 'settings' }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ calories: 900 }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ calories: 8001 }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ proteinG: 19 }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ waterMl: 249 }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ steps: 100001 }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ calories: '1800' }).success).toBe(false);
    expect(targetsPatchSchema.safeParse({ calories: 1800, origin: 'hacker' }).success).toBe(false);
  });
});

describe('applyTargetsPatch', () => {
  const profile = {
    preferences: { notifications: { push: false }, hydration: { daily_water_ml_target: 2000, other: 1 }, display: { units: 'imperial' } },
    goals: [{ type: 'weight', target_weight_kg: 80, starting_weight_kg: 90 }, 'junk'],
  };

  it('writes each target to its store and keeps everything else', () => {
    const out = applyTargetsPatch(profile, { calories: 1850, proteinG: 128, waterMl: 2700, steps: 8000, origin: 'onboarding_plan' }, NOW);
    expect(out.preferences).toEqual({
      notifications: { push: false },
      display: { units: 'imperial' },
      hydration: { daily_water_ml_target: 2700, other: 1 },
      nutrition: { daily_calorie_target: 1850, daily_protein_g_target: 128, origin: 'onboarding_plan', updated_at: NOW.toISOString() },
    });
    expect(out.goals).toEqual([
      { type: 'weight', target_weight_kg: 80, starting_weight_kg: 90 },
      'junk',
      { type: 'steps', target_weight_kg: null, starting_weight_kg: null, daily_steps_target: 8000 },
    ]);
    // input not mutated
    expect(profile.preferences.hydration.daily_water_ml_target).toBe(2000);
  });

  it('null clears a target; an omitted key is untouched', () => {
    const saved = applyTargetsPatch(profile, { calories: 1850, proteinG: 128, steps: 8000 }, NOW);
    const out = applyTargetsPatch(saved, { proteinG: null, waterMl: null, steps: null }, NOW);
    expect(out.preferences.nutrition).toEqual({ daily_calorie_target: 1850, updated_at: NOW.toISOString() });
    expect(out.preferences.hydration).toEqual({ other: 1 });
    expect(out.goals.find((g: any) => g?.type === 'steps')).toBeUndefined();
    const noHydration = applyTargetsPatch({ preferences: { hydration: { daily_water_ml_target: 2000 } } }, { waterMl: null }, NOW);
    expect(noHydration.preferences).not.toHaveProperty('hydration');
  });

  it('updates an existing steps goal in place (camelCase twin dropped)', () => {
    const out = applyTargetsPatch({ goals: [{ type: 'steps', dailyStepsTarget: 5000, daily_steps_target: 5000 }] }, { steps: 9000 }, NOW);
    expect(out.goals).toEqual([{ type: 'steps', target_weight_kg: null, starting_weight_kg: null, daily_steps_target: 9000 }]);
    expect(out.preferences).toEqual({});
  });
});

describe('every onboarding plan is saveable as-is', () => {
  it('plan extremes pass the PUT /targets schema', () => {
    for (const heightCm of [100, 250]) for (const weightKg of [30, 300]) for (const age of [13, 100])
      for (const sex of ['male', 'female', null] as const) for (const activityLevel of ['sedentary', 'very_active'])
        for (const goal of ['lose_weight', 'eat_healthier']) {
          const p = computePlan({ goal, heightCm, weightKg, age, sex, activityLevel, targetWeightKg: 30 });
          const r = targetsPatchSchema.safeParse({ calories: p.calories, proteinG: p.proteinG, waterMl: p.waterMl, steps: p.steps });
          expect(r.success, JSON.stringify(p)).toBe(true);
        }
  });
});
