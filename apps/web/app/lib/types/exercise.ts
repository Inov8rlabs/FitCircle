// Types for exercise/workout tracking

/**
 * Exercise category grouping
 */
export type ExerciseCategory = 'cardio' | 'strength' | 'flexibility' | 'sports' | 'outdoor' | 'other';

/**
 * Where the workout took place
 */
export type LocationType = 'home' | 'gym' | 'outdoor' | 'studio';

/**
 * Who the user worked out with
 */
export type WorkoutCompanion = 'solo' | 'group' | 'trainer' | 'virtual_class';

/**
 * Data source for the exercise log
 */
export type ExerciseSource = 'manual' | 'healthkit';

/**
 * How an exercise's sets are tracked (drives which set fields are relevant)
 */
export type ExerciseTrackingType = 'weight_reps' | 'reps_only' | 'duration' | 'distance_duration';

/**
 * Type of a single set
 */
export type ExerciseSetType = 'normal' | 'warmup' | 'drop' | 'failure' | 'amrap';

/**
 * A catalog exercise (global library row or a user's custom exercise)
 */
export interface ExerciseCatalogItem {
  id: string;
  name: string;
  slug: string | null;
  aliases: string[];
  primary_muscle: string | null;
  secondary_muscles: string[];
  equipment: string | null;
  movement: string | null;
  tracking_type: ExerciseTrackingType;
  is_custom: boolean;
  created_by: string | null;
  is_public: boolean;
}

/**
 * Compact catalog projection used in search results and nested reads.
 */
export interface ExerciseCatalogSummary {
  id: string;
  name: string;
  primary_muscle: string | null;
  equipment: string | null;
  tracking_type: ExerciseTrackingType;
  is_custom: boolean;
}

/**
 * Input for a single set (service-layer, snake_case). Weight is canonical kilograms.
 */
export interface ExerciseSetInput {
  set_number: number;
  set_type?: ExerciseSetType;
  weight_kg?: number | null;
  reps?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  rpe?: number | null;
  is_completed?: boolean;
}

/**
 * Input for one movement within a workout (service-layer, snake_case).
 * Either exercise_id (existing catalog entry) OR custom_name (create-on-save) is required.
 */
export interface WorkoutExerciseInput {
  exercise_id?: string | null;
  custom_name?: string | null;
  primary_muscle?: string | null;
  equipment?: string | null;
  tracking_type?: ExerciseTrackingType | null;
  position: number;
  notes?: string | null;
  rest_seconds?: number | null;
  sets: ExerciseSetInput[];
}

/**
 * A single set as returned by reads (snake_case).
 */
export interface ExerciseSetRead {
  id: string;
  set_number: number;
  set_type: ExerciseSetType;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  rpe: number | null;
  is_completed: boolean;
}

/**
 * A movement within a workout as returned by reads (snake_case).
 */
export interface WorkoutExerciseRead {
  id: string;
  exercise_id: string;
  position: number;
  notes: string | null;
  rest_seconds: number | null;
  exercise: ExerciseCatalogSummary | null;
  sets: ExerciseSetRead[];
}

/**
 * Input for creating a custom exercise (service-layer, snake_case).
 */
export interface CustomExerciseInput {
  name: string;
  primary_muscle?: string | null;
  equipment?: string | null;
  tracking_type?: ExerciseTrackingType;
}

/**
 * Per-exercise history response (Previous column + future insights).
 */
export interface ExerciseHistorySession {
  exercise_log_id: string;
  workout_exercise_id: string;
  exercise_date: string;
  sets: ExerciseSetRead[];
  volume_kg: number;
  best_set: ExerciseSetRead | null;
  best_e1rm_kg: number | null;
}

export interface ExerciseHistoryResponse {
  exercise: ExerciseCatalogSummary;
  last_session: ExerciseHistorySession | null;
  best_set: ExerciseSetRead | null;
  best_e1rm_kg: number | null;
  e1rm_series: { date: string; e1rm_kg: number }[];
  volume_series: { date: string; volume_kg: number }[];
  session_count: number;
}

/**
 * Full exercise log record from database
 */
export interface ExerciseLog {
  id: string;
  user_id: string;

  // Tier 1: Core
  exercise_type: string;
  category: ExerciseCategory;
  duration_minutes: number;
  calories_burned: number | null;
  calories_estimated: boolean;
  exercise_date: string; // YYYY-MM-DD
  started_at: string | null; // ISO8601
  source: ExerciseSource;

  // Tier 2: Enrichment
  distance_meters: number | null;
  avg_heart_rate: number | null;
  effort_level: number | null; // 1-10 RPE
  location_type: LocationType | null;
  workout_companion: WorkoutCompanion | null;
  body_areas: string[] | null;
  is_indoor: boolean | null;
  notes: string | null;

  // HealthKit metadata
  healthkit_workout_id: string | null;
  source_device_name: string | null;

  // Visibility & status
  is_public: boolean;
  is_deleted: boolean;

  // Structured exercise log rollups (recomputed on nested writes)
  exercise_count: number | null;
  total_sets: number | null;
  total_volume_kg: number | null;
  has_exercise_log: boolean;

  // Nested structured exercise log (only populated on single-record reads)
  exercises?: WorkoutExerciseRead[];

  // Timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a single exercise log (manual entry or enrichment)
 */
export interface ExerciseLogCreateInput {
  exercise_type: string;
  category: ExerciseCategory;
  duration_minutes: number;
  date?: string; // YYYY-MM-DD, defaults to today
  source?: ExerciseSource; // defaults to 'manual'
  calories_burned?: number;
  started_at?: string; // ISO8601
  distance_meters?: number;
  avg_heart_rate?: number;
  effort_level?: number; // 1-10
  location_type?: LocationType;
  workout_companion?: WorkoutCompanion;
  is_indoor?: boolean;
  notes?: string;
  healthkit_workout_id?: string;
  source_device_name?: string;
  /** @deprecated Ignored — whether a workout claims the streak is decided server-side (workout-claim-policy). */
  auto_claim_streak?: boolean;
  /** Client IANA timezone; anchors the default `date` on the user's local today. */
  timezone?: string | null;
  exercises?: WorkoutExerciseInput[]; // NEW: optional structured exercise log (nested write)
}

/**
 * Input for bulk syncing exercises from HealthKit
 */
export interface ExerciseBulkSyncInput {
  exercises: ExerciseLogCreateInput[];
  /** @deprecated Ignored — whether a workout claims the streak is decided server-side (workout-claim-policy). */
  auto_claim_streak?: boolean;
  /** Client IANA timezone; anchors default dates and the streak day. */
  timezone?: string | null;
}

/**
 * Result of a single exercise in bulk sync
 */
export interface ExerciseSyncResult {
  healthkit_workout_id: string | null;
  exercise_type: string;
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
}

/**
 * Response from bulk sync endpoint
 */
export interface ExerciseBulkSyncResponse {
  synced: number;
  skipped: number;
  failed: number;
  results: ExerciseSyncResult[];
}

/**
 * Exercise statistics for a period
 */
export interface ExerciseStatsResponse {
  period: 'day' | 'week' | 'month';
  total_workouts: number;
  total_minutes: number;
  total_calories: number;
  average_duration: number;
  average_effort: number | null;
  top_category: string | null;
  category_breakdown: Record<string, number>;
  body_area_frequency: Record<string, number>;
  location_breakdown: Record<string, number>;
  streak_days: number;
}

/**
 * Recently used exercise type for Quick Log
 */
export interface RecentExerciseType {
  exercise_type: string;
  category: ExerciseCategory;
  last_duration: number;
  last_calories: number | null;
  count: number;
  last_used: string; // YYYY-MM-DD
}

/**
 * Calorie balance for a day (exercise + food)
 */
export interface CalorieBalanceResponse {
  date: string;
  calories_consumed: number;
  calories_burned: number;
  net_calories: number;
  exercise_count: number;
  food_log_count: number;
}

/**
 * Detected milestone on exercise creation
 */
export interface DetectedMilestone {
  type: string;
  title: string;
  description: string;
}

/**
 * Detected personal record on exercise creation
 */
export interface DetectedPR {
  type: string;
  exercise_type: string;
  value: number;
  previous_value: number | null;
  unit: string;
}

/**
 * Response from create exercise endpoint (includes achievements)
 */
export interface ExerciseCreateResponse {
  exercise: ExerciseLog;
  new_milestones: DetectedMilestone[];
  new_personal_records: DetectedPR[];
}
