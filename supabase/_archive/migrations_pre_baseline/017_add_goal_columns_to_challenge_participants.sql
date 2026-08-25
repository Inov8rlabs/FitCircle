-- Migration 017: Add goal-related columns to challenge_participants
-- This migration adds columns for goal tracking that are used by the circle service

-- Add goal type column
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS goal_type TEXT CHECK (goal_type IN ('weight_loss', 'step_count', 'workout_frequency', 'custom'));

-- Add goal value columns
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS goal_start_value DECIMAL(10,2);

ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS goal_target_value DECIMAL(10,2);

-- Add goal metadata columns
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS goal_unit TEXT;

ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS goal_description TEXT;

-- Add goal locking timestamp (goals can't be changed after this)
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS goal_locked_at TIMESTAMPTZ;

-- Add longest streak tracking
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;

-- Add invited_by tracking
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES profiles(id);

-- Add total high fives received
ALTER TABLE challenge_participants
ADD COLUMN IF NOT EXISTS total_high_fives_received INTEGER DEFAULT 0;

-- Add comments to explain these columns
COMMENT ON COLUMN challenge_participants.goal_type IS 'Type of goal: weight_loss, step_count, workout_frequency, or custom';
COMMENT ON COLUMN challenge_participants.goal_start_value IS 'Starting value for the goal (e.g., starting weight)';
COMMENT ON COLUMN challenge_participants.goal_target_value IS 'Target value for the goal (e.g., goal weight)';
COMMENT ON COLUMN challenge_participants.goal_unit IS 'Unit of measurement (e.g., lbs, kg, steps, sessions)';
COMMENT ON COLUMN challenge_participants.goal_description IS 'Custom description for custom goal types';
COMMENT ON COLUMN challenge_participants.goal_locked_at IS 'When the goal was locked (typically when challenge starts)';
COMMENT ON COLUMN challenge_participants.longest_streak IS 'Longest check-in streak achieved';
COMMENT ON COLUMN challenge_participants.invited_by IS 'User who invited this participant';
COMMENT ON COLUMN challenge_participants.total_high_fives_received IS 'Total high-fives received from other participants';
