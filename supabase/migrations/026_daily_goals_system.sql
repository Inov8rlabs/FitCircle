-- Daily Goals System Migration
-- Implements the Daily Progress Meter feature
-- Spec: /docs/DAILY-PROGRESS-METER-SPEC.md

-- Create daily_goals table
CREATE TABLE IF NOT EXISTS daily_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,

    -- Goal definition
    goal_type TEXT NOT NULL CHECK (goal_type IN ('steps', 'weight_log', 'workout', 'mood', 'energy', 'custom')),
    target_value DECIMAL(10,2),
    unit TEXT,

    -- Scheduling
    start_date DATE NOT NULL,
    end_date DATE,
    frequency TEXT CHECK (frequency IN ('daily', 'weekdays', 'weekends', 'custom')) DEFAULT 'daily',
    custom_schedule JSONB,

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false,

    -- Auto-adjustment settings
    auto_adjust_enabled BOOLEAN DEFAULT false,
    baseline_value DECIMAL(10,2),
    adjustment_algorithm TEXT,
    last_adjusted_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, challenge_id, goal_type)
);

-- Create goal_completion_history table
CREATE TABLE IF NOT EXISTS goal_completion_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    daily_goal_id UUID REFERENCES daily_goals(id) ON DELETE CASCADE,
    completion_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Completion data
    target_value DECIMAL(10,2),
    actual_value DECIMAL(10,2),
    completion_percentage DECIMAL(5,2),
    is_completed BOOLEAN GENERATED ALWAYS AS (completion_percentage >= 100) STORED,

    -- Timing
    completed_at TIMESTAMPTZ,
    logged_at TIMESTAMPTZ DEFAULT NOW(),

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, daily_goal_id, completion_date)
);

-- Add goal tracking columns to daily_tracking table
ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS daily_goal_steps INTEGER,
ADD COLUMN IF NOT EXISTS daily_goal_weight_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS goal_completion_status JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_goals_user ON daily_goals(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_daily_goals_challenge ON daily_goals(challenge_id);
CREATE INDEX IF NOT EXISTS idx_daily_goals_primary ON daily_goals(user_id, is_primary) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_daily_goals_active_dates ON daily_goals(user_id, start_date, end_date) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_goal_completion_user_date ON goal_completion_history(user_id, completion_date DESC);
CREATE INDEX IF NOT EXISTS idx_goal_completion_streak ON goal_completion_history(user_id, is_completed, completion_date DESC) WHERE is_completed = true;
CREATE INDEX IF NOT EXISTS idx_goal_completion_goal ON goal_completion_history(daily_goal_id, completion_date DESC);

-- Enable RLS on new tables
ALTER TABLE daily_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_completion_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_goals
CREATE POLICY "Users can view own daily goals"
    ON daily_goals FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily goals"
    ON daily_goals FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily goals"
    ON daily_goals FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily goals"
    ON daily_goals FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for goal_completion_history
CREATE POLICY "Users can view own goal completion history"
    ON goal_completion_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goal completion history"
    ON goal_completion_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goal completion history"
    ON goal_completion_history FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Add update trigger for daily_goals
CREATE TRIGGER update_daily_goals_updated_at
    BEFORE UPDATE ON daily_goals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Comment on tables
COMMENT ON TABLE daily_goals IS 'User daily goal configurations, often linked to FitCircle challenges';
COMMENT ON TABLE goal_completion_history IS 'Historical record of daily goal completion for streak calculation and analytics';
COMMENT ON COLUMN daily_tracking.goal_completion_status IS 'JSONB tracking which goals were completed: {steps_goal_met: bool, weight_logged: bool, overall_completion: float}';
