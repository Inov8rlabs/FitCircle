-- Migration 018: Drop circle_members table
-- This table was created in migration 008 but was never populated
-- All data lives in challenge_participants table, which is used by both web and mobile

-- The circle_members table is EMPTY and causes confusion
-- Web app uses challenge_participants, mobile should use the same table

-- Drop the empty circle_members table to prevent confusion
DROP TABLE IF EXISTS circle_members CASCADE;

-- Add index on challenge_participants for better performance
CREATE INDEX IF NOT EXISTS idx_challenge_participants_user_challenge
ON challenge_participants(user_id, challenge_id);

CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge_status
ON challenge_participants(challenge_id, status);

-- Add comment to clarify this is the single source of truth
COMMENT ON TABLE challenge_participants IS 'Single source of truth for all circle/challenge participants. Used by both web and mobile APIs.';
