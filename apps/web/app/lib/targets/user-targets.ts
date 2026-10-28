/**
 * Per-user daily targets (docs/USER_TARGETS_CONTRACT.md) — pure.
 *
 * Storage reuses the three places each target already lives, so nothing a
 * shipped client decodes changes shape and no migration is needed:
 *
 *   calories / protein / carbs / fat  profiles.preferences.nutrition
 *        { daily_calorie_target, daily_protein_g_target, daily_carbs_g_target,
 *          daily_fat_g_target, origin, updated_at }
 *        A new preferences key, next to preferences.hydration. preferences is
 *        a pass-through object for every client (withPreferenceDefaults), so an
 *        extra key is invisible to shipped builds.
 *   water                              profiles.preferences.hydration.daily_water_ml_target
 *        Already written by PUT /api/mobile/vitals/goals and read by the
 *        vitals summary + hydration responses (VitalsService).
 *   steps                              profiles.goals[type='steps'].daily_steps_target
 *        Already the shape iOS / Android / web decode (toMobileGoals) and
 *        write (PUT /api/mobile/profile/goals). NOT a new goals[] type: iOS
 *        decodes goals[].type as a closed enum.
 *
 * daily_goals rows were considered and rejected: goal_type is a CHECK-constrained
 * enum (steps, weight_log, workout, mood, energy, custom) that GET
 * /api/mobile/daily-goals returns to shipped apps, which decode it as a closed
 * enum, and those rows are challenge-scoped with start/end dates.
 */
import { z } from 'zod';

import { DEFAULT_WATER_GOAL_ML } from '../types/vitals';

/** Today's server defaults (unchanged): plate score 2000 kcal, vitals 2000 ml, iOS/web 10 000 steps. */
export const DEFAULT_CALORIE_TARGET = 2000;
export const DEFAULT_WATER_TARGET_ML = DEFAULT_WATER_GOAL_ML;
export const DEFAULT_STEPS_TARGET = 10000;

export const TARGET_LIMITS = {
  // Wide enough for every value POST /onboarding/plan can return (max ~7 800 kcal, 480 g protein).
  calories: { min: 1000, max: 8000 },
  proteinG: { min: 20, max: 500 },
  carbsG: { min: 20, max: 900 },
  fatG: { min: 10, max: 400 },
  /** Same bounds as PUT /api/mobile/vitals/goals. */
  waterMl: { min: 250, max: 10000 },
  /** Same bounds as PUT /api/mobile/profile/goals. */
  steps: { min: 500, max: 100000 },
} as const;

export type TargetKey = keyof typeof TARGET_LIMITS;
export const TARGET_KEYS = Object.keys(TARGET_LIMITS) as TargetKey[];

/** Where the accepted values came from (analytics / support only). */
export const TARGET_ORIGINS = ['onboarding_plan', 'settings', 'fitzy_plan', 'other'] as const;
export type TargetOrigin = (typeof TARGET_ORIGINS)[number];

const intIn = (k: TargetKey) =>
  z
    .number()
    .finite()
    .transform((v) => Math.round(v))
    .pipe(z.number().int().min(TARGET_LIMITS[k].min).max(TARGET_LIMITS[k].max))
    .nullable()
    .optional();

/**
 * PUT / PATCH body. Partial: an omitted key is left as it is; `null` clears it
 * (back to the default). Unknown keys are ignored (a newer client never 400s).
 */
export const targetsPatchSchema = z
  .object({
    calories: intIn('calories'),
    proteinG: intIn('proteinG'),
    carbsG: intIn('carbsG'),
    fatG: intIn('fatG'),
    waterMl: intIn('waterMl'),
    steps: intIn('steps'),
    origin: z.enum(TARGET_ORIGINS).optional(),
  })
  .strip()
  .refine((v) => TARGET_KEYS.some((k) => v[k] !== undefined), { message: 'Nothing to update' });
export type TargetsPatch = z.infer<typeof targetsPatchSchema>;

export type TargetSource = 'user' | 'default' | 'none';

export interface UserTargetsView {
  /** The values to use: the user's own, else today's default (null = no default exists). */
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  waterMl: number;
  steps: number;
  /** Per field: 'user' (saved), 'default' (server default), 'none' (nothing saved, no default). */
  sources: Record<TargetKey, TargetSource>;
  /** Origin of the last nutrition save, if any. */
  origin: TargetOrigin | null;
  /** Last nutrition-target save (ISO 8601), if any. */
  updatedAt: string | null;
}

type Json = Record<string, any>;

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** A stored positive number within the field's bounds, else null (bad data never leaks out). */
function stored(v: unknown, k: TargetKey): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= TARGET_LIMITS[k].min && r <= TARGET_LIMITS[k].max ? r : null;
}

/** The user's saved values only (null where nothing valid is saved). */
export function savedTargets(profile: { preferences?: unknown; goals?: unknown } | null | undefined): Record<TargetKey, number | null> {
  const prefs = obj(profile?.preferences);
  const nutrition = obj(prefs.nutrition);
  const hydration = obj(prefs.hydration);
  const goals = Array.isArray(profile?.goals) ? (profile.goals as unknown[]) : [];
  const stepsGoal = obj(goals.find((g) => obj(g).type === 'steps'));
  return {
    calories: stored(nutrition.daily_calorie_target, 'calories'),
    proteinG: stored(nutrition.daily_protein_g_target, 'proteinG'),
    carbsG: stored(nutrition.daily_carbs_g_target, 'carbsG'),
    fatG: stored(nutrition.daily_fat_g_target, 'fatG'),
    waterMl: stored(hydration.daily_water_ml_target, 'waterMl'),
    steps: stored(stepsGoal.daily_steps_target ?? stepsGoal.dailyStepsTarget, 'steps'),
  };
}

/** The user's calorie target, or null when they have not saved one. */
export function userCalorieTarget(profile: { preferences?: unknown } | null | undefined): number | null {
  return savedTargets(profile).calories;
}

export function targetsView(profile: { preferences?: unknown; goals?: unknown } | null | undefined): UserTargetsView {
  const s = savedTargets(profile);
  const nutrition = obj(obj(profile?.preferences).nutrition);
  const src = (k: TargetKey, hasDefault: boolean): TargetSource => (s[k] !== null ? 'user' : hasDefault ? 'default' : 'none');
  const origin = (TARGET_ORIGINS as readonly string[]).includes(nutrition.origin) ? (nutrition.origin as TargetOrigin) : null;
  return {
    calories: s.calories ?? DEFAULT_CALORIE_TARGET,
    proteinG: s.proteinG,
    carbsG: s.carbsG,
    fatG: s.fatG,
    waterMl: s.waterMl ?? DEFAULT_WATER_TARGET_ML,
    steps: s.steps ?? DEFAULT_STEPS_TARGET,
    sources: {
      calories: src('calories', true),
      proteinG: src('proteinG', false),
      carbsG: src('carbsG', false),
      fatG: src('fatG', false),
      waterMl: src('waterMl', true),
      steps: src('steps', true),
    },
    origin,
    updatedAt: typeof nutrition.updated_at === 'string' ? nutrition.updated_at : null,
  };
}

const NUTRITION_COLUMNS: Partial<Record<TargetKey, string>> = {
  calories: 'daily_calorie_target',
  proteinG: 'daily_protein_g_target',
  carbsG: 'daily_carbs_g_target',
  fatG: 'daily_fat_g_target',
};

/**
 * Merge a patch into the stored preferences + goals. Everything else in both is
 * kept untouched (other preference keys, the weight goal, unknown goal rows).
 */
export function applyTargetsPatch(
  profile: { preferences?: unknown; goals?: unknown } | null | undefined,
  patch: TargetsPatch,
  now: Date = new Date()
): { preferences: Json; goals: unknown[] } {
  const preferences: Json = { ...obj(profile?.preferences) };
  const goals: unknown[] = Array.isArray(profile?.goals) ? [...(profile.goals as unknown[])] : [];

  const touchesNutrition = (Object.keys(NUTRITION_COLUMNS) as TargetKey[]).some((k) => patch[k] !== undefined);
  if (touchesNutrition) {
    const nutrition: Json = { ...obj(preferences.nutrition) };
    for (const [k, column] of Object.entries(NUTRITION_COLUMNS) as [TargetKey, string][]) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v === null) delete nutrition[column];
      else nutrition[column] = v;
    }
    nutrition.updated_at = now.toISOString();
    if (patch.origin) nutrition.origin = patch.origin;
    preferences.nutrition = nutrition;
  }

  if (patch.waterMl !== undefined) {
    // Same semantics as VitalsService.updateGoals: null clears the hydration target.
    if (patch.waterMl === null) {
      const hydration = { ...obj(preferences.hydration) };
      delete hydration.daily_water_ml_target;
      if (Object.keys(hydration).length) preferences.hydration = hydration;
      else delete preferences.hydration;
    } else {
      preferences.hydration = { ...obj(preferences.hydration), daily_water_ml_target: patch.waterMl };
    }
  }

  if (patch.steps !== undefined) {
    const i = goals.findIndex((g) => obj(g).type === 'steps');
    if (patch.steps === null) {
      if (i >= 0) goals.splice(i, 1);
    } else {
      const existing = i >= 0 ? obj(goals[i]) : {};
      // Keep the canonical element shape every client decodes (toMobileGoals).
      const next = {
        ...existing,
        type: 'steps',
        target_weight_kg: existing.target_weight_kg ?? null,
        starting_weight_kg: existing.starting_weight_kg ?? null,
        daily_steps_target: patch.steps,
      };
      delete (next as Json).dailyStepsTarget;
      if (i >= 0) goals[i] = next;
      else goals.push(next);
    }
  }

  return { preferences, goals };
}
