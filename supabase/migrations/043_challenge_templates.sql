-- ============================================================================
-- Migration 043: Challenge Templates + Quest Support
--
-- Creates challenge_templates table for the challenge library.
-- Adds quest_type columns to challenges for collaborative/individual modes.
-- ============================================================================

-- ============================================================================
-- CHALLENGE TEMPLATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS challenge_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('daily_micro', 'weekly', 'monthly', 'epic', 'collaborative', 'onboarding')),
  challenge_category TEXT NOT NULL CHECK (challenge_category IN ('strength', 'cardio', 'flexibility', 'wellness', 'mixed')),
  goal_amount DECIMAL(12,2) NOT NULL,
  unit TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  logging_prompt TEXT,
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard', 'extreme')),
  icon_name TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  completions_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtered queries
CREATE INDEX idx_templates_category ON challenge_templates(category, is_active);
CREATE INDEX idx_templates_difficulty ON challenge_templates(difficulty, is_active);

-- ============================================================================
-- RLS: Public read for authenticated users
-- ============================================================================

ALTER TABLE challenge_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read templates"
  ON challenge_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- QUEST SUPPORT: Extend challenges table
-- ============================================================================

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS quest_type TEXT DEFAULT 'competitive'
    CHECK (quest_type IN ('individual', 'collaborative', 'competitive'));

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS collective_target DECIMAL(12,2);

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS collective_progress DECIMAL(12,2) DEFAULT 0;
