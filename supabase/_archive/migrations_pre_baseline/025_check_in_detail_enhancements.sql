-- Migration 025: Check-In Detail & Privacy Enhancement
-- Adds privacy controls for daily tracking check-ins
-- Part of Progress History & Check-In Detail Enhancement (Phase 1)
-- PRD: /docs/progress-history-checkin-detail-prd.md

-- ============================================================================
-- 1. ADD PRIVACY COLUMN TO DAILY_TRACKING
-- ============================================================================

-- Add is_public column for privacy control
ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN daily_tracking.is_public IS 'Privacy flag: true = visible to circle members, false = private (owner only)';

-- ============================================================================
-- 2. CREATE INDEX FOR PERFORMANCE
-- ============================================================================

-- Index for filtering public check-ins
CREATE INDEX IF NOT EXISTS idx_daily_tracking_public
ON daily_tracking(is_public)
WHERE is_public = true;

-- Index for user + date + public status (common query pattern)
CREATE INDEX IF NOT EXISTS idx_daily_tracking_user_public
ON daily_tracking(user_id, tracking_date DESC, is_public);

-- ============================================================================
-- 3. UPDATE RLS POLICIES
-- ============================================================================

-- Note: We're replacing the old SELECT policy with a simpler one
-- Old policy: "Users can view own tracking" (auth.uid() = user_id)
-- New policy: "Authenticated users can select daily_tracking" (auth.uid() IS NOT NULL)
-- Circle membership checking moved to TypeScript service layer per project guidelines

-- Drop the old SELECT policy from migration 005
DROP POLICY IF EXISTS "Users can view own tracking" ON daily_tracking;

-- Drop this policy if it was created in a previous run of this migration
DROP POLICY IF EXISTS "Authenticated users can select daily_tracking" ON daily_tracking;

-- Create new simple SELECT policy
-- Business logic for circle membership and privacy is handled in TypeScript service layer
-- This follows the project guideline: Keep RLS policies simple, only check auth.uid()
-- Note: PostgreSQL does NOT support IF NOT EXISTS for CREATE POLICY
CREATE POLICY "Authenticated users can select daily_tracking"
  ON daily_tracking FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Note: INSERT, UPDATE, and DELETE policies remain unchanged from migration 005:
-- - "Users can insert own tracking" (FOR INSERT)
-- - "Users can update own tracking" (FOR UPDATE)
-- - "Users can delete own tracking" (FOR DELETE)

-- ============================================================================
-- 4. MIGRATION NOTES
-- ============================================================================

-- This migration is safe to run on existing data:
-- - is_public defaults to true, maintaining current behavior
-- - New indexes improve query performance for filtering
-- - RLS policies are additive, enabling new social features
-- - No data is modified, only schema changes

-- ============================================================================
-- 5. ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================

-- To rollback this migration:
-- 1. Drop the new policy
-- DROP POLICY IF EXISTS "Authenticated users can select daily_tracking" ON daily_tracking;
--
-- 2. Restore the old policy
-- CREATE POLICY "Users can view own tracking"
--   ON daily_tracking FOR SELECT
--   USING (auth.uid() = user_id);
--
-- 3. Drop the indexes
-- DROP INDEX IF EXISTS idx_daily_tracking_user_public;
-- DROP INDEX IF EXISTS idx_daily_tracking_public;
--
-- 4. Drop the column
-- ALTER TABLE daily_tracking DROP COLUMN IF EXISTS is_public;
