-- =====================================================
-- Migration: Token Blacklist for Mobile Authentication
-- Description: Create table to track invalidated JWT tokens
-- Date: 2025-10-12
-- =====================================================

-- Create token_blacklist table
CREATE TABLE IF NOT EXISTS token_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    blacklisted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT CHECK (reason IN ('logout', 'security', 'account_deleted')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for efficient lookups
CREATE INDEX idx_token_blacklist_hash ON token_blacklist(token_hash);
CREATE INDEX idx_token_blacklist_user ON token_blacklist(user_id);
CREATE INDEX idx_token_blacklist_expires ON token_blacklist(expires_at);

-- Add composite index for cleanup queries
CREATE INDEX idx_token_blacklist_cleanup ON token_blacklist(expires_at, blacklisted_at);

-- Comment on table
COMMENT ON TABLE token_blacklist IS 'Stores invalidated JWT tokens to prevent reuse after logout or security events';
COMMENT ON COLUMN token_blacklist.token_hash IS 'SHA-256 hash of the JWT token';
COMMENT ON COLUMN token_blacklist.reason IS 'Reason for blacklisting: logout, security, or account_deleted';
COMMENT ON COLUMN token_blacklist.expires_at IS 'When the token would have naturally expired (for cleanup)';

-- RLS Policies (simple auth checks only)
ALTER TABLE token_blacklist ENABLE ROW LEVEL SECURITY;

-- Users can view their own blacklisted tokens (for debugging/audit)
CREATE POLICY "Users can view own blacklisted tokens"
    ON token_blacklist FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert (via API only, not direct user access)
-- No user-facing INSERT policy - only backend can blacklist tokens

-- Optional: Cleanup function to remove expired tokens (runs via API cron, not database cron)
-- This is a simple helper function, not business logic
CREATE OR REPLACE FUNCTION cleanup_expired_blacklist_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM token_blacklist
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_expired_blacklist_tokens IS 'Simple cleanup function to remove expired tokens. Call from API cron endpoint, not database cron.';
