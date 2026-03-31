// ============================================================================
// Circle Challenges Type Definitions
// ============================================================================

// ============================================================================
// ENUMS
// ============================================================================

export type ChallengeCategory = 'strength' | 'cardio' | 'flexibility' | 'wellness' | 'custom';
export type CircleChallengeStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type ChallengeParticipantStatus = 'invited' | 'active' | 'withdrawn';
export type ChallengeInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type ChallengeDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'variable';

// ============================================================================
// DATABASE ENTITIES
// ============================================================================

export interface CircleChallenge {
  id: string;
  fitcircle_id: string;
  creator_id: string;
  template_id: string | null;
  name: string;
  description: string | null;
  category: ChallengeCategory;
  goal_amount: number;
  unit: string;
  logging_prompt: string | null;
  is_open: boolean;
  status: CircleChallengeStatus;
  starts_at: string;
  ends_at: string;
  participant_count: number;
  winner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CircleChallengeParticipant {
  id: string;
  challenge_id: string;
  user_id: string;
  fitcircle_id: string;
  invited_by: string | null;
  status: ChallengeParticipantStatus;
  cumulative_total: number;
  today_total: number;
  today_date: string;
  current_streak: number;
  longest_streak: number;
  last_logged_at: string | null;
  log_count: number;
  rank: number | null;
  goal_completion_pct: number;
  milestones_achieved: Record<string, boolean>;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface CircleChallengeLog {
  id: string;
  challenge_id: string;
  participant_id: string;
  user_id: string;
  fitcircle_id: string;
  amount: number;
  note: string | null;
  logged_at: string;
  log_date: string;
  created_at: string;
}

export interface CircleChallengeInvite {
  id: string;
  challenge_id: string;
  inviter_id: string;
  invitee_id: string;
  status: ChallengeInviteStatus;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
}

// ============================================================================
// CHALLENGE TEMPLATES
// ============================================================================

export interface ChallengeTemplate {
  id: string;
  name: string;
  description: string;
  category: ChallengeCategory;
  goal_amount: number;
  unit: string;
  recommended_duration_days: number;
  difficulty: ChallengeDifficulty;
  logging_prompt: string;
  icon: string;
}

// ============================================================================
// API INPUT TYPES
// ============================================================================

export interface CreateCircleChallengeInput {
  fitcircle_id: string;
  template_id?: string;
  name: string;
  description?: string;
  category: ChallengeCategory;
  goal_amount: number;
  unit: string;
  logging_prompt?: string;
  is_open?: boolean;
  starts_at: string;
  ends_at: string;
  invite_user_ids?: string[];
}

export interface LogActivityInput {
  amount: number;
  note?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface CircleChallengeWithDetails extends CircleChallenge {
  creator_name?: string;
  creator_avatar?: string;
  my_participation?: CircleChallengeParticipant | null;
  duration_days: number;
  days_remaining: number;
  template?: ChallengeTemplate | null;
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  cumulative_total: number;
  today_total: number;
  current_streak: number;
  goal_completion_pct: number;
  last_logged_at: string | null;
  gap_to_next: number | null;
  is_current_user: boolean;
}

export interface LogActivityResponse {
  log: CircleChallengeLog;
  updated_participant: {
    cumulative_total: number;
    today_total: number;
    rank: number;
    goal_completion_pct: number;
    current_streak: number;
  };
  rank_changed: boolean;
  old_rank: number | null;
  new_rank: number;
  milestone_reached: string | null;
  passed_users: string[];
}

export interface ChallengeListResponse {
  active: CircleChallengeWithDetails[];
  scheduled: CircleChallengeWithDetails[];
  completed: CircleChallengeWithDetails[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_LOGS_PER_DAY = 20;
export const MAX_LOG_AMOUNT = 10000;
export const MIN_LOG_AMOUNT = 0.1;
export const MAX_CHALLENGE_NAME_LENGTH = 50;
export const MAX_CHALLENGE_DESCRIPTION_LENGTH = 200;
export const MAX_LOG_NOTE_LENGTH = 80;
export const MAX_LOGGING_PROMPT_LENGTH = 60;
export const MIN_CHALLENGE_DURATION_DAYS = 3;
export const MAX_CHALLENGE_DURATION_DAYS = 90;
export const DUPLICATE_DETECTION_WINDOW_MS = 60_000;
export const STREAK_GRACE_HOURS = 36;

// Milestone thresholds
export const MILESTONES = [25, 50, 75, 100] as const;
export type MilestoneThreshold = typeof MILESTONES[number];
