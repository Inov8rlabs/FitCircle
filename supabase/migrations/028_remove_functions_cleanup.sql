-- ============================================================================
-- Cleanup Migration: Remove Functions and Triggers
--
-- This migration removes the trigger function that was accidentally created
-- in migration 027 before it was fixed. Per project architecture guidelines,
-- ALL business logic must be in TypeScript, not database functions.
-- ============================================================================

-- Drop the trigger first (triggers depend on functions)
DROP TRIGGER IF EXISTS weekly_goals_updated_at ON weekly_goals;

-- Drop the function
DROP FUNCTION IF EXISTS update_weekly_goals_timestamp();

-- ============================================================================
-- Verification
-- ============================================================================

-- After running this migration, verify no functions remain:
-- Run this query to check:
-- SELECT proname FROM pg_proc WHERE proname LIKE '%weekly_goals%';
-- Should return 0 rows.

COMMENT ON TABLE weekly_goals IS 'Phase 1 Engagement: Weekly milestone goals (updated_at managed by service layer)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
