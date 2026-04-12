-- ============================================================================
-- Migration 046: Daily Challenge System
-- ============================================================================

CREATE TABLE daily_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_date DATE NOT NULL UNIQUE,
  template_id UUID REFERENCES challenge_templates(id),
  custom_name TEXT,
  custom_description TEXT,
  custom_goal_amount DECIMAL(12,2),
  custom_unit TEXT,
  is_custom BOOLEAN DEFAULT false,
  participant_count INTEGER DEFAULT 0,
  completion_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_challenge_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_challenge_id UUID NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  progress DECIMAL(12,2) DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(daily_challenge_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_challenges_date ON daily_challenges(challenge_date);
CREATE INDEX IF NOT EXISTS idx_daily_participants_challenge ON daily_challenge_participants(daily_challenge_id, is_completed);
CREATE INDEX IF NOT EXISTS idx_daily_participants_user ON daily_challenge_participants(user_id, joined_at DESC);

-- RLS
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenge_participants ENABLE ROW LEVEL SECURITY;

-- Daily challenges: public read for authenticated users
CREATE POLICY "Authenticated users can view daily challenges"
  ON daily_challenges FOR SELECT
  TO authenticated
  USING (true);

-- Participants: users can view all participants (for leaderboard)
CREATE POLICY "Authenticated users can view participants"
  ON daily_challenge_participants FOR SELECT
  TO authenticated
  USING (true);

-- Participants: users can insert their own participation
CREATE POLICY "Users can join daily challenges"
  ON daily_challenge_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Participants: users can update their own progress
CREATE POLICY "Users can update own progress"
  ON daily_challenge_participants FOR UPDATE
  USING (auth.uid() = user_id);

-- Participants: users can leave (delete their own participation)
CREATE POLICY "Users can leave daily challenges"
  ON daily_challenge_participants FOR DELETE
  USING (auth.uid() = user_id);
