// ============================================================================
// Multi-Tier Streak System Type Definitions
// ============================================================================

// ============================================================================
// ENUMS
// ============================================================================

export type ActivityType =
  | 'weight_log'
  | 'steps_log'
  | 'mood_log'
  | 'circle_checkin'
  | 'social_interaction'
  | 'streak_freeze'; // Manual freeze applied by user to cover missed day

export type MetricType =
  | 'weight'
  | 'steps'
  | 'mood'
  | 'measurements'
  | 'photos';

// ============================================================================
// DATABASE ENTITIES - TIER 1: ENGAGEMENT STREAKS
// ============================================================================

export interface EngagementStreak {
  id: string;
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_engagement_date: string | null;
  streak_freezes_available: number;
  streak_freezes_used_this_week: number;
  auto_freeze_reset_date: string | null;
  paused: boolean;
  pause_start_date: string | null;
  pause_end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface EngagementActivity {
  id: string;
  user_id: string;
  activity_date: string;
  activity_type: ActivityType;
  reference_id: string | null;
  created_at: string;
}

// ============================================================================
// DATABASE ENTITIES - TIER 2: METRIC STREAKS
// ============================================================================

export interface MetricStreak {
  id: string;
  user_id: string;
  metric_type: MetricType;
  current_streak: number;
  longest_streak: number;
  last_log_date: string | null;
  grace_days_available: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// DATABASE ENTITIES - TIER 3: CIRCLE STREAKS
// ============================================================================

export interface CircleStreakTracking {
  id: string;
  circle_id: string;
  team_collective_streak: number;
  longest_team_streak: number;
  last_full_team_checkin_date: string | null;
  grace_days_available: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface EngagementStreakResponse {
  current_streak: number;
  longest_streak: number;
  freezes_available: number;
  paused: boolean;
  pause_end_date: string | null;
  last_engagement_date: string | null;
}

export interface MetricStreakResponse {
  metric_type: MetricType;
  current_streak: number;
  longest_streak: number;
  last_log_date: string | null;
  grace_days_available: number;
  grace_days_used: number;
}

export interface AllMetricStreaksResponse {
  weight: MetricStreakResponse | null;
  steps: MetricStreakResponse | null;
  mood: MetricStreakResponse | null;
  measurements: MetricStreakResponse | null;
  photos: MetricStreakResponse | null;
}

export interface CircleStreakResponse {
  user_streak: number;
  user_longest_streak: number;
  team_collective_streak: number;
  team_longest_streak: number;
  last_checkin_date: string | null;
}

export interface EngagementHistoryEntry {
  date: string;
  activities: ActivityType[];
  activity_count: number;
}

export interface EngagementHistoryResponse {
  entries: EngagementHistoryEntry[];
  total_days: number;
  total_activities: number;
}

// ============================================================================
// API INPUT TYPES
// ============================================================================

export interface PauseStreakInput {
  resume_date?: string; // Optional, defaults to +90 days
  reason?: string; // Optional note
}

export interface RecordActivityInput {
  activity_type: ActivityType;
  reference_id?: string;
  activity_date?: string; // Optional, defaults to today
}

// ============================================================================
// BUSINESS LOGIC TYPES
// ============================================================================

export interface StreakCalculationResult {
  current_streak: number;
  longest_streak: number;
  freezes_used: number;
  streak_broken: boolean;
}

export interface MetricFrequencyConfig {
  frequency: 'daily' | 'weekly';
  grace_days: number;
  description: string;
  window_start?: number; // For weekly metrics (0=Sunday, 1=Monday, etc.)
  window_end?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Engagement Streak Constants
export const MAX_STREAK_FREEZES = 5;
export const DEFAULT_STREAK_FREEZES = 1;
export const FREEZE_RESET_INTERVAL_DAYS = 7;
export const FREEZE_EARN_STREAK_DAYS = 7;
export const MAX_PAUSE_DURATION_DAYS = 90;

// Metric Frequency Configurations
export const METRIC_FREQUENCY_CONFIG: Record<MetricType, MetricFrequencyConfig> = {
  weight: {
    frequency: 'daily',
    grace_days: 1, // 1 miss per week allowed
    description: 'Daily weight logging',
  },
  steps: {
    frequency: 'daily',
    grace_days: 1, // 1 rest day per week allowed
    description: 'Daily step tracking',
  },
  mood: {
    frequency: 'daily',
    grace_days: 2, // 2 misses per week allowed
    description: 'Daily mood check-in',
  },
  measurements: {
    frequency: 'weekly',
    grace_days: 0, // Must log once per week
    description: 'Weekly measurements',
    window_start: 1, // Monday
    window_end: 0, // Sunday
  },
  photos: {
    frequency: 'weekly',
    grace_days: 0, // Must log during weekend
    description: 'Weekly progress photos',
    window_start: 5, // Friday
    window_end: 0, // Sunday (3-day window)
  },
};

// Circle Streak Constants
export const MIN_CIRCLE_DURATION_FOR_GRACE = 14; // 2 weeks
export const CIRCLE_GRACE_DAYS_PER_WEEK = 1;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function isValidActivityType(type: string): type is ActivityType {
  return [
    'weight_log',
    'steps_log',
    'mood_log',
    'circle_checkin',
    'social_interaction',
  ].includes(type);
}

export function isValidMetricType(type: string): type is MetricType {
  return ['weight', 'steps', 'mood', 'measurements', 'photos'].includes(type);
}

export function getMetricFrequency(metricType: MetricType): MetricFrequencyConfig {
  return METRIC_FREQUENCY_CONFIG[metricType];
}

export function calculateGraceDaysForCircle(durationDays: number): number {
  if (durationDays < MIN_CIRCLE_DURATION_FOR_GRACE) {
    return 0; // Short challenges get no grace days
  }

  const weeks = Math.floor(durationDays / 7);
  return Math.max(1, weeks * CIRCLE_GRACE_DAYS_PER_WEEK);
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class StreakError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'StreakError';
  }
}

export const STREAK_ERROR_CODES = {
  ALREADY_PAUSED: 'ALREADY_PAUSED',
  NOT_PAUSED: 'NOT_PAUSED',
  PAUSE_TOO_LONG: 'PAUSE_TOO_LONG',
  NO_FREEZES_AVAILABLE: 'NO_FREEZES_AVAILABLE',
  INVALID_ACTIVITY_TYPE: 'INVALID_ACTIVITY_TYPE',
  INVALID_METRIC_TYPE: 'INVALID_METRIC_TYPE',
  ALREADY_LOGGED_TODAY: 'ALREADY_LOGGED_TODAY',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  STREAK_NOT_FOUND: 'STREAK_NOT_FOUND',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  DATE_HAS_ACTIVITY: 'DATE_HAS_ACTIVITY',
} as const;
