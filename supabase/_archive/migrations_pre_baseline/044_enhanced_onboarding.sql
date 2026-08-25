-- ============================================================================
-- Enhanced Onboarding System Migration
-- Created: 2026-04-02
-- Description: Add fitness assessment fields and onboarding_responses table
-- ============================================================================

-- ============================================================================
-- 1. Add new columns to profiles table
-- Note: fitness_level and time_commitment already exist from migration 032
-- We need to update the CHECK constraints and add new columns
-- ============================================================================

-- Drop existing CHECK constraints to update allowed values
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_fitness_level_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_fitness_level_check
  CHECK (fitness_level IN ('beginner', 'intermediate', 'advanced', 'expert', 'athlete'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_time_commitment_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_time_commitment_check
  CHECK (time_commitment IN ('15-30', '30-60', '60+', 'flexible', 'light', 'moderate', 'intense', 'extreme'));

-- Add new columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_workout_types TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS has_completed_assessment BOOLEAN DEFAULT false;

-- ============================================================================
-- 2. Create onboarding_responses table
-- ============================================================================

CREATE TABLE IF NOT EXISTS onboarding_responses (
  id UUID DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  response_value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, question_key)
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_responses_user
  ON onboarding_responses(user_id);

-- ============================================================================
-- 3. RLS policies for onboarding_responses
-- ============================================================================

ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own onboarding responses"
  ON onboarding_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding responses"
  ON onboarding_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding responses"
  ON onboarding_responses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own onboarding responses"
  ON onboarding_responses FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Migration complete
-- ============================================================================
