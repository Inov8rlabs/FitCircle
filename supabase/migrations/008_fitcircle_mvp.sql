-- Migration 008: FitCircle MVP Implementation
-- This migration adds all necessary tables and modifications for the FitCircle feature
-- Privacy-first circle creation with invite system and progress tracking

-- ============================================================================
-- 1. MODIFY EXISTING CHALLENGES TABLE
-- ============================================================================

-- Add FitCircle-specific columns to challenges table
ALTER TABLE challenges
ADD COLUMN IF NOT EXISTS invite_code VARCHAR(9) UNIQUE,
ADD COLUMN IF NOT EXISTS privacy_mode BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_accept_invites BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS allow_late_join BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS late_join_deadline INTEGER DEFAULT 3; -- days after start

-- Create index for invite code lookup
CREATE INDEX IF NOT EXISTS idx_challenges_invite_code ON challenges(invite_code);

-- ============================================================================
-- 2. CREATE CIRCLE_INVITES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invite_code VARCHAR(9) NOT NULL,
    email TEXT, -- Optional for email invites
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES profiles(id),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',

    -- Add constraint to ensure invite code matches circle
    CONSTRAINT fk_invite_code_matches_circle CHECK (invite_code = (SELECT invite_code FROM challenges WHERE id = circle_id))
);

-- Indexes for performance
CREATE INDEX idx_circle_invites_circle_id ON circle_invites(circle_id);
CREATE INDEX idx_circle_invites_invite_code ON circle_invites(invite_code);
CREATE INDEX idx_circle_invites_email ON circle_invites(email) WHERE email IS NOT NULL;
CREATE INDEX idx_circle_invites_status ON circle_invites(status);

-- ============================================================================
-- 3. CREATE CIRCLE_MEMBERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES profiles(id),

    -- Goal data (private)
    goal_type TEXT CHECK (goal_type IN ('weight_loss', 'step_count', 'workout_frequency', 'custom')),
    goal_start_value DECIMAL(10,2),
    goal_target_value DECIMAL(10,2),
    goal_unit TEXT, -- e.g., 'lbs', 'kg', 'steps', 'sessions'
    goal_description TEXT, -- For custom goals
    current_value DECIMAL(10,2),

    -- Progress tracking (public within circle)
    progress_percentage DECIMAL(5,2) DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    total_check_ins INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_check_in_at TIMESTAMPTZ,

    -- Engagement metrics
    total_high_fives_sent INTEGER DEFAULT 0,
    total_high_fives_received INTEGER DEFAULT 0,

    -- Privacy settings
    privacy_settings JSONB DEFAULT '{"hide_from_leaderboard": false, "hide_streak": false}'::jsonb,

    -- Status
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    goal_locked_at TIMESTAMPTZ, -- Goal locked when circle starts
    is_active BOOLEAN DEFAULT true,
    left_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one membership per user per circle
    UNIQUE(circle_id, user_id)
);

-- Indexes for performance
CREATE INDEX idx_circle_members_circle_id ON circle_members(circle_id);
CREATE INDEX idx_circle_members_user_id ON circle_members(user_id);
CREATE INDEX idx_circle_members_progress ON circle_members(circle_id, progress_percentage DESC) WHERE is_active = true;
CREATE INDEX idx_circle_members_streak ON circle_members(circle_id, streak_days DESC) WHERE is_active = true;
CREATE INDEX idx_circle_members_check_ins ON circle_members(circle_id, total_check_ins DESC) WHERE is_active = true;
CREATE INDEX idx_circle_members_joined ON circle_members(circle_id, joined_at ASC);

-- ============================================================================
-- 4. CREATE CIRCLE_ENCOURAGEMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_encouragements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    to_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- NULL for circle-wide encouragements
    type TEXT NOT NULL CHECK (type IN ('high_five', 'message', 'cheer', 'milestone')),
    content TEXT CHECK (LENGTH(content) <= 200), -- Optional message content

    -- For milestone celebrations
    milestone_type TEXT CHECK (milestone_type IN ('progress_25', 'progress_50', 'progress_75', 'progress_100', 'streak_7', 'streak_14', 'streak_30')),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_circle_encouragements_circle_id ON circle_encouragements(circle_id);
CREATE INDEX idx_circle_encouragements_from_user ON circle_encouragements(from_user_id);
CREATE INDEX idx_circle_encouragements_to_user ON circle_encouragements(to_user_id) WHERE to_user_id IS NOT NULL;
CREATE INDEX idx_circle_encouragements_created ON circle_encouragements(circle_id, created_at DESC);
CREATE INDEX idx_circle_encouragements_type ON circle_encouragements(type);

-- ============================================================================
-- 5. CREATE CIRCLE_CHECK_INS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_check_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES circle_members(id) ON DELETE CASCADE,
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Check-in data
    check_in_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in_value DECIMAL(10,2) NOT NULL, -- The actual metric value (private)
    progress_percentage DECIMAL(5,2), -- Calculated at check-in time

    -- Optional wellness tracking
    mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
    energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
    note TEXT CHECK (LENGTH(note) <= 100),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one check-in per member per day
    UNIQUE(member_id, check_in_date)
);

-- Indexes for performance
CREATE INDEX idx_circle_check_ins_member_id ON circle_check_ins(member_id);
CREATE INDEX idx_circle_check_ins_circle_id ON circle_check_ins(circle_id);
CREATE INDEX idx_circle_check_ins_user_id ON circle_check_ins(user_id);
CREATE INDEX idx_circle_check_ins_date ON circle_check_ins(check_in_date DESC);
CREATE INDEX idx_circle_check_ins_circle_date ON circle_check_ins(circle_id, check_in_date DESC);

-- ============================================================================
-- 6. CREATE DAILY HIGH FIVE LIMITS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_high_five_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one record per user per circle per day
    UNIQUE(user_id, circle_id, date)
);

-- Index for quick lookup
CREATE INDEX idx_daily_high_five_limits_lookup ON daily_high_five_limits(user_id, circle_id, date);

-- ============================================================================
-- 7. ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE circle_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_encouragements ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_high_five_limits ENABLE ROW LEVEL SECURITY;

-- Circle Invites Policies
CREATE POLICY "Users can view invites for their circles"
    ON circle_invites FOR SELECT
    USING (
        auth.uid() = inviter_id
        OR auth.uid() IN (SELECT user_id FROM circle_members WHERE circle_id = circle_invites.circle_id)
        OR email = (SELECT email FROM profiles WHERE id = auth.uid())
    );

CREATE POLICY "Circle creators and members can create invites"
    ON circle_invites FOR INSERT
    WITH CHECK (
        auth.uid() IN (SELECT user_id FROM circle_members WHERE circle_id = circle_invites.circle_id)
        OR auth.uid() = (SELECT created_by FROM challenges WHERE id = circle_id)
    );

CREATE POLICY "Users can update their own invites"
    ON circle_invites FOR UPDATE
    USING (auth.uid() = inviter_id OR email = (SELECT email FROM profiles WHERE id = auth.uid()))
    WITH CHECK (auth.uid() = inviter_id OR email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- Circle Members Policies
CREATE POLICY "Users can view members of their circles"
    ON circle_members FOR SELECT
    USING (
        auth.uid() = user_id
        OR auth.uid() IN (SELECT user_id FROM circle_members cm WHERE cm.circle_id = circle_members.circle_id)
    );

CREATE POLICY "Users can join circles"
    ON circle_members FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own membership"
    ON circle_members FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave circles"
    ON circle_members FOR DELETE
    USING (auth.uid() = user_id);

-- Circle Encouragements Policies
CREATE POLICY "Users can view encouragements in their circles"
    ON circle_encouragements FOR SELECT
    USING (
        auth.uid() IN (SELECT user_id FROM circle_members WHERE circle_id = circle_encouragements.circle_id)
    );

CREATE POLICY "Circle members can send encouragements"
    ON circle_encouragements FOR INSERT
    WITH CHECK (
        auth.uid() = from_user_id
        AND auth.uid() IN (SELECT user_id FROM circle_members WHERE circle_id = circle_encouragements.circle_id)
    );

-- Circle Check-ins Policies
CREATE POLICY "Users can view their own check-ins"
    ON circle_check_ins FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Circle members can view progress percentages"
    ON circle_check_ins FOR SELECT
    USING (
        auth.uid() IN (SELECT user_id FROM circle_members WHERE circle_id = circle_check_ins.circle_id)
    );

CREATE POLICY "Users can create their own check-ins"
    ON circle_check_ins FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own check-ins"
    ON circle_check_ins FOR UPDATE
    USING (auth.uid() = user_id AND check_in_date = CURRENT_DATE)
    WITH CHECK (auth.uid() = user_id);

-- Daily High Five Limits Policies
CREATE POLICY "Users can view their own limits"
    ON daily_high_five_limits FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own limit records"
    ON daily_high_five_limits FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own limits"
    ON daily_high_five_limits FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 8. HELPER FUNCTIONS FOR PROGRESS CALCULATION
-- ============================================================================

-- Function to calculate progress percentage
CREATE OR REPLACE FUNCTION calculate_progress_percentage(
    p_goal_type TEXT,
    p_start_value DECIMAL,
    p_current_value DECIMAL,
    p_target_value DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
    progress DECIMAL;
BEGIN
    IF p_goal_type = 'weight_loss' THEN
        -- For decreasing metrics (weight loss)
        IF p_start_value = p_target_value THEN
            RETURN 100;
        END IF;
        progress := ((p_start_value - p_current_value) / (p_start_value - p_target_value)) * 100;
    ELSE
        -- For increasing metrics (steps, workouts, custom)
        IF p_target_value = 0 THEN
            RETURN 0;
        END IF;
        progress := (p_current_value / p_target_value) * 100;
    END IF;

    -- Cap at 0-100 range
    RETURN LEAST(100, GREATEST(0, progress));
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_circle_members_updated_at
    BEFORE UPDATE ON circle_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 10. INITIAL DATA AND CONSTRAINTS
-- ============================================================================

-- Add comment documentation
COMMENT ON TABLE circle_invites IS 'Tracks invitations sent to join FitCircles';
COMMENT ON TABLE circle_members IS 'Members of FitCircles with their goals and progress';
COMMENT ON TABLE circle_encouragements IS 'Social interactions within FitCircles';
COMMENT ON TABLE circle_check_ins IS 'Daily check-ins for FitCircle members';
COMMENT ON TABLE daily_high_five_limits IS 'Tracks daily limits for high-fives per user per circle';

COMMENT ON COLUMN circle_members.progress_percentage IS 'Public progress percentage shown in leaderboard';
COMMENT ON COLUMN circle_members.goal_start_value IS 'Private starting value for the goal';
COMMENT ON COLUMN circle_members.goal_target_value IS 'Private target value for the goal';
COMMENT ON COLUMN circle_members.current_value IS 'Private current value, updated with each check-in';

-- Grant permissions (if needed for service role)
GRANT ALL ON circle_invites TO service_role;
GRANT ALL ON circle_members TO service_role;
GRANT ALL ON circle_encouragements TO service_role;
GRANT ALL ON circle_check_ins TO service_role;
GRANT ALL ON daily_high_five_limits TO service_role;