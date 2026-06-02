/**
 * Nutrition-driven challenge metrics (PRD v4 §6.5).
 *
 * Makes nutrition a first-class metric for the EXISTING challenge system: a
 * challenge type reshapes what nutrition data is tracked. This layer is ADDITIVE —
 * it reuses the existing challenge library (fitcircles + fitcircle_members) and adds
 * a metric configuration + a server-side computation service.
 *
 * §6.7 (hard rule): all progress/ranking is on adherence & consistency — HITTING
 * targets and showing up — NEVER on eating least. `targetValue` is a goal to reach,
 * never a "less is better" ceiling.
 */

/**
 * Which nutrition metric a challenge tracks. Maps to the §6.5 challenge archetypes:
 *  - calorie_target → weight-loss (days within calorie target + the weight ring)
 *  - protein_target → muscle-gain (avg protein vs target)
 *  - carb_target    → marathon-prep (carbs + active calories)
 *  - veg_days       → "30-day vegetarian" (meal categorization)
 *  - sober_days     → "sober month" (yes/no daily check-in via beverage abv flag)
 *  - standard       → daily challenge / default standard nutrition view
 */
export type NutritionMetricType =
  | 'calorie_target'
  | 'protein_target'
  | 'carb_target'
  | 'veg_days'
  | 'sober_days'
  | 'standard';

export const NUTRITION_METRIC_TYPES: readonly NutritionMetricType[] = [
  'calorie_target',
  'protein_target',
  'carb_target',
  'veg_days',
  'sober_days',
  'standard',
] as const;

/** Metric types that require a numeric daily target_value to be meaningful. */
export const TARGET_REQUIRED_METRICS: readonly NutritionMetricType[] = [
  'calorie_target',
  'protein_target',
  'carb_target',
] as const;

/** Sanity ceiling on a per-day target to reject obviously-bad input. */
export const MAX_TARGET_VALUE = 100_000;

/** The stored config row (DB shape, snake_case). */
export interface NutritionChallengeConfigRow {
  id: string;
  fitcircle_id: string;
  metric_type: NutritionMetricType;
  target_value: number | null;
  created_at: string;
  updated_at: string;
}

/** Client-facing config DTO (camelCase). */
export interface NutritionChallengeConfigDTO {
  id: string;
  fitcircleId: string;
  metricType: NutritionMetricType;
  targetValue: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight member identity attached to each progress row. */
export interface NutritionChallengeMember {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Per-member progress for the configured metric over the challenge window.
 *
 * Field semantics are metric-dependent but always consistency/adherence-shaped:
 *  - successDays   = days the member met the metric (within calorie/protein/carb
 *                    target, fully vegetarian, or alcohol-free). Higher = better.
 *  - daysLogged    = distinct days the member produced any relevant log (showing up).
 *  - challengeDays = elapsed days in the window so far (>= 1), the denominator.
 *  - adherencePct  = round(successDays / challengeDays * 100). Primary rank key.
 *  - averageValue  = avg per-logged-day metric value (kcal/protein/carbs) for
 *                    target metrics; null otherwise. Informational, not ranked.
 *  - rank          = 1-based rank by adherence (desc), then daysLogged, then name.
 */
export interface NutritionChallengeMemberProgress {
  member: NutritionChallengeMember;
  successDays: number;
  daysLogged: number;
  challengeDays: number;
  adherencePct: number;
  averageValue: number | null;
  rank: number;
  isCurrentUser: boolean;
}

/** Full progress payload: the configured metric + per-member rows. */
export interface NutritionChallengeProgressDTO {
  fitcircleId: string;
  metricType: NutritionMetricType;
  targetValue: number | null;
  rangeStart: string | null; // YYYY-MM-DD, challenge window start
  rangeEnd: string | null;   // YYYY-MM-DD, min(today, challenge end)
  challengeDays: number;
  rows: NutritionChallengeMemberProgress[];
}

/** Combined GET payload: config (may be null if unconfigured) + computed progress. */
export interface NutritionChallengeResponseDTO {
  config: NutritionChallengeConfigDTO | null;
  progress: NutritionChallengeProgressDTO | null;
}

// ----------------------------------------------------------------------------
// FROZEN service signatures — implementations MUST match these exactly.
// ----------------------------------------------------------------------------
export interface NutritionChallengeServiceContract {
  /** Upsert the nutrition metric for a challenge. Requires the caller be the creator. */
  setConfig(
    fitcircleId: string,
    userId: string,
    metricType: NutritionMetricType,
    targetValue: number | null
  ): Promise<NutritionChallengeConfigDTO>;

  /** Read the config. Gated to active members of the circle. null when unset. */
  getConfig(fitcircleId: string, userId: string): Promise<NutritionChallengeConfigDTO | null>;

  /** Compute per-member progress for the configured metric over the challenge window. */
  computeProgress(fitcircleId: string, userId: string): Promise<NutritionChallengeProgressDTO>;
}
