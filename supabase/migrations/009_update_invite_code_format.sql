-- Migration 009: Add and update invite_code column for FIT-XXXXXX format
-- This migration ensures invite_code exists and supports the FIT-XXXXXX format

-- ============================================================================
-- 1. ADD INVITE_CODE COLUMN TO CHALLENGES (if not exists)
-- ============================================================================

-- Add the invite_code column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'challenges'
        AND column_name = 'invite_code'
    ) THEN
        ALTER TABLE challenges
        ADD COLUMN invite_code VARCHAR(10) UNIQUE;

        -- Create index for fast lookups
        CREATE INDEX idx_challenges_invite_code ON challenges(invite_code);
    ELSE
        -- Column exists, just update the type to support 10 characters
        ALTER TABLE challenges
        ALTER COLUMN invite_code TYPE VARCHAR(10);
    END IF;
END $$;

-- ============================================================================
-- 2. ADD CHECK CONSTRAINT FOR FORMAT
-- ============================================================================

-- Drop existing format constraint if it exists
ALTER TABLE challenges
DROP CONSTRAINT IF EXISTS invite_code_format;

-- Add constraint to ensure proper FIT-XXXXXX format
-- Supports both FIT-ABC123 (10 chars) and FITABC123 (9 chars) for backward compatibility
ALTER TABLE challenges
ADD CONSTRAINT invite_code_format
CHECK (invite_code ~ '^FIT-?[A-Z0-9]{6}$');

-- ============================================================================
-- 3. UPDATE CIRCLE_INVITES TABLE (if exists)
-- ============================================================================

-- Only update if the table exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'circle_invites'
    ) THEN
        -- Update column type
        ALTER TABLE circle_invites
        ALTER COLUMN invite_code TYPE VARCHAR(10);

        -- Drop and recreate the constraint
        ALTER TABLE circle_invites
        DROP CONSTRAINT IF EXISTS fk_invite_code_matches_circle;

        ALTER TABLE circle_invites
        ADD CONSTRAINT fk_invite_code_matches_circle
        CHECK (invite_code = (SELECT invite_code FROM challenges WHERE id = circle_id));
    END IF;
END $$;

-- ============================================================================
-- 4. ADD DOCUMENTATION COMMENTS
-- ============================================================================

COMMENT ON COLUMN challenges.invite_code IS 'Unique invite code in format FIT-XXXXXX (e.g., FIT-A2B9C7) or FITXXXXXX for backward compatibility';

-- Only add comment if table exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'circle_invites'
    ) THEN
        EXECUTE 'COMMENT ON COLUMN circle_invites.invite_code IS ''Unique invite code matching the challenge format FIT-XXXXXX''';
    END IF;
END $$;
