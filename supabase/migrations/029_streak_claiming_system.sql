-- ============================================================================
-- Streak Claiming System Migration
-- Implements explicit and retroactive streak claiming feature
-- ============================================================================

-- ============================================================================
-- 1. STREAK CLAIMS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS streak_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    claim_date DATE NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claim_method VARCHAR(50) NOT NULL CHECK (claim_method IN ('explicit', 'manual_entry', 'retroactive')),
    timezone VARCHAR(100) NOT NULL,
    health_data_synced BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}', -- Additional context like which health data was present
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one claim per user per date
    CONSTRAINT unique_streak_claim UNIQUE (user_id, claim_date)
);

CREATE INDEX idx_streak_claims_user_date ON streak_claims(user_id, claim_date DESC);
CREATE INDEX idx_streak_claims_claimed_at ON streak_claims(claimed_at);
CREATE INDEX idx_streak_claims_method ON streak_claims(claim_method);

COMMENT ON TABLE streak_claims IS 'Tracks explicit and implicit streak claims by users';
COMMENT ON COLUMN streak_claims.claim_method IS 'How the streak was claimed: explicit (button press), manual_entry (via data submission), retroactive (past 7 days)';
COMMENT ON COLUMN streak_claims.timezone IS 'User timezone at time of claim for grace period handling';
COMMENT ON COLUMN streak_claims.health_data_synced IS 'Whether health data existed when claim was made';

-- ============================================================================
-- 2. STREAK SHIELDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS streak_shields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    shield_type VARCHAR(50) NOT NULL CHECK (shield_type IN ('freeze', 'milestone_shield', 'purchased')),
    available_count INTEGER NOT NULL DEFAULT 0 CHECK (available_count >= 0),
    last_reset_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}', -- Purchase history, milestone details, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One row per user per shield type
    CONSTRAINT unique_user_shield_type UNIQUE (user_id, shield_type)
);

CREATE INDEX idx_streak_shields_user ON streak_shields(user_id);
CREATE INDEX idx_streak_shields_type ON streak_shields(shield_type);

COMMENT ON TABLE streak_shields IS 'Tracks available streak protection shields by type';
COMMENT ON COLUMN streak_shields.shield_type IS 'freeze (weekly auto-reset), milestone_shield (earned at milestones), purchased (one-time buy)';
COMMENT ON COLUMN streak_shields.available_count IS 'Number of shields available to use';
COMMENT ON COLUMN streak_shields.last_reset_at IS 'Last time weekly freeze was reset (Mondays)';

-- ============================================================================
-- 3. STREAK RECOVERIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS streak_recoveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    broken_date DATE NOT NULL,
    recovery_type VARCHAR(50) NOT NULL CHECK (recovery_type IN ('weekend_warrior', 'shield_auto', 'purchased')),
    recovery_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (recovery_status IN ('pending', 'completed', 'failed', 'expired')),
    actions_required INTEGER CHECK (actions_required > 0),
    actions_completed INTEGER DEFAULT 0 CHECK (actions_completed >= 0),
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}', -- Action details, payment info, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One recovery attempt per user per broken date
    CONSTRAINT unique_user_recovery UNIQUE (user_id, broken_date)
);

CREATE INDEX idx_streak_recoveries_user_status ON streak_recoveries(user_id, recovery_status);
CREATE INDEX idx_streak_recoveries_expires ON streak_recoveries(expires_at) WHERE recovery_status = 'pending';
CREATE INDEX idx_streak_recoveries_date ON streak_recoveries(broken_date);

COMMENT ON TABLE streak_recoveries IS 'Tracks streak recovery attempts (Weekend Warrior Pass, purchased resurrection)';
COMMENT ON COLUMN streak_recoveries.recovery_type IS 'weekend_warrior (2x actions next day), shield_auto (milestone shield), purchased ($2.99 resurrection)';
COMMENT ON COLUMN streak_recoveries.recovery_status IS 'pending (in progress), completed (success), failed (did not complete), expired (time ran out)';
COMMENT ON COLUMN streak_recoveries.actions_required IS 'Number of actions needed to recover (e.g., 2 for weekend warrior)';

-- ============================================================================
-- 4. EXTEND ENGAGEMENT_STREAKS TABLE
-- ============================================================================

-- Add claiming-specific columns to existing engagement_streaks table
ALTER TABLE engagement_streaks
ADD COLUMN IF NOT EXISTS last_claim_date DATE,
ADD COLUMN IF NOT EXISTS total_claims INTEGER DEFAULT 0 CHECK (total_claims >= 0),
ADD COLUMN IF NOT EXISTS shields_available INTEGER DEFAULT 1 CHECK (shields_available >= 0 AND shields_available <= 5),
ADD COLUMN IF NOT EXISTS shields_used INTEGER DEFAULT 0 CHECK (shields_used >= 0),
ADD COLUMN IF NOT EXISTS last_shield_reset TIMESTAMPTZ;

-- Add index for claim tracking
CREATE INDEX IF NOT EXISTS idx_engagement_streaks_last_claim ON engagement_streaks(user_id, last_claim_date);

COMMENT ON COLUMN engagement_streaks.last_claim_date IS 'Last date user claimed a streak (explicit or implicit)';
COMMENT ON COLUMN engagement_streaks.total_claims IS 'Total number of streaks claimed by user';
COMMENT ON COLUMN engagement_streaks.shields_available IS 'Legacy field - migrating to streak_shields table';
COMMENT ON COLUMN engagement_streaks.shields_used IS 'Total shields used throughout streak history';
COMMENT ON COLUMN engagement_streaks.last_shield_reset IS 'Last time shields were reset (weekly)';

-- ============================================================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE streak_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_shields ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_recoveries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. RLS POLICIES - STREAK CLAIMS
-- ============================================================================

CREATE POLICY "Users can view own streak claims"
    ON streak_claims FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streak claims"
    ON streak_claims FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streak claims"
    ON streak_claims FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 7. RLS POLICIES - STREAK SHIELDS
-- ============================================================================

CREATE POLICY "Users can view own streak shields"
    ON streak_shields FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streak shields"
    ON streak_shields FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streak shields"
    ON streak_shields FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 8. RLS POLICIES - STREAK RECOVERIES
-- ============================================================================

CREATE POLICY "Users can view own streak recoveries"
    ON streak_recoveries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streak recoveries"
    ON streak_recoveries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streak recoveries"
    ON streak_recoveries FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 9. TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Trigger for streak_shields updated_at
CREATE OR REPLACE FUNCTION update_streak_shields_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS streak_shields_updated_at ON streak_shields;
CREATE TRIGGER streak_shields_updated_at
    BEFORE UPDATE ON streak_shields
    FOR EACH ROW
    EXECUTE FUNCTION update_streak_shields_timestamp();

-- Trigger for streak_recoveries updated_at
CREATE OR REPLACE FUNCTION update_streak_recoveries_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS streak_recoveries_updated_at ON streak_recoveries;
CREATE TRIGGER streak_recoveries_updated_at
    BEFORE UPDATE ON streak_recoveries
    FOR EACH ROW
    EXECUTE FUNCTION update_streak_recoveries_timestamp();

-- ============================================================================
-- 10. INITIALIZE STREAK SHIELDS FOR EXISTING USERS
-- ============================================================================

-- Initialize freeze shields for all existing users (1 free freeze)
INSERT INTO streak_shields (user_id, shield_type, available_count, last_reset_at)
SELECT
    id,
    'freeze',
    1,
    NOW()
FROM profiles
ON CONFLICT (user_id, shield_type) DO NOTHING;

-- Initialize milestone shields for existing users (0 to start)
INSERT INTO streak_shields (user_id, shield_type, available_count)
SELECT
    id,
    'milestone_shield',
    0
FROM profiles
ON CONFLICT (user_id, shield_type) DO NOTHING;

-- Initialize purchased shields for existing users (0 to start)
INSERT INTO streak_shields (user_id, shield_type, available_count)
SELECT
    id,
    'purchased',
    0
FROM profiles
ON CONFLICT (user_id, shield_type) DO NOTHING;

-- ============================================================================
-- 11. HELPER FUNCTIONS
-- ============================================================================

-- Initialize shields for new user
CREATE OR REPLACE FUNCTION initialize_streak_shields(p_user_id UUID)
RETURNS void AS $$
BEGIN
    -- Insert freeze shield (1 free per week)
    INSERT INTO streak_shields (user_id, shield_type, available_count, last_reset_at)
    VALUES (p_user_id, 'freeze', 1, NOW())
    ON CONFLICT (user_id, shield_type) DO NOTHING;

    -- Insert milestone shields (earned through achievements)
    INSERT INTO streak_shields (user_id, shield_type, available_count)
    VALUES (p_user_id, 'milestone_shield', 0)
    ON CONFLICT (user_id, shield_type) DO NOTHING;

    -- Insert purchased shields
    INSERT INTO streak_shields (user_id, shield_type, available_count)
    VALUES (p_user_id, 'purchased', 0)
    ON CONFLICT (user_id, shield_type) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get user's total available shields
CREATE OR REPLACE FUNCTION get_total_shields(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_total INTEGER;
BEGIN
    SELECT COALESCE(SUM(available_count), 0)
    INTO v_total
    FROM streak_shields
    WHERE user_id = p_user_id;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Decrement shield count (used by service layer)
CREATE OR REPLACE FUNCTION decrement_shield_count(
    p_user_id UUID,
    p_shield_type VARCHAR
)
RETURNS void AS $$
BEGIN
    UPDATE streak_shields
    SET available_count = GREATEST(0, available_count - 1)
    WHERE user_id = p_user_id
      AND shield_type = p_shield_type
      AND available_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
