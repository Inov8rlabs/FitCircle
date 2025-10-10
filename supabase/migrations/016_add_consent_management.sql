-- GDPR/CCPA Consent Management
-- This migration adds tables for tracking user consent and privacy preferences

-- User Consent Audit Trail
-- Stores every consent decision for GDPR compliance (must retain 5+ years)
CREATE TABLE user_consent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

    -- Consent details
    consent_type TEXT NOT NULL CHECK (consent_type IN ('essential', 'analytics', 'marketing', 'functional', 'data_deletion')),
    consent_given BOOLEAN NOT NULL,

    -- Audit trail - required for GDPR compliance
    consent_version TEXT NOT NULL, -- e.g., 'privacy-policy-v1.0'
    consent_text TEXT NOT NULL, -- Full text shown to user at time of consent
    consent_method TEXT NOT NULL CHECK (consent_method IN ('banner', 'settings', 'registration', 'api', 'gpc')),

    -- Technical metadata for audit
    ip_address INET,
    user_agent TEXT,
    gpc_signal BOOLEAN DEFAULT false, -- Global Privacy Control browser signal

    -- Timestamps
    consent_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ, -- When consent was withdrawn (NULL = still active)
    expires_at TIMESTAMPTZ, -- For consent renewal (12 months from grant)

    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_consent_user_type ON user_consent(user_id, consent_type, consent_timestamp DESC);
CREATE INDEX idx_consent_active ON user_consent(user_id, consent_type)
    WHERE withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
CREATE INDEX idx_consent_timestamp ON user_consent(consent_timestamp DESC);

-- RLS Policies
ALTER TABLE user_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consent history"
    ON user_consent FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own consent"
    ON user_consent FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Note: No UPDATE or DELETE policies - consent records are immutable for audit trail
-- Withdrawal is marked by updating withdrawn_at, not deleting

-- Privacy Settings (Current User Preferences)
-- Stores current state of user's privacy choices
CREATE TABLE privacy_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Cookie preferences
    analytics_enabled BOOLEAN DEFAULT false,
    marketing_enabled BOOLEAN DEFAULT false,
    functional_enabled BOOLEAN DEFAULT true,

    -- Data processing preferences
    data_retention_preference TEXT DEFAULT 'standard' CHECK (data_retention_preference IN ('minimal', 'standard', 'extended')),

    -- CCPA specific (California residents)
    do_not_sell BOOLEAN DEFAULT false,

    -- Global Privacy Control (GPC)
    gpc_honored BOOLEAN DEFAULT false,
    gpc_detected_at TIMESTAMPTZ,

    -- Timestamps
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_privacy_settings_user ON privacy_settings(user_id);

-- RLS Policies
ALTER TABLE privacy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own privacy settings"
    ON privacy_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own privacy settings"
    ON privacy_settings FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_privacy_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_privacy_settings_timestamp
    BEFORE UPDATE ON privacy_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_privacy_settings_updated_at();

-- Comments for documentation
COMMENT ON TABLE user_consent IS 'GDPR-compliant audit trail of all consent decisions. Records must be retained for 5+ years.';
COMMENT ON TABLE privacy_settings IS 'Current privacy preferences for each user. Used to control analytics, marketing, and data processing.';
COMMENT ON COLUMN user_consent.consent_version IS 'Version of privacy policy at time of consent. Used to trigger re-consent when policy changes.';
COMMENT ON COLUMN user_consent.gpc_signal IS 'Whether Global Privacy Control browser signal was detected and honored.';
COMMENT ON COLUMN privacy_settings.do_not_sell IS 'CCPA: User has opted out of data selling/sharing (California residents).';
