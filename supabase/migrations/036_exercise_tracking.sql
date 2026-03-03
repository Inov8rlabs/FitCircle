-- Migration 036: Exercise Tracking Feature
-- Adds exercise_logs table for HealthKit auto-sync and manual workout logging

-- ============================================================
-- 1. Create exercise_logs table
-- ============================================================

CREATE TABLE exercise_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Tier 1: Core fields (always captured)
    exercise_type VARCHAR(50) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN (
        'cardio', 'strength', 'flexibility', 'sports', 'outdoor', 'other'
    )),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
    calories_burned DECIMAL(8,2),
    calories_estimated BOOLEAN NOT NULL DEFAULT false,
    exercise_date DATE NOT NULL DEFAULT CURRENT_DATE,
    started_at TIMESTAMPTZ,
    source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'healthkit')),

    -- Tier 2: Enrichment fields (all optional)
    distance_meters DECIMAL(10,2),
    avg_heart_rate INTEGER CHECK (avg_heart_rate IS NULL OR (avg_heart_rate > 0 AND avg_heart_rate <= 300)),
    effort_level INTEGER CHECK (effort_level IS NULL OR (effort_level >= 1 AND effort_level <= 10)),
    location_type VARCHAR(20) CHECK (location_type IS NULL OR location_type IN (
        'home', 'gym', 'outdoor', 'studio'
    )),
    workout_companion VARCHAR(20) CHECK (workout_companion IS NULL OR workout_companion IN (
        'solo', 'group', 'trainer', 'virtual_class'
    )),
    body_areas TEXT[],
    is_indoor BOOLEAN,
    notes TEXT,

    -- HealthKit metadata
    healthkit_workout_id VARCHAR(100),
    source_device_name VARCHAR(100),

    -- Visibility & status
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_deleted BOOLEAN NOT NULL DEFAULT false,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate HealthKit imports per user
    CONSTRAINT unique_healthkit_workout UNIQUE (user_id, healthkit_workout_id)
);

-- ============================================================
-- 2. Indexes for common queries
-- ============================================================

-- Primary query: user's exercises by date (most common)
CREATE INDEX idx_exercise_logs_user_date
    ON exercise_logs(user_id, exercise_date DESC)
    WHERE is_deleted = false;

-- Filter by exercise type
CREATE INDEX idx_exercise_logs_user_type
    ON exercise_logs(user_id, exercise_type)
    WHERE is_deleted = false;

-- Filter by category
CREATE INDEX idx_exercise_logs_category
    ON exercise_logs(user_id, category, exercise_date DESC)
    WHERE is_deleted = false;

-- HealthKit dedup lookup
CREATE INDEX idx_exercise_logs_healthkit
    ON exercise_logs(healthkit_workout_id)
    WHERE healthkit_workout_id IS NOT NULL;

-- Circle feed: public exercises by date
CREATE INDEX idx_exercise_logs_public
    ON exercise_logs(user_id, is_public, exercise_date DESC)
    WHERE is_deleted = false;

-- ============================================================
-- 3. Row Level Security
-- ============================================================

ALTER TABLE exercise_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own exercises"
    ON exercise_logs FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exercises"
    ON exercise_logs FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exercises"
    ON exercise_logs FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exercises"
    ON exercise_logs FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Service role bypass for backend operations
CREATE POLICY "Service role full access on exercise_logs"
    ON exercise_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 4. Auto-update updated_at trigger
-- ============================================================

CREATE TRIGGER update_exercise_logs_updated_at
    BEFORE UPDATE ON exercise_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 5. Update engagement_activities activity_type constraint
-- ============================================================

ALTER TABLE engagement_activities
    DROP CONSTRAINT IF EXISTS engagement_activities_activity_type_check;

ALTER TABLE engagement_activities
    ADD CONSTRAINT engagement_activities_activity_type_check
    CHECK (activity_type IN (
        'weight_log',
        'steps_log',
        'mood_log',
        'circle_checkin',
        'social_interaction',
        'streak_checkin',
        'freeze_used',
        'freeze_earned',
        'milestone_achieved',
        'exercise_log'
    ));

-- ============================================================
-- 6. Grant permissions
-- ============================================================

GRANT ALL ON exercise_logs TO authenticated;
GRANT ALL ON exercise_logs TO service_role;

-- ============================================================
-- 7. Comments
-- ============================================================

COMMENT ON TABLE exercise_logs IS 'User exercise/workout logs from HealthKit auto-sync and manual entry';
COMMENT ON COLUMN exercise_logs.exercise_type IS 'Exercise type identifier matching HKWorkoutActivityType (e.g., running, yoga, strengthTraining)';
COMMENT ON COLUMN exercise_logs.category IS 'Exercise category: cardio, strength, flexibility, sports, outdoor, other';
COMMENT ON COLUMN exercise_logs.calories_estimated IS 'true if calories were MET-estimated by the app, false if from HealthKit or user-entered';
COMMENT ON COLUMN exercise_logs.effort_level IS 'Rate of Perceived Exertion (RPE) on a 1-10 scale';
COMMENT ON COLUMN exercise_logs.body_areas IS 'Targeted body areas: chest, back, shoulders, arms, core, legs, glutes, fullBody';
COMMENT ON COLUMN exercise_logs.source IS 'Data source: manual (user logged in-app) or healthkit (auto-synced from Apple Health)';
COMMENT ON COLUMN exercise_logs.healthkit_workout_id IS 'HKWorkout UUID for deduplication of HealthKit imports';
COMMENT ON COLUMN exercise_logs.source_device_name IS 'Originating device/app name from HealthKit sourceRevision (e.g., Apple Watch, Peloton)';
COMMENT ON COLUMN exercise_logs.is_deleted IS 'Soft delete flag. Set when workout is deleted from HealthKit to preserve history.';
