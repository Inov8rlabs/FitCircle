-- ============================================================================
-- Phase 1: User Engagement Infrastructure (Clean Migration)
-- PRD: /docs/PRD-ENGAGEMENT-V2.md
--
-- This migration ONLY adds new tables and columns that don't already exist.
-- Reuses existing: daily_goals, engagement_streaks, engagement_activities
-- ============================================================================

-- ============================================================================
-- 1. WEEKLY GOALS TABLE (NEW)
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekly_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    week_start DATE NOT NULL, -- Always a Monday
    goal_type TEXT NOT NULL CHECK (goal_type IN ('steps', 'weight', 'streak', 'active_days')),
    target_value NUMERIC NOT NULL CHECK (target_value > 0),
    actual_value NUMERIC DEFAULT 0 CHECK (actual_value >= 0),
    daily_breakdown JSONB DEFAULT '{}', -- {mon: 8500, tue: 9200, ...}
    completed BOOLEAN DEFAULT FALSE,
    fitcircle_id UUID REFERENCES challenges(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, week_start, goal_type, fitcircle_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_goals_user_week ON weekly_goals(user_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_goals_fitcircle ON weekly_goals(fitcircle_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_goals_completed ON weekly_goals(user_id, completed, week_start DESC);

ALTER TABLE weekly_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weekly goals"
    ON weekly_goals FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly goals"
    ON weekly_goals FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weekly goals"
    ON weekly_goals FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own weekly goals"
    ON weekly_goals FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 2. FITCIRCLE LEADERBOARD ENTRIES TABLE (NEW)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fitcircle_leaderboard_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fitcircle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'all_time')),
    period_start DATE NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN ('steps', 'weight_loss_pct', 'checkin_streak')),
    metric_value NUMERIC DEFAULT 0 CHECK (metric_value >= 0),
    rank INTEGER NOT NULL CHECK (rank > 0),
    rank_change INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(fitcircle_id, user_id, period, period_start)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_fitcircle_period ON fitcircle_leaderboard_entries(fitcircle_id, period, period_start, rank);
CREATE INDEX IF NOT EXISTS idx_leaderboard_user ON fitcircle_leaderboard_entries(user_id, fitcircle_id, period);
CREATE INDEX IF NOT EXISTS idx_leaderboard_ranking ON fitcircle_leaderboard_entries(fitcircle_id, period, period_start, metric_value DESC);

ALTER TABLE fitcircle_leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Circle members can view leaderboard entries"
    ON fitcircle_leaderboard_entries FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM circle_members
            WHERE circle_members.circle_id = fitcircle_leaderboard_entries.fitcircle_id
            AND circle_members.user_id = auth.uid()
            AND circle_members.is_active = TRUE
        )
    );

-- ============================================================================
-- 3. FITCIRCLE DATA SUBMISSIONS TABLE (NEW)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fitcircle_data_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fitcircle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    submission_date DATE NOT NULL,
    steps INTEGER CHECK (steps >= 0),
    weight NUMERIC(5,2) CHECK (weight > 0 AND weight < 1000),
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    rank_after_submission INTEGER,
    rank_change INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(fitcircle_id, user_id, submission_date)
);

CREATE INDEX IF NOT EXISTS idx_submissions_fitcircle_date ON fitcircle_data_submissions(fitcircle_id, submission_date DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON fitcircle_data_submissions(user_id, submission_date DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_timestamp ON fitcircle_data_submissions(fitcircle_id, submission_date, submitted_at);

ALTER TABLE fitcircle_data_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Circle members can view submissions"
    ON fitcircle_data_submissions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM circle_members
            WHERE circle_members.circle_id = fitcircle_data_submissions.fitcircle_id
            AND circle_members.user_id = auth.uid()
            AND circle_members.is_active = TRUE
        )
    );

CREATE POLICY "Users can insert own submissions"
    ON fitcircle_data_submissions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 4. EXTEND DAILY_TRACKING TABLE (Add only new columns)
-- ============================================================================

-- Add new columns for streak acknowledgment and submission tracking
-- Note: is_public already exists from migration 026
ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS previous_day_sentiment TEXT CHECK (previous_day_sentiment IN ('great', 'ok', 'could_be_better')),
ADD COLUMN IF NOT EXISTS previous_day_steps INTEGER CHECK (previous_day_steps >= 0),
ADD COLUMN IF NOT EXISTS streak_day INTEGER DEFAULT 0 CHECK (streak_day >= 0),
ADD COLUMN IF NOT EXISTS submitted_to_fitcircles BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS submission_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_daily_tracking_submitted ON daily_tracking(user_id, submitted_to_fitcircles, tracking_date DESC);

-- ============================================================================
-- 5. UPDATE TRIGGERS (Simple timestamp updates only)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_weekly_goals_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS weekly_goals_updated_at ON weekly_goals;
CREATE TRIGGER weekly_goals_updated_at
    BEFORE UPDATE ON weekly_goals
    FOR EACH ROW
    EXECUTE FUNCTION update_weekly_goals_timestamp();

-- ============================================================================
-- 6. HELPER VIEWS (For easier querying)
-- ============================================================================

-- View for current weekly goals (most recent week for each user)
CREATE OR REPLACE VIEW current_weekly_goals AS
SELECT DISTINCT ON (user_id, goal_type, fitcircle_id)
    id,
    user_id,
    week_start,
    goal_type,
    target_value,
    actual_value,
    daily_breakdown,
    completed,
    fitcircle_id,
    created_at,
    updated_at
FROM weekly_goals
ORDER BY user_id, goal_type, fitcircle_id, week_start DESC;

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE weekly_goals IS 'Phase 1 Engagement: Weekly milestone goals';
COMMENT ON TABLE fitcircle_leaderboard_entries IS 'Phase 1 Engagement: FitCircle leaderboards by period';
COMMENT ON TABLE fitcircle_data_submissions IS 'Phase 1 Engagement: Manual FitCircle data submissions';

-- ============================================================================
-- NOTES ON REUSED TABLES:
-- ============================================================================
--
-- Instead of creating new tables, we reuse existing ones:
--
-- 1. DAILY GOALS: Use existing `daily_goals` table from migration 026
--    - Already has all needed columns: goal_type, target_value, is_active
--    - Service layer should use this table directly
--
-- 2. USER STREAKS: Use existing `engagement_streaks` table from migration 022
--    - Already has: current_streak, longest_streak, last_engagement_date
--    - Already has freeze mechanics: streak_freezes_available, streak_freezes_used_this_week
--    - Service layer should map to this table:
--      * user_streaks.current_streak -> engagement_streaks.current_streak
--      * user_streaks.freeze_used_this_week -> engagement_streaks.streak_freezes_used_this_week > 0
--
-- 3. ENGAGEMENT ACTIVITIES: Use existing `engagement_activities` table
--    - Track daily check-ins, submissions, etc.
--
-- ============================================================================

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
