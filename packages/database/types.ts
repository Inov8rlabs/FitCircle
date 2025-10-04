// Generated types from database schema
// These types match the actual database structure

export type ChallengeStatus = 'draft' | 'upcoming' | 'active' | 'completed' | 'cancelled';
export type ChallengeType = 'weight_loss' | 'step_count' | 'workout_minutes' | 'custom';
export type ChallengeVisibility = 'public' | 'private' | 'invite_only';
export type TeamRole = 'captain' | 'member';
export type NotificationType = 'challenge_invite' | 'team_invite' | 'check_in_reminder' | 'achievement' | 'comment' | 'reaction' | 'leaderboard_update' | 'system';
export type NotificationChannel = 'push' | 'email' | 'sms' | 'in_app';
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
export type SubscriptionStatus = 'trialing' | 'active' | 'cancelled' | 'past_due' | 'unpaid' | 'incomplete';
export type AchievementType = 'milestone' | 'streak' | 'ranking' | 'participation' | 'special';
export type ReactionType = 'like' | 'love' | 'celebrate' | 'fire' | 'muscle' | 'trophy';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url?: string;
  bio?: string;
  date_of_birth?: string;
  height_cm?: number;
  weight_kg?: number;
  timezone?: string;
  country_code?: string;
  phone_number?: string;
  phone_verified?: boolean;
  onboarding_completed?: boolean;
  fitness_level?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  goals?: any[];
  preferences?: Record<string, any>;
  health_data_sync?: Record<string, any>;
  stripe_customer_id?: string;
  subscription_tier?: 'free' | 'premium' | 'enterprise';
  subscription_status?: SubscriptionStatus;
  subscription_expires_at?: string;
  total_points?: number;
  current_streak?: number;
  longest_streak?: number;
  challenges_completed?: number;
  challenges_won?: number;
  metadata?: Record<string, any>;
  is_active?: boolean;
  last_active_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Challenge {
  id: string;
  creator_id: string;
  name: string;
  description?: string;
  type: ChallengeType;
  status?: ChallengeStatus;
  visibility?: ChallengeVisibility;
  rules?: Record<string, any>;
  scoring_system?: Record<string, any>;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  entry_fee?: number;
  prize_pool?: number;
  prize_distribution?: any[];
  min_participants?: number;
  max_participants?: number;
  min_team_size?: number;
  max_team_size?: number;
  allow_late_join?: boolean;
  late_join_penalty?: number;
  cover_image_url?: string;
  badge_image_url?: string;
  tags?: string[];
  location?: { lat: number; lng: number };
  location_name?: string;
  is_featured?: boolean;
  sponsor_info?: Record<string, any>;
  custom_fields?: Record<string, any>;
  participant_count?: number;
  team_count?: number;
  total_check_ins?: number;
  avg_progress?: number;
  completion_rate?: number;
  engagement_score?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Team {
  id: string;
  challenge_id: string;
  name: string;
  motto?: string;
  avatar_url?: string;
  is_public?: boolean;
  max_members?: number;
  member_count?: number;
  total_points?: number;
  rank?: number;
  invite_code?: string;
  settings?: Record<string, any>;
  stats?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role?: TeamRole;
  joined_at?: string;
  points_contributed?: number;
  check_ins_count?: number;
  last_check_in_at?: string;
  is_active?: boolean;
  removed_at?: string;
  removed_by?: string;
  removal_reason?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface ChallengeParticipant {
  id: string;
  challenge_id: string;
  user_id: string;
  team_id?: string;
  status?: 'pending' | 'active' | 'completed' | 'dropped' | 'disqualified';
  joined_at?: string;
  completed_at?: string;
  dropped_at?: string;
  disqualified_at?: string;
  disqualification_reason?: string;
  starting_weight_kg?: number;
  current_weight_kg?: number;
  goal_weight_kg?: number;
  starting_value?: number;
  current_value?: number;
  goal_value?: number;
  progress_percentage?: number;
  total_points?: number;
  rank?: number;
  check_ins_count?: number;
  streak_days?: number;
  missed_check_ins?: number;
  last_check_in_at?: string;
  achievements?: any[];
  stats?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface CheckIn {
  id: string;
  user_id: string;
  challenge_id: string;
  participant_id: string;
  team_id?: string;
  check_in_date: string;
  weight_kg?: number;
  body_fat_percentage?: number;
  muscle_mass_kg?: number;
  water_percentage?: number;
  steps?: number;
  active_minutes?: number;
  calories_burned?: number;
  distance_km?: number;
  floors_climbed?: number;
  sleep_hours?: number;
  water_intake_ml?: number;
  mood_score?: number;
  energy_level?: number;
  notes?: string;
  photo_urls?: string[];
  measurements?: Record<string, any>;
  workouts?: any[];
  nutrition?: Record<string, any>;
  custom_metrics?: Record<string, any>;
  points_earned?: number;
  verification_status?: 'pending' | 'verified' | 'flagged' | 'rejected';
  verified_by?: string;
  verified_at?: string;
  verification_notes?: string;
  is_valid?: boolean;
  source?: 'manual' | 'apple_health' | 'google_fit' | 'fitbit' | 'garmin' | 'api';
  device_data?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Leaderboard {
  id: string;
  challenge_id: string;
  entity_id: string;
  entity_type: 'individual' | 'team';
  rank: number;
  previous_rank?: number;
  points: number;
  progress_percentage?: number;
  weight_lost_kg?: number;
  weight_lost_percentage?: number;
  total_steps?: number;
  total_minutes?: number;
  check_ins_count?: number;
  streak_days?: number;
  last_check_in_at?: string;
  trend?: 'up' | 'down' | 'stable';
  stats?: Record<string, any>;
  calculated_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  channel?: NotificationChannel;
  title: string;
  body: string;
  action_url?: string;
  action_data?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  sender_id?: string;
  related_challenge_id?: string;
  related_team_id?: string;
  related_user_id?: string;
  is_read?: boolean;
  read_at?: string;
  is_archived?: boolean;
  archived_at?: string;
  sent_at?: string;
  delivered_at?: string;
  clicked_at?: string;
  error_message?: string;
  retry_count?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Comment {
  id: string;
  user_id: string;
  parent_id?: string;
  entity_type: 'check_in' | 'challenge' | 'team' | 'achievement';
  entity_id: string;
  content: string;
  mentions?: string[];
  is_edited?: boolean;
  edited_at?: string;
  is_deleted?: boolean;
  deleted_at?: string;
  deleted_by?: string;
  reactions_count?: number;
  replies_count?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Reaction {
  id: string;
  user_id: string;
  entity_type: 'check_in' | 'comment' | 'achievement';
  entity_id: string;
  type: ReactionType;
  created_at?: string;
}

export interface Payment {
  id: string;
  user_id: string;
  challenge_id?: string;
  amount: number;
  currency?: string;
  status: PaymentStatus;
  type: 'entry_fee' | 'subscription' | 'donation' | 'prize' | 'refund';
  stripe_payment_intent_id?: string;
  stripe_charge_id?: string;
  stripe_refund_id?: string;
  payment_method?: string;
  payment_method_details?: Record<string, any>;
  description?: string;
  receipt_url?: string;
  failure_reason?: string;
  refunded_amount?: number;
  fee_amount?: number;
  net_amount?: number;
  tax_amount?: number;
  processed_at?: string;
  failed_at?: string;
  refunded_at?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Achievement {
  id: string;
  user_id: string;
  challenge_id?: string;
  type: AchievementType;
  name: string;
  description?: string;
  icon_url?: string;
  badge_url?: string;
  points?: number;
  level?: number;
  unlocked_at?: string;
  progress?: number;
  criteria?: Record<string, any>;
  metadata?: Record<string, any>;
  shared?: boolean;
  shared_at?: string;
  created_at?: string;
  updated_at?: string;
}

// Joined types for API responses
export interface ProfileWithStats extends Profile {
  stats?: {
    total_check_ins: number;
    current_streak: number;
    active_challenges: number;
    completed_challenges: number;
    teams_joined: number;
  };
}

export interface ChallengeWithParticipants extends Challenge {
  participants?: ChallengeParticipant[];
  teams?: Team[];
  creator?: Profile;
}

export interface TeamWithMembers extends Team {
  members?: (TeamMember & { user?: Profile })[];
  challenge?: Challenge;
}

export interface CheckInWithUser extends CheckIn {
  user?: Profile;
  challenge?: Challenge;
  team?: Team;
}

export interface NotificationWithRelated extends Notification {
  sender?: Profile;
  challenge?: Challenge;
  team?: Team;
  related_user?: Profile;
}