-- Migration 019: Cleanup duplicate columns in challenge_participants
-- This migration removes old, unused columns and keeps only the unified goal columns

-- Step 1: Migrate any existing data from old columns to new columns (if needed)
-- Update goal_start_value from starting_value where goal_start_value is null
UPDATE challenge_participants
SET goal_start_value = starting_value
WHERE goal_start_value IS NULL AND starting_value IS NOT NULL;

-- Update goal_target_value from goal_value where goal_target_value is null
UPDATE challenge_participants
SET goal_target_value = goal_value
WHERE goal_target_value IS NULL AND goal_value IS NOT NULL;

-- Step 2: Drop the old duplicate columns
-- These are no longer needed as we use the unified goal_* columns

-- Drop old weight-specific columns (we use goal_type='weight_loss' + goal_start_value/goal_target_value instead)
ALTER TABLE challenge_participants
DROP COLUMN IF EXISTS starting_weight_kg CASCADE;

ALTER TABLE challenge_participants
DROP COLUMN IF EXISTS current_weight_kg CASCADE;

ALTER TABLE challenge_participants
DROP COLUMN IF EXISTS goal_weight_kg CASCADE;

-- Drop old generic value columns (replaced by goal_start_value and goal_target_value)
ALTER TABLE challenge_participants
DROP COLUMN IF EXISTS starting_value CASCADE;

ALTER TABLE challenge_participants
DROP COLUMN IF EXISTS goal_value CASCADE;

-- Note: We keep current_value as it's still used for progress tracking

-- Step 3: Add comments to clarify the schema
COMMENT ON COLUMN challenge_participants.goal_type IS 'Type of goal: weight_loss, step_count, workout_frequency, or custom';
COMMENT ON COLUMN challenge_participants.goal_start_value IS 'Starting value for any goal type (e.g., starting weight in lbs/kg, starting step count average)';
COMMENT ON COLUMN challenge_participants.goal_target_value IS 'Target value for any goal type (e.g., goal weight, target daily steps)';
COMMENT ON COLUMN challenge_participants.goal_unit IS 'Unit of measurement (e.g., lbs, kg, steps, sessions, custom unit)';
COMMENT ON COLUMN challenge_participants.current_value IS 'Current value updated with each check-in (same unit as goal_start_value/goal_target_value)';
COMMENT ON COLUMN challenge_participants.progress_percentage IS 'Calculated progress toward goal (0-100%)';

-- Step 4: Fix any inconsistent data before adding constraint
-- Set goal_type to NULL for rows without goal_target_value
UPDATE challenge_participants
SET goal_type = NULL
WHERE goal_type IS NOT NULL AND goal_target_value IS NULL;

-- Set goal_target_value to NULL for rows without goal_type
UPDATE challenge_participants
SET goal_target_value = NULL
WHERE goal_target_value IS NOT NULL AND goal_type IS NULL;

-- Step 5: Add a constraint to ensure goal fields are consistent
-- If a participant has a goal_type, they should have target_value
ALTER TABLE challenge_participants
ADD CONSTRAINT goal_consistency_check
CHECK (
  (goal_type IS NULL AND goal_target_value IS NULL) OR
  (goal_type IS NOT NULL AND goal_target_value IS NOT NULL)
);

COMMENT ON CONSTRAINT goal_consistency_check ON challenge_participants IS 'Ensures that if a goal_type is set, a goal_target_value must also be set';
