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

-- ============================================================================
-- MERGED FROM former 012_add_progress_tracking.sql (2026-06-01)
-- Reason: Supabase migration versions must be a unique integer prefix; two 012_*
-- files collided on version '012'. Merged into one file rather than renumber
-- (must stay before 013/014 which depend on progress_entries, and before the 038
-- challenges->fitcircles rename). Content below is the reconstructed progress schema.
-- ============================================================================


-- ============================================================================
-- 1. PROGRESS ENTRIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS progress_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
    weight DECIMAL(5,2),
    body_fat_percentage DECIMAL(4,2),
    measurements JSONB,
    photos TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, challenge_id, recorded_at)
);

ALTER TABLE progress_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own progress"
    ON progress_entries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own progress"
    ON progress_entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_progress_user_date ON progress_entries(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_progress_challenge_date ON progress_entries(challenge_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_progress_user_challenge ON progress_entries(user_id, challenge_id);

-- ============================================================================
-- 2. PROGRESS MILESTONES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS progress_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    milestone_type TEXT NOT NULL,
    target_value DECIMAL(10,2),
    achieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_challenge ON progress_milestones(challenge_id);
CREATE INDEX IF NOT EXISTS idx_milestones_type ON progress_milestones(milestone_type);
