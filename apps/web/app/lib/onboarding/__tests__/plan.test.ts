import { describe, expect, it } from 'vitest';

import { ageFrom, computePlan, planRequestSchema } from '../plan';

describe('computePlan (§5.3 step 4)', () => {
  it('Mifflin–St Jeor × 1.35 − 400 for weight loss; protein on target weight; water on current weight', () => {
    // male 180 cm / 90 kg / 35 y: BMR = 900 + 1125 − 175 + 5 = 1855 → ×1.35 = 2504.25 − 400 = 2104.25
    const p = computePlan({ goal: 'lose_weight', heightCm: 180, weightKg: 90, targetWeightKg: 80, sex: 'male', age: 35 });
    expect(p).toEqual({ calories: 2100, proteinG: 128, waterMl: 2700, steps: 8000, basis: 'personal', assumptions: [] });
  });

  it('female, maintenance goal: no deficit, protein on current weight, 7k steps', () => {
    // 165 / 60 / 28: BMR = 600 + 1031.25 − 140 − 161 = 1330.25 × 1.35 = 1795.84
    const p = computePlan({ goal: 'eat_healthier', heightCm: 165, weightKg: 60, sex: 'female', age: 28 });
    expect(p).toMatchObject({ calories: 1800, proteinG: 96, waterMl: 1800, steps: 7000, basis: 'personal' });
  });

  it('missing sex/age → sex-neutral midpoint (−78) and age 30, listed as assumptions', () => {
    // 170 / 70: 700 + 1062.5 − 150 − 78 = 1534.5 × 1.35 = 2071.6
    const p = computePlan({ goal: 'build_habits', heightCm: 170, weightKg: 70 });
    expect(p).toMatchObject({ calories: 2070, proteinG: 112, waterMl: 2100, steps: 7000, basis: 'personal' });
    expect(p.assumptions).toEqual(['age_30', 'sex_neutral']);
  });

  it('skipped "about you" → generic targets on the reference body, basis default', () => {
    const p = computePlan({ goal: 'lose_weight' });
    expect(p).toMatchObject({ calories: 1670, proteinG: 112, waterMl: 2100, steps: 8000, basis: 'default' });
    expect(p.assumptions).toEqual(['reference_body', 'age_30', 'sex_neutral']);
    // height alone is not enough to personalise
    expect(computePlan({ goal: 'lose_weight', heightCm: 160 }).basis).toBe('default');
  });

  it('activityLevel picks the multiplier; missing or unknown keeps the 1.35 default', () => {
    // male 180 / 90 / 35: BMR 1855
    const base = { goal: 'eat_healthier', heightCm: 180, weightKg: 90, sex: 'male' as const, age: 35 };
    expect(computePlan({ ...base, activityLevel: 'sedentary' }).calories).toBe(2230); // ×1.2 = 2226
    expect(computePlan({ ...base, activityLevel: 'light' }).calories).toBe(2550); // ×1.375 = 2550.6
    expect(computePlan({ ...base, activityLevel: 'active' }).calories).toBe(2880); // ×1.55 = 2875.25
    expect(computePlan({ ...base, activityLevel: 'very_active' }).calories).toBe(3200); // ×1.725 = 3199.9
    expect(computePlan(base).calories).toBe(2500); // ×1.35 = 2504.25
    expect(computePlan({ ...base, activityLevel: 'athlete' }).calories).toBe(2500);
    expect(computePlan({ ...base, activityLevel: 'toString' }).calories).toBe(2500);
    expect(planRequestSchema.parse({ ...base, activityLevel: 'active' }).activityLevel).toBe('active');
  });

  it('never below 1 200 kcal', () => {
    const p = computePlan({ goal: 'lose_weight', heightCm: 150, weightKg: 42, targetWeightKg: 42, sex: 'female', age: 70 });
    expect(p.calories).toBe(1200);
    expect(p.assumptions).toContain('calorie_floor');
  });

  it('a target below BMI 18.5 is raised to BMI 18.5 for protein', () => {
    // 170 cm → BMI 18.5 = 53.465 kg → 85.5 g
    const p = computePlan({ goal: 'lose_weight', heightCm: 170, weightKg: 70, targetWeightKg: 45 });
    expect(p.proteinG).toBe(86);
    expect(p.assumptions).toContain('target_raised_to_min_bmi');
  });

  it('request validation', () => {
    expect(planRequestSchema.safeParse({ goal: 'lose_weight', heightCm: 20 }).success).toBe(false);
    expect(planRequestSchema.safeParse({}).success).toBe(false);
    expect(planRequestSchema.safeParse({ goal: 'lose_weight', heightCm: null, unitsSystem: 'imperial' }).success).toBe(true);
  });

  it('ageFrom', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    expect(ageFrom('1990-10-27', now)).toBe(36);
    expect(ageFrom('1990-10-28', now)).toBe(35);
    expect(ageFrom('2020-01-01', now)).toBeNull();
    expect(ageFrom(null, now)).toBeNull();
  });
});
