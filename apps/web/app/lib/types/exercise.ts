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
  auto_claim_streak?: boolean; // defaults to true for manual, false for healthkit
}

/**
 * Input for bulk syncing exercises from HealthKit
 */
export interface ExerciseBulkSyncInput {
  exercises: ExerciseLogCreateInput[];
  auto_claim_streak?: boolean; // always false for HealthKit sync
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
