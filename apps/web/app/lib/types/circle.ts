// FitCircle Type Definitions

// ============================================================================
// ENUMS
// ============================================================================

export type GoalType = 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
export type InviteStatus = 'pending' | 'accepted' | 'expired';
export type EncouragementType = 'high_five' | 'message' | 'cheer' | 'milestone';
export type MilestoneType = 'progress_25' | 'progress_50' | 'progress_75' | 'progress_100' | 'streak_7' | 'streak_14' | 'streak_30';
export type CircleStatus = 'upcoming' | 'active' | 'completed';

// ============================================================================
// DATABASE ENTITIES
// ============================================================================

export interface Circle {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  start_date: string;
  end_date: string;
  invite_code: string;
  privacy_mode: boolean;
  auto_accept_invites: boolean;
  allow_late_join: boolean;
  late_join_deadline: number;
  participant_count?: number;
  status: CircleStatus;
  created_at: string;
  updated_at: string;
}

export interface CircleInvite {
  id: string;
  circle_id: string;
  inviter_id: string;
  invite_code: string;
  email?: string;
  status: InviteStatus;
  created_at: string;
  accepted_at?: string;
  accepted_by?: string;
  expires_at: string;
}

export interface CircleMember {
  id: string;
  circle_id: string;
  user_id: string;
  invited_by?: string;
  goal_type?: GoalType;
  goal_start_value?: number;
  goal_target_value?: number;
  goal_unit?: string;
  goal_description?: string;
  current_value?: number;
  progress_percentage: number;
  check_ins_count: number;
  streak_days: number;
  longest_streak: number;
  last_check_in_at?: string;
  total_high_fives_sent: number;
  total_high_fives_received: number;
  privacy_settings: PrivacySettings;
  joined_at: string;
  goal_locked_at?: string;
  is_active: boolean;
  left_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CircleCheckIn {
  id: string;
  member_id: string;
  circle_id: string;
  user_id: string;
  check_in_date: string;
  check_in_value: number;
  progress_percentage?: number;
  mood_score?: number;
  energy_level?: number;
  note?: string;
  created_at: string;
}

export interface CircleEncouragement {
  id: string;
  circle_id: string;
  from_user_id: string;
  to_user_id?: string;
  type: EncouragementType;
  content?: string;
  milestone_type?: MilestoneType;
  created_at: string;
}

export interface DailyHighFiveLimit {
  id: string;
  user_id: string;
  circle_id: string;
  date: string;
  count: number;
  created_at: string;
}

// ============================================================================
// API INPUT TYPES
// ============================================================================

export interface CreateCircleInput {
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  max_participants?: number;
  allow_late_join?: boolean;
  late_join_deadline?: number;
}

export interface GoalInput {
  goal_type: GoalType;
  goal_start_value?: number;
  goal_target_value: number;
  goal_unit?: string;
  goal_description?: string;
}

export interface CheckInInput {
  value: number;
  mood_score?: number;
  energy_level?: number;
  note?: string;
}

export interface CreateInviteInput {
  email?: string;
  message?: string;
}

export interface SendEncouragementInput {
  to_user_id?: string;
  type: EncouragementType;
  content?: string;
  milestone_type?: MilestoneType;
}

export interface JoinCircleInput {
  invite_code: string;
  goal: GoalInput;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface CircleWithDetails extends Circle {
  member_count: number;
  days_remaining: number;
  is_member?: boolean;
  user_progress?: number;
  user_rank?: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url?: string;
  progress_percentage: number;
  streak_days: number;
  last_check_in_at?: string;
  checked_in_today: boolean;
  high_fives_received: number;
  is_current_user?: boolean;
  current_value?: number;
  starting_value?: number;
  target_value?: number;
  goal_type?: GoalType;
  goal_unit?: string;
}

export interface CircleStats {
  average_progress: number;
  check_ins_count: number;
  completion_rate: number;
  average_streak: number;
  most_consistent_member_id?: string;
  most_consistent_member_name?: string;
}

export interface InviteDetails {
  valid: boolean;
  circle_name?: string;
  circle_description?: string;
  starts_in_days?: number;
  member_count?: number;
  inviter_name?: string;
  error_reason?: string;
}

export interface CheckInResponse {
  progress_percentage: number;
  rank_change: number;
  streak_days: number;
  milestone_reached?: MilestoneType;
  new_rank?: number;
}

export interface MyCirclesResponse {
  active: CircleWithDetails[];
  upcoming: CircleWithDetails[];
  completed: CircleWithDetails[];
}

export interface EncouragementWithUser extends CircleEncouragement {
  from_user: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
  to_user?: {
    id: string;
    display_name: string;
    avatar_url?: string;
  };
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface PrivacySettings {
  hide_from_leaderboard?: boolean;
  hide_streak?: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ApiError {
  error: string;
  details?: string;
  validation_errors?: ValidationError[];
}

export interface ApiSuccess<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

// ============================================================================
// UTILITY FUNCTIONS FOR TYPE GUARDS
// ============================================================================

export function isValidGoalType(type: string): type is GoalType {
  return ['weight_loss', 'step_count', 'workout_frequency', 'custom'].includes(type);
}

export function isValidEncouragementType(type: string): type is EncouragementType {
  return ['high_five', 'message', 'cheer', 'milestone'].includes(type);
}

export function isValidMilestoneType(type: string): type is MilestoneType {
  return [
    'progress_25', 'progress_50', 'progress_75', 'progress_100',
    'streak_7', 'streak_14', 'streak_30'
  ].includes(type);
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const INVITE_CODE_LENGTH = 9;
export const MAX_HIGH_FIVES_PER_DAY = 10;
export const MAX_CIRCLE_NAME_LENGTH = 50;
export const MAX_CIRCLE_DESCRIPTION_LENGTH = 200;
export const MAX_NOTE_LENGTH = 100;
export const MAX_MESSAGE_LENGTH = 200;
export const MIN_CHALLENGE_DURATION_DAYS = 7;
export const MAX_CHALLENGE_DURATION_DAYS = 365;
export const DEFAULT_LATE_JOIN_DAYS = 3;
export const MAX_WEIGHT_LOSS_PER_WEEK_LBS = 2;
export const MAX_DAILY_STEPS = 50000;
export const MAX_WEEKLY_WORKOUTS = 14;