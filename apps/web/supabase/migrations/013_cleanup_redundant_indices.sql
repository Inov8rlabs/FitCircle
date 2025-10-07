-- Remove redundant and unused indices to improve write performance
-- These are either duplicates of unique constraints or not used by the app

-- Achievements (feature not implemented yet)
DROP INDEX IF EXISTS idx_achievements_challenge;
DROP INDEX IF EXISTS idx_achievements_type;
DROP INDEX IF EXISTS idx_achievements_user;

-- Challenge invitations (not using this feature)
DROP INDEX IF EXISTS idx_challenge_invitations_challenge;
DROP INDEX IF EXISTS idx_challenge_invitations_email;
DROP INDEX IF EXISTS idx_challenge_invitations_status;
DROP INDEX IF EXISTS idx_challenge_invitations_user;

-- Challenges - remove rarely queried indices
DROP INDEX IF EXISTS idx_challenges_dates;       -- Can use created_at instead
DROP INDEX IF EXISTS idx_challenges_featured;    -- Feature not implemented
DROP INDEX IF EXISTS idx_challenges_location;    -- Not using location-based queries
DROP INDEX IF EXISTS idx_challenges_search;      -- Not using full-text search yet
DROP INDEX IF EXISTS idx_challenges_tags;        -- Not using tags yet
DROP INDEX IF EXISTS idx_challenges_visibility;  -- Small cardinality, not worth index

-- Check-ins (using daily_tracking instead)
DROP INDEX IF EXISTS idx_checkins_challenge;
DROP INDEX IF EXISTS idx_checkins_date;
DROP INDEX IF EXISTS idx_checkins_participant;
DROP INDEX IF EXISTS idx_checkins_team;
DROP INDEX IF EXISTS idx_checkins_user;
DROP INDEX IF EXISTS idx_checkins_verification;

-- Comments (not implemented yet)
DROP INDEX IF EXISTS idx_comments_created;
DROP INDEX IF EXISTS idx_comments_entity;
DROP INDEX IF EXISTS idx_comments_parent;
DROP INDEX IF EXISTS idx_comments_user;

-- Leaderboard table (redundant - computed from daily_tracking)
DROP INDEX IF EXISTS idx_leaderboard_challenge;
DROP INDEX IF EXISTS idx_leaderboard_entity;
DROP INDEX IF EXISTS idx_leaderboard_rank;

-- Notifications (not implemented yet)
DROP INDEX IF EXISTS idx_notifications_created;
DROP INDEX IF EXISTS idx_notifications_type;
DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_notifications_user;

-- Challenge participants - remove redundant
DROP INDEX IF EXISTS idx_participants_rank;      -- Computed at query time
DROP INDEX IF EXISTS idx_participants_status;    -- Small cardinality
DROP INDEX IF EXISTS idx_participants_team;      -- Teams not implemented

-- Payments (not implemented yet)
DROP INDEX IF EXISTS idx_payments_challenge;
DROP INDEX IF EXISTS idx_payments_status;
DROP INDEX IF EXISTS idx_payments_stripe;
DROP INDEX IF EXISTS idx_payments_user;

-- Profiles - remove redundant
DROP INDEX IF EXISTS idx_profiles_active;        -- Boolean, low cardinality
DROP INDEX IF EXISTS idx_profiles_stripe_customer; -- Redundant with unique constraint
DROP INDEX IF EXISTS idx_profiles_username;      -- Redundant with unique constraint

-- Progress entries (deprecated - using daily_tracking)
DROP INDEX IF EXISTS idx_progress_entries_challenge_date;
DROP INDEX IF EXISTS idx_progress_entries_public;
DROP INDEX IF EXISTS idx_progress_entries_user_challenge;

-- Reactions (not implemented yet)
DROP INDEX IF EXISTS idx_reactions_entity;
DROP INDEX IF EXISTS idx_reactions_user;

-- Team members (teams not implemented)
DROP INDEX IF EXISTS idx_team_members_active;
DROP INDEX IF EXISTS idx_team_members_team;
DROP INDEX IF EXISTS idx_team_members_user;

-- Teams (not implemented)
DROP INDEX IF EXISTS idx_teams_challenge;
DROP INDEX IF EXISTS idx_teams_invite_code;
DROP INDEX IF EXISTS idx_teams_rank;

-- Keep only these essential indices for current functionality:
-- 1. idx_daily_tracking_user_date (core feature)
-- 2. idx_challenges_creator (for "my circles")
-- 3. idx_challenges_invite_code (for join with code)
-- 4. idx_challenges_status (for filtering active)
-- 5. idx_participants_user (for user's challenges)
-- 6. idx_participants_challenge (for leaderboards)
-- 7. idx_profiles_email (for user lookup)

-- All *_pkey and *_key indices are kept automatically by PostgreSQL
