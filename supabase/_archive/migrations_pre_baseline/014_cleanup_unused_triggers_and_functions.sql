-- Remove unused triggers and functions to simplify database
-- Keeping only what's actively used by the FitCircle app

-- ============================================================================
-- DROP TRIGGERS (12 unused triggers)
-- ============================================================================

-- Achievements (not implemented)
DROP TRIGGER IF EXISTS update_achievements_updated_at ON achievements;

-- Check-ins (deprecated - using daily_tracking instead)
DROP TRIGGER IF EXISTS trigger_after_check_in_insert ON check_ins;
DROP TRIGGER IF EXISTS update_checkins_updated_at ON check_ins;

-- Comments (not implemented)
DROP TRIGGER IF EXISTS update_comments_updated_at ON comments;

-- Leaderboard (computed from daily_tracking, not stored)
DROP TRIGGER IF EXISTS update_leaderboard_updated_at ON leaderboard;

-- Notifications (not implemented)
DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;

-- Payments (not implemented)
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;

-- Progress entries (deprecated - using daily_tracking)
DROP TRIGGER IF EXISTS update_progress_entries_updated_at ON progress_entries;

-- Teams (not implemented)
DROP TRIGGER IF EXISTS trigger_update_team_member_count ON team_members;
DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members;
DROP TRIGGER IF EXISTS update_teams_updated_at ON teams;

-- Participant count (now handled in TypeScript service layer per CLAUDE.md)
DROP TRIGGER IF EXISTS trigger_update_participant_count ON challenge_participants;

-- ============================================================================
-- DROP FUNCTIONS (12 unused custom functions)
-- ============================================================================

-- Check-in related (using daily_tracking instead)
DROP FUNCTION IF EXISTS after_check_in_insert() CASCADE;
DROP FUNCTION IF EXISTS award_check_in_points(uuid) CASCADE;

-- Achievements (not implemented)
DROP FUNCTION IF EXISTS check_achievements(uuid, uuid) CASCADE;

-- Streaks (computed in TypeScript)
DROP FUNCTION IF EXISTS calculate_streak(uuid, uuid) CASCADE;

-- Teams (not implemented)
DROP FUNCTION IF EXISTS calculate_team_stats(uuid) CASCADE;
DROP FUNCTION IF EXISTS update_team_member_count() CASCADE;

-- Leaderboard (using LeaderboardService in TypeScript)
DROP FUNCTION IF EXISTS update_leaderboard_rankings(uuid) CASCADE;

-- Progress entries (deprecated - using daily_tracking)
DROP FUNCTION IF EXISTS get_progress_history(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Participant count (now in TypeScript per CLAUDE.md)
DROP FUNCTION IF EXISTS update_participant_count() CASCADE;

-- User circles (now using /api/fitcircles endpoint)
DROP FUNCTION IF EXISTS get_user_circles_with_progress() CASCADE;
DROP FUNCTION IF EXISTS get_participant_progress(uuid, uuid) CASCADE;

-- Cleanup (not needed - handled by app logic)
DROP FUNCTION IF EXISTS cleanup_expired_challenges() CASCADE;

-- ============================================================================
-- KEEP THESE FUNCTIONS (actively used)
-- ============================================================================
-- ✅ update_updated_at() - Used by multiple tables for updated_at timestamp
-- ✅ update_daily_tracking_updated_at() - Specific for daily_tracking
-- ✅ generate_unique_invite_code() - Used when creating challenges
-- ✅ join_challenge_with_code() - Used for join-by-code feature
-- ✅ All pg_trgm extension functions (text search) - PostgreSQL extension

-- ============================================================================
-- KEEP THESE TRIGGERS (actively used)
-- ============================================================================
-- ✅ update_challenges_updated_at - Updates challenges.updated_at
-- ✅ update_participants_updated_at - Updates challenge_participants.updated_at
-- ✅ update_profiles_updated_at - Updates profiles.updated_at
-- ✅ daily_tracking_updated_at - Updates daily_tracking.updated_at

-- Summary:
-- Removed: 12 triggers + 12 functions
-- Kept: 4 triggers + 4 custom functions + pg_trgm extension functions
