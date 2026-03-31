-- ============================================================================
-- Migration 036: Circle Challenges Feature
-- Creates tables for challenge creation, participation, activity logging,
-- and challenge-specific invitations within FitCircles.
-- ============================================================================

-- ============================================================================
-- TABLE: circle_challenges
-- Core challenge record, child of a FitCircle (challenges table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS circle_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES profiles(id),
  template_id TEXT,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 3 AND 50),
  description TEXT CHECK (char_length(description) <= 200),
  category TEXT NOT NULL CHECK (category IN ('strength', 'cardio', 'flexibility', 'wellness', 'custom')),
  goal_amount DECIMAL(12, 2) NOT NULL CHECK (goal_amount > 0),
  unit TEXT NOT NULL CHECK (char_length(unit) <= 20),
  logging_prompt TEXT CHECK (char_length(logging_prompt) <= 60),
  is_open BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  participant_count INTEGER DEFAULT 0,
  winner_user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (ends_at > starts_at)
);

-- Indexes for circle_challenges
CREATE INDEX idx_circle_challenges_circle_id ON circle_challenges(circle_id);
CREATE INDEX idx_circle_challenges_status ON circle_challenges(status, starts_at);
CREATE INDEX idx_circle_challenges_circle_active ON circle_challenges(circle_id, status) WHERE status IN ('scheduled', 'active');

-- ============================================================================
-- TABLE: circle_challenge_participants
-- Tracks who is in each challenge and their aggregated totals
-- ============================================================================
CREATE TABLE IF NOT EXISTS circle_challenge_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES challenges(id),
  invited_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'withdrawn')),
  cumulative_total DECIMAL(12, 2) DEFAULT 0,
  today_total DECIMAL(12, 2) DEFAULT 0,
  today_date DATE DEFAULT CURRENT_DATE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_logged_at TIMESTAMPTZ,
  log_count INTEGER DEFAULT 0,
  rank INTEGER,
  goal_completion_pct DECIMAL(5, 2) DEFAULT 0,
  milestones_achieved JSONB DEFAULT '{}',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(challenge_id, user_id)
);

-- Indexes for circle_challenge_participants
CREATE INDEX idx_cc_participants_challenge_id ON circle_challenge_participants(challenge_id);
CREATE INDEX idx_cc_participants_user_id ON circle_challenge_participants(user_id);
CREATE INDEX idx_cc_participants_leaderboard ON circle_challenge_participants(challenge_id, cumulative_total DESC, today_total DESC, current_streak DESC) WHERE status = 'active';

-- ============================================================================
-- TABLE: circle_challenge_logs
-- Individual log entries. One participant can have many per day.
-- ============================================================================
CREATE TABLE IF NOT EXISTS circle_challenge_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES circle_challenge_participants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  circle_id UUID NOT NULL REFERENCES challenges(id),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 10000),
  note TEXT CHECK (char_length(note) <= 80),
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  log_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for circle_challenge_logs
CREATE INDEX idx_cc_logs_challenge_id ON circle_challenge_logs(challenge_id, logged_at DESC);
CREATE INDEX idx_cc_logs_participant_id ON circle_challenge_logs(participant_id, log_date DESC);
CREATE INDEX idx_cc_logs_user_date ON circle_challenge_logs(user_id, challenge_id, log_date DESC);

-- ============================================================================
-- TABLE: circle_challenge_invites
-- Tracks challenge-specific invitations (distinct from circle invites)
-- ============================================================================
CREATE TABLE IF NOT EXISTS circle_challenge_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES profiles(id),
  invitee_id UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  UNIQUE(challenge_id, invitee_id)
);

-- ============================================================================
-- RLS POLICIES (Simple ownership/membership checks only)
-- ============================================================================

ALTER TABLE circle_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_challenge_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_challenge_invites ENABLE ROW LEVEL SECURITY;

-- circle_challenges: visible to circle members
CREATE POLICY "circle_challenges_select" ON circle_challenges
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM challenge_participants
      WHERE challenge_id = circle_challenges.circle_id AND status = 'active'
    )
  );

-- circle_challenges: creator can insert
CREATE POLICY "circle_challenges_insert" ON circle_challenges
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- circle_challenges: creator can update
CREATE POLICY "circle_challenges_update" ON circle_challenges
  FOR UPDATE USING (auth.uid() = creator_id);

-- circle_challenge_participants: visible to circle members
CREATE POLICY "cc_participants_select" ON circle_challenge_participants
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM challenge_participants
      WHERE challenge_id = circle_challenge_participants.circle_id AND status = 'active'
    )
  );

-- circle_challenge_participants: users can insert themselves
CREATE POLICY "cc_participants_insert" ON circle_challenge_participants
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- circle_challenge_logs: users can insert own logs
CREATE POLICY "cc_logs_insert" ON circle_challenge_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- circle_challenge_logs: visible to challenge participants
CREATE POLICY "cc_logs_select" ON circle_challenge_logs
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM circle_challenge_participants
      WHERE challenge_id = circle_challenge_logs.challenge_id AND status = 'active'
    )
  );

-- circle_challenge_logs: users can delete own today's logs
CREATE POLICY "cc_logs_delete" ON circle_challenge_logs
  FOR DELETE USING (auth.uid() = user_id AND log_date = CURRENT_DATE);

-- circle_challenge_invites: visible to inviter and invitee
CREATE POLICY "cc_invites_select" ON circle_challenge_invites
  FOR SELECT USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);

-- circle_challenge_invites: circle members can insert
CREATE POLICY "cc_invites_insert" ON circle_challenge_invites
  FOR INSERT WITH CHECK (auth.uid() = inviter_id);

-- circle_challenge_invites: invitee can update (accept/decline)
CREATE POLICY "cc_invites_update" ON circle_challenge_invites
  FOR UPDATE USING (auth.uid() = invitee_id);
