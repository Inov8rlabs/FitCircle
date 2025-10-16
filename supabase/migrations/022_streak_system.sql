-- ============================================================================
-- Multi-Tier Streak System Migration
-- Phase 1: Engagement Streaks (Tier 1)
-- Phase 3: Metric & Circle Streaks (Tier 2 & 3)
-- ============================================================================

-- ============================================================================
-- TIER 1: ENGAGEMENT STREAKS TABLE
-- ============================================================================

-- Tracks user's overall engagement streak across all activities
CREATE TABLE IF NOT EXISTS engagement_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

    -- Streak tracking
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_engagement_date DATE,

    -- Freeze/grace system
    streak_freezes_available INTEGER NOT NULL DEFAULT 1,
    streak_freezes_used_this_week INTEGER NOT NULL DEFAULT 0,
    auto_freeze_reset_date DATE,

    -- Pause system (life events)
    paused BOOLEAN NOT NULL DEFAULT false,
    pause_start_date DATE,
    pause_end_date DATE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_engagement_streaks_user_id ON engagement_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_engagement_streaks_last_engagement ON engagement_streaks(last_engagement_date);

-- ============================================================================
-- ENGAGEMENT ACTIVITIES TABLE
-- ============================================================================

-- Tracks individual engagement activities for streak calculation
CREATE TABLE IF NOT EXISTS engagement_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,

    -- Activity type
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'weight_log',
        'steps_log',
        'mood_log',
        'circle_checkin',
        'social_interaction'
    )),

    -- Optional reference to source record
    reference_id UUID,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure one activity of each type per day per reference
    CONSTRAINT unique_engagement_activity UNIQUE (user_id, activity_date, activity_type, reference_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_engagement_activities_user_date ON engagement_activities(user_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_activities_type ON engagement_activities(activity_type);

-- ============================================================================
-- TIER 2: METRIC STREAKS TABLE
-- ============================================================================

-- Tracks streaks for specific metrics (weight, steps, mood, etc.)
CREATE TABLE IF NOT EXISTS metric_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Metric type
    metric_type TEXT NOT NULL CHECK (metric_type IN (
        'weight',
        'steps',
        'mood',
        'measurements',
        'photos'
    )),

    -- Streak tracking
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_log_date DATE,

    -- Grace days (varies by metric)
    grace_days_available INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One streak per user per metric
    CONSTRAINT unique_metric_streak UNIQUE (user_id, metric_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_metric_streaks_user_id ON metric_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_metric_streaks_type ON metric_streaks(metric_type);

-- ============================================================================
-- TIER 3: CIRCLE STREAKS (Update existing challenge_participants)
-- ============================================================================

-- Add circle-specific streak columns to existing challenge_participants table
-- Note: challenge_participants already has streak_days and longest_streak
-- We'll add team collective streak tracking to a new table

CREATE TABLE IF NOT EXISTS circle_streak_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE UNIQUE,

    -- Team collective streak (days entire team checked in)
    team_collective_streak INTEGER NOT NULL DEFAULT 0,
    longest_team_streak INTEGER NOT NULL DEFAULT 0,
    last_full_team_checkin_date DATE,

    -- Grace days (based on challenge duration)
    grace_days_available INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_circle_streak_tracking_circle_id ON circle_streak_tracking(circle_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE engagement_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_streak_tracking ENABLE ROW LEVEL SECURITY;

-- Engagement Streaks Policies
CREATE POLICY "Users can view own engagement streak"
    ON engagement_streaks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own engagement streak"
    ON engagement_streaks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own engagement streak"
    ON engagement_streaks FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Engagement Activities Policies
CREATE POLICY "Users can view own engagement activities"
    ON engagement_activities FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own engagement activities"
    ON engagement_activities FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Metric Streaks Policies
CREATE POLICY "Users can view own metric streaks"
    ON metric_streaks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own metric streaks"
    ON metric_streaks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own metric streaks"
    ON metric_streaks FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Circle Streak Tracking Policies (visible to all circle members)
CREATE POLICY "Circle members can view circle streak"
    ON circle_streak_tracking FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM challenge_participants
            WHERE challenge_id = circle_streak_tracking.circle_id
            AND user_id = auth.uid()
            AND status = 'active'
        )
    );

CREATE POLICY "Service role can manage circle streaks"
    ON circle_streak_tracking FOR ALL
    USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp for engagement_streaks
CREATE OR REPLACE FUNCTION update_engagement_streaks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engagement_streaks_updated_at ON engagement_streaks;
CREATE TRIGGER engagement_streaks_updated_at
    BEFORE UPDATE ON engagement_streaks
    FOR EACH ROW
    EXECUTE FUNCTION update_engagement_streaks_updated_at();

-- Auto-update updated_at timestamp for metric_streaks
CREATE OR REPLACE FUNCTION update_metric_streaks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS metric_streaks_updated_at ON metric_streaks;
CREATE TRIGGER metric_streaks_updated_at
    BEFORE UPDATE ON metric_streaks
    FOR EACH ROW
    EXECUTE FUNCTION update_metric_streaks_updated_at();

-- Auto-update updated_at timestamp for circle_streak_tracking
CREATE OR REPLACE FUNCTION update_circle_streak_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS circle_streak_tracking_updated_at ON circle_streak_tracking;
CREATE TRIGGER circle_streak_tracking_updated_at
    BEFORE UPDATE ON circle_streak_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_circle_streak_tracking_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS (Simple utility functions only)
-- ============================================================================

-- Initialize engagement streak for new user
CREATE OR REPLACE FUNCTION initialize_engagement_streak(p_user_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO engagement_streaks (
        user_id,
        current_streak,
        longest_streak,
        streak_freezes_available,
        auto_freeze_reset_date
    ) VALUES (
        p_user_id,
        0,
        0,
        1,
        CURRENT_DATE + INTERVAL '7 days'
    )
    ON CONFLICT (user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Initialize metric streak for user
CREATE OR REPLACE FUNCTION initialize_metric_streak(
    p_user_id UUID,
    p_metric_type TEXT,
    p_grace_days INTEGER DEFAULT 1
)
RETURNS void AS $$
BEGIN
    INSERT INTO metric_streaks (
        user_id,
        metric_type,
        current_streak,
        longest_streak,
        grace_days_available
    ) VALUES (
        p_user_id,
        p_metric_type,
        0,
        0,
        p_grace_days
    )
    ON CONFLICT (user_id, metric_type) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Initialize circle streak tracking for new circle
CREATE OR REPLACE FUNCTION initialize_circle_streak(p_circle_id UUID)
RETURNS void AS $$
DECLARE
    v_duration_days INTEGER;
    v_grace_days INTEGER;
BEGIN
    -- Calculate challenge duration to determine grace days
    SELECT
        EXTRACT(DAY FROM (end_date - start_date))::INTEGER
    INTO v_duration_days
    FROM challenges
    WHERE id = p_circle_id;

    -- Calculate grace days: 1 day per week of challenge
    v_grace_days := GREATEST(1, FLOOR(v_duration_days / 7.0)::INTEGER);

    INSERT INTO circle_streak_tracking (
        circle_id,
        team_collective_streak,
        longest_team_streak,
        grace_days_available
    ) VALUES (
        p_circle_id,
        0,
        0,
        v_grace_days
    )
    ON CONFLICT (circle_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE engagement_streaks IS 'Tracks user engagement streaks across all activities (Tier 1)';
COMMENT ON TABLE engagement_activities IS 'Individual engagement activities for streak calculation';
COMMENT ON TABLE metric_streaks IS 'Tracks streaks for specific metrics like weight, steps, mood (Tier 2)';
COMMENT ON TABLE circle_streak_tracking IS 'Tracks team collective streaks for circles (Tier 3)';

COMMENT ON COLUMN engagement_streaks.streak_freezes_available IS 'Number of grace days available (max 5)';
COMMENT ON COLUMN engagement_streaks.streak_freezes_used_this_week IS 'Auto-resets weekly';
COMMENT ON COLUMN engagement_streaks.paused IS 'True if streak is paused for life events (max 90 days)';

COMMENT ON COLUMN metric_streaks.grace_days_available IS 'Varies by metric: weight=1, steps=1, mood=2, measurements=0, photos=0';

-- ============================================================================
-- INITIAL DATA SEED
-- ============================================================================

-- Initialize engagement streaks for existing users
INSERT INTO engagement_streaks (user_id, current_streak, longest_streak, streak_freezes_available, auto_freeze_reset_date)
SELECT
    id,
    0,
    0,
    1,
    CURRENT_DATE + INTERVAL '7 days'
FROM profiles
ON CONFLICT (user_id) DO NOTHING;

-- Initialize circle streak tracking for existing circles
INSERT INTO circle_streak_tracking (circle_id, team_collective_streak, longest_team_streak, grace_days_available)
SELECT
    id,
    0,
    0,
    GREATEST(1, FLOOR(EXTRACT(DAY FROM (end_date - start_date)) / 7.0)::INTEGER)
FROM challenges
ON CONFLICT (circle_id) DO NOTHING;
