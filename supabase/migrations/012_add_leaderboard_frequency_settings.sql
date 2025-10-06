-- Migration 012: Add leaderboard frequency settings to challenges table
-- This allows challenges to specify how often leaderboards update

-- Add leaderboard frequency columns
ALTER TABLE challenges
ADD COLUMN IF NOT EXISTS leaderboard_update_frequency VARCHAR(20) DEFAULT 'realtime' CHECK (leaderboard_update_frequency IN ('realtime', 'daily', 'weekly'));

ALTER TABLE challenges
ADD COLUMN IF NOT EXISTS leaderboard_update_day INTEGER CHECK (leaderboard_update_day >= 0 AND leaderboard_update_day <= 6);

ALTER TABLE challenges
ADD COLUMN IF NOT EXISTS leaderboard_update_time TIME;

-- Add comment for clarity
COMMENT ON COLUMN challenges.leaderboard_update_frequency IS 'How often the leaderboard updates: realtime, daily, or weekly';
COMMENT ON COLUMN challenges.leaderboard_update_day IS 'Day of week for weekly updates (0=Sunday, 6=Saturday)';
COMMENT ON COLUMN challenges.leaderboard_update_time IS 'Time of day for leaderboard updates (in ET/UTC depending on app config)';

-- Update existing challenges to have default realtime updates
UPDATE challenges
SET leaderboard_update_frequency = 'realtime'
WHERE leaderboard_update_frequency IS NULL;
