/**
 * Onboarding v2 "Your plan" daily targets (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md
 * §5.3 step 4). Pure, so iOS, Android and web get identical numbers from
 * POST /api/mobile/onboarding/plan (clients mirror it for offline).
 *
 *   BMR      Mifflin–St Jeor: 10·kg + 6.25·cm − 5·age + s
 *            s = +5 (male), −161 (female), −78 (sex unknown: the midpoint)
 *   calories BMR × activity factor, − 400 kcal for weight loss, never below
 *            1 200 kcal; rounded to 10. Factor by `activityLevel`: sedentary
 *            1.2, light 1.375, active 1.55, very_active 1.725; missing or
 *            unknown → 1.35 (what every pre-1.1.0 client got)
 *   protein  1.6 g per kg of TARGET weight for weight loss (current weight
 *            otherwise); a target below BMI 18.5 is raised to BMI 18.5;
 *            rounded to 1 g
 *   water    30 ml per kg of current weight, rounded to 50 ml
 *   steps    8 000 for weight loss, 7 000 otherwise
 *
 * Missing age → 30. Missing sex → the sex-neutral midpoint. Missing height or
 * weight → the same formula on a reference body (170 cm, 70 kg), reported as
 * basis "default" so the client shows "Add your details anytime to personalise
 * these." Every assumption made is listed in `assumptions`.
 */
import { z } from 'zod';

/** Factor when no (or an unknown) activity level is sent: the pre-1.1.0 behaviour. */
export const PLAN_ACTIVITY_FACTOR = 1.35;
/** Onboarding v3 activity step ids → standard Mifflin–St Jeor activity multipliers. */
export const PLAN_ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  active: 1.55,
  very_active: 1.725,
} as const;
export const PLAN_LOSS_DEFICIT_KCAL = 400;
export const PLAN_MIN_CALORIES = 1200;
export const PLAN_PROTEIN_G_PER_KG = 1.6;
export const PLAN_WATER_ML_PER_KG = 30;
export const PLAN_STEPS_LOSE = 8000;
export const PLAN_STEPS_DEFAULT = 7000;
export const PLAN_DEFAULT_AGE = 30;
export const PLAN_MIN_BMI = 18.5;
export const PLAN_REFERENCE_BODY = { heightCm: 170, weightKg: 70 } as const;

const SEX_OFFSET = { male: 5, female: -161, neutral: -78 } as const;

/** Goal ids from the v2 goal step. Only `lose_weight` changes the maths. */
export const PLAN_GOALS = ['lose_weight', 'eat_healthier', 'build_habits', 'fit_with_friends'] as const;

const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const planRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(40),
    heightCm: num(100, 250).nullish(),
    weightKg: num(30, 300).nullish(),
    targetWeightKg: num(30, 300).nullish(),
    sex: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullish(),
    age: z.number().int().min(13).max(100).nullish(),
    unitsSystem: z.enum(['metric', 'imperial']).nullish(),
    // Free string so a future id never fails the request; unknown ids use the default factor.
    activityLevel: z.string().trim().max(40).nullish(),
  })
  .strip();
export type PlanRequest = z.infer<typeof planRequestSchema>;

export type PlanAssumption = 'reference_body' | 'age_30' | 'sex_neutral' | 'target_raised_to_min_bmi' | 'calorie_floor';

export interface PlanTargets {
  calories: number;
  proteinG: number;
  waterMl: number;
  steps: number;
  basis: 'personal' | 'default';
  assumptions: PlanAssumption[];
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function computePlan(input: PlanRequest): PlanTargets {
  const assumptions: PlanAssumption[] = [];
  const lose = input.goal === 'lose_weight';
  const personal = input.heightCm != null && input.weightKg != null;
  const heightCm = personal ? input.heightCm! : PLAN_REFERENCE_BODY.heightCm;
  const weightKg = personal ? input.weightKg! : PLAN_REFERENCE_BODY.weightKg;
  if (!personal) assumptions.push('reference_body');

  const age = input.age ?? PLAN_DEFAULT_AGE;
  if (input.age == null) assumptions.push('age_30');
  const sex = input.sex === 'male' || input.sex === 'female' ? input.sex : 'neutral';
  if (sex === 'neutral') assumptions.push('sex_neutral');

  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + SEX_OFFSET[sex];
  const level = input.activityLevel;
  const factor =
    level != null && Object.hasOwn(PLAN_ACTIVITY_FACTORS, level)
      ? PLAN_ACTIVITY_FACTORS[level as keyof typeof PLAN_ACTIVITY_FACTORS]
      : PLAN_ACTIVITY_FACTOR;
  let calories = bmr * factor - (lose ? PLAN_LOSS_DEFICIT_KCAL : 0);
  if (calories < PLAN_MIN_CALORIES) {
    calories = PLAN_MIN_CALORIES;
    assumptions.push('calorie_floor');
  }

  let proteinKg = weightKg;
  if (lose && personal && input.targetWeightKg != null) {
    const minHealthy = PLAN_MIN_BMI * (heightCm / 100) ** 2;
    proteinKg = input.targetWeightKg;
    if (proteinKg < minHealthy) {
      proteinKg = minHealthy;
      assumptions.push('target_raised_to_min_bmi');
    }
  }

  return {
    calories: roundTo(calories, 10),
    proteinG: Math.round(PLAN_PROTEIN_G_PER_KG * proteinKg),
    waterMl: roundTo(PLAN_WATER_ML_PER_KG * weightKg, 50),
    steps: lose ? PLAN_STEPS_LOSE : PLAN_STEPS_DEFAULT,
    basis: personal ? 'personal' : 'default',
    assumptions,
  };
}

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC), or null. */
export function ageFrom(dateOfBirth: unknown, now: Date): number | null {
  if (typeof dateOfBirth !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age >= 13 && age <= 100 ? age : null;
}
