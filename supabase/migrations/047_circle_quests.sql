-- ============================================================================
-- Migration 047: Circle Quests
--
-- Adds circle_quests and circle_quest_progress tables for individual,
-- collaborative, and competitive quests within FitCircles.
-- ============================================================================

-- ============================================================================
-- CIRCLE QUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fitcircle_id UUID NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES challenges(id),
  template_id UUID REFERENCES challenge_templates(id),
  quest_name TEXT NOT NULL,
  quest_description TEXT,
  quest_type TEXT NOT NULL CHECK (quest_type IN ('individual', 'collaborative', 'competitive')),
  goal_amount DECIMAL(12,2) NOT NULL,
  unit TEXT NOT NULL,
  collective_target DECIMAL(12,2),
  collective_progress DECIMAL(12,2) DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'completed', 'expired')),
  created_by UUID REFERENCES profiles(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- CIRCLE QUEST PROGRESS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS circle_quest_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id UUID NOT NULL REFERENCES circle_quests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  individual_progress DECIMAL(12,2) DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quest_id, user_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_quests_circle ON circle_quests(fitcircle_id, status);
CREATE INDEX idx_quest_progress ON circle_quest_progress(quest_id, is_completed);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE circle_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_quest_progress ENABLE ROW LEVEL SECURITY;

-- Circle members can read quests for their circles
CREATE POLICY "Circle members can read quests"
  ON circle_quests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM fitcircle_members
      WHERE fitcircle_members.fitcircle_id = circle_quests.fitcircle_id
        AND fitcircle_members.user_id = auth.uid()
        AND fitcircle_members.status = 'active'
    )
  );

-- Circle members can insert quests for their circles
CREATE POLICY "Circle members can create quests"
  ON circle_quests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fitcircle_members
      WHERE fitcircle_members.fitcircle_id = circle_quests.fitcircle_id
        AND fitcircle_members.user_id = auth.uid()
        AND fitcircle_members.status = 'active'
    )
  );

-- Quest progress: users can read progress for quests in their circles
CREATE POLICY "Circle members can read quest progress"
  ON circle_quest_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM circle_quests
      JOIN fitcircle_members ON fitcircle_members.fitcircle_id = circle_quests.fitcircle_id
      WHERE circle_quests.id = circle_quest_progress.quest_id
        AND fitcircle_members.user_id = auth.uid()
        AND fitcircle_members.status = 'active'
    )
  );

-- Users can only insert/update their own progress
CREATE POLICY "Users can insert own quest progress"
  ON circle_quest_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own quest progress"
  ON circle_quest_progress FOR UPDATE
  USING (auth.uid() = user_id);
