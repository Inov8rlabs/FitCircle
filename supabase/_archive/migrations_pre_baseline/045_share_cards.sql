-- ============================================================================
-- Migration 045: Share Cards
-- ============================================================================

CREATE TABLE share_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_type TEXT NOT NULL CHECK (card_type IN ('milestone', 'challenge_complete', 'perfect_week', 'momentum_flame', 'circle_boost')),
  template_name TEXT NOT NULL,
  card_data JSONB NOT NULL DEFAULT '{}',
  image_url TEXT,
  shared_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

-- Indexes
CREATE INDEX idx_share_cards_user ON share_cards(user_id, created_at DESC);
CREATE INDEX idx_share_cards_expiry ON share_cards(expires_at);

-- RLS
ALTER TABLE share_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own share cards"
  ON share_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own share cards"
  ON share_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own share cards"
  ON share_cards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own share cards"
  ON share_cards FOR DELETE
  USING (auth.uid() = user_id);
