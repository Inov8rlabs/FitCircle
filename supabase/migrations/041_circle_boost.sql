-- Migration 041: Circle Boost & Timezone Support
-- Adds timezone and member limits to fitcircles, and circle_daily_boosts table

-- Add timezone and member limit columns to fitcircles
ALTER TABLE fitcircles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS min_members INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_members INTEGER DEFAULT 12;

-- Circle Daily Boosts table
CREATE TABLE IF NOT EXISTS circle_daily_boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fitcircle_id UUID NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
  boost_date DATE NOT NULL,
  total_members INTEGER NOT NULL,
  checked_in_members INTEGER NOT NULL DEFAULT 0,
  boost_multiplier DECIMAL(3,1) NOT NULL DEFAULT 1.0,
  is_perfect_day BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fitcircle_id, boost_date)
);

CREATE INDEX IF NOT EXISTS idx_circle_boosts_date ON circle_daily_boosts(boost_date);
CREATE INDEX IF NOT EXISTS idx_circle_boosts_fitcircle ON circle_daily_boosts(fitcircle_id);

-- RLS for circle_daily_boosts
ALTER TABLE circle_daily_boosts ENABLE ROW LEVEL SECURITY;

-- Circle members can read their circle's boosts
CREATE POLICY "Circle members can view boosts"
  ON circle_daily_boosts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_participants.challenge_id = circle_daily_boosts.fitcircle_id
        AND challenge_participants.user_id = auth.uid()
        AND challenge_participants.status = 'active'
    )
  );

-- Service role can manage boosts (via admin client)
CREATE POLICY "Service role full access to boosts"
  ON circle_daily_boosts
  FOR ALL
  USING (auth.role() = 'service_role');
