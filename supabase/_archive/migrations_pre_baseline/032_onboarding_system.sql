-- ============================================================================
-- FitCircle Onboarding System Migration
-- Created: 2025-11-11
-- Description: Add onboarding progress tracking and persona detection
-- ============================================================================

-- Enable UUID extension (should already be enabled)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. Add onboarding columns to profiles table
-- ============================================================================

-- Add persona and fitness level columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS persona TEXT CHECK (persona IN ('casey', 'sarah', 'mike', 'fiona')),
  ADD COLUMN IF NOT EXISTS persona_secondary TEXT,
  ADD COLUMN IF NOT EXISTS fitness_level TEXT CHECK (fitness_level IN ('beginner', 'intermediate', 'advanced', 'athlete')),
  ADD COLUMN IF NOT EXISTS time_commitment TEXT CHECK (time_commitment IN ('15-30', '30-60', '60+', 'flexible')),
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER DEFAULT 0;

-- Create index for persona queries
CREATE INDEX IF NOT EXISTS idx_profiles_persona ON profiles(persona) WHERE persona IS NOT NULL;

-- ============================================================================
-- 2. Create onboarding_progress table
-- ============================================================================

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Progress tracking
  current_step INTEGER NOT NULL DEFAULT 0,
  completed_steps JSONB DEFAULT '[]'::jsonb,
  is_complete BOOLEAN DEFAULT FALSE,

  -- Questionnaire data
  questionnaire_answers JSONB DEFAULT '{}'::jsonb,
  persona_scores JSONB DEFAULT '{}'::jsonb,
  detected_persona TEXT,
  detected_persona_secondary TEXT,

  -- Goals data (temporary storage during onboarding)
  goals_data JSONB DEFAULT '{}'::jsonb,

  -- First check-in data
  first_checkin_data JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user_id ON onboarding_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_incomplete ON onboarding_progress(is_complete) WHERE is_complete = FALSE;

-- ============================================================================
-- 3. Create user_goals table (for long-term goal storage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Goal type and details
  goal_type TEXT NOT NULL CHECK (goal_type IN ('weight', 'steps', 'workout_frequency', 'habit', 'custom')),
  goal_name TEXT NOT NULL,
  goal_description TEXT,

  -- Target values
  current_value DECIMAL(10,2),
  target_value DECIMAL(10,2) NOT NULL,
  start_value DECIMAL(10,2),

  -- Timeline
  target_date DATE,
  created_date DATE DEFAULT CURRENT_DATE,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned', 'paused')),
  progress_percentage DECIMAL(5,2) DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_progress CHECK (progress_percentage >= 0 AND progress_percentage <= 100)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_goals_user_id ON user_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_user_goals_status ON user_goals(status);
CREATE INDEX IF NOT EXISTS idx_user_goals_type ON user_goals(goal_type);
CREATE INDEX IF NOT EXISTS idx_user_goals_user_type_status ON user_goals(user_id, goal_type, status);

-- ============================================================================
-- 4. Create achievements table (for onboarding completion badge)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Achievement details
  achievement_type achievement_type NOT NULL,
  achievement_name TEXT NOT NULL,
  achievement_description TEXT,
  achievement_icon TEXT,

  -- Points and rewards
  xp_awarded INTEGER DEFAULT 0,
  badge_url TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  earned_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate achievements
  UNIQUE(user_id, achievement_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_type ON user_achievements(achievement_type);

-- ============================================================================
-- 5. Add XP tracking columns to profiles (if not exists)
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS total_xp INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_level INTEGER DEFAULT 1;

-- Create index for leaderboards
CREATE INDEX IF NOT EXISTS idx_profiles_xp ON profiles(total_xp DESC) WHERE is_active = TRUE;

-- ============================================================================
-- 6. Create RLS policies for onboarding tables
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- Onboarding progress policies
CREATE POLICY "Users can view own onboarding progress"
  ON onboarding_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding progress"
  ON onboarding_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding progress"
  ON onboarding_progress FOR UPDATE
  USING (auth.uid() = user_id);

-- User goals policies
CREATE POLICY "Users can view own goals"
  ON user_goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goals"
  ON user_goals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goals"
  ON user_goals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own goals"
  ON user_goals FOR DELETE
  USING (auth.uid() = user_id);

-- User achievements policies
CREATE POLICY "Users can view own achievements"
  ON user_achievements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view others' achievements in same circles"
  ON user_achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM challenge_participants cp1
      WHERE cp1.user_id = user_achievements.user_id
      AND cp1.status = 'active'
      AND EXISTS (
        SELECT 1 FROM challenge_participants cp2
        WHERE cp2.challenge_id = cp1.challenge_id
        AND cp2.user_id = auth.uid()
        AND cp2.status = 'active'
      )
    )
  );

-- ============================================================================
-- 7. Create updated_at triggers
-- ============================================================================

-- Trigger for onboarding_progress
CREATE OR REPLACE FUNCTION update_onboarding_progress_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_onboarding_progress_timestamp
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_onboarding_progress_timestamp();

-- Trigger for user_goals
CREATE OR REPLACE FUNCTION update_user_goals_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_user_goals_timestamp
  BEFORE UPDATE ON user_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_user_goals_timestamp();

-- ============================================================================
-- 8. Insert seed data for achievement types
-- ============================================================================

-- This will be handled by the service layer when awarding achievements
-- No seed data needed here

-- ============================================================================
-- Migration complete
-- ============================================================================
