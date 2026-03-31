-- ============================================================================
-- Migration 037: Unified FitCircle + Challenge Model
--
-- FitCircle = Social Group (permanent, has members, invite code)
-- Challenge = Competition (time-boxed, goal/unit/leaderboard, lives in a FitCircle)
--
-- Renames:
--   challenges                    → fitcircles
--   challenge_participants        → fitcircle_members
--   circle_challenges             → challenges
--   circle_challenge_participants → challenge_participants
--   circle_challenge_logs         → challenge_logs
--   circle_challenge_invites      → challenge_invites
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop ALL RLS policies on affected tables (must happen before renames)
-- ============================================================================

-- Policies on old challenges table (from migrations 010, 015)
DROP POLICY IF EXISTS "Users can view public challenges" ON challenges;
DROP POLICY IF EXISTS "Authenticated users can create challenges" ON challenges;
DROP POLICY IF EXISTS "Challenge creators can update their challenges" ON challenges;
DROP POLICY IF EXISTS "Challenge creators can delete draft challenges" ON challenges;
DROP POLICY IF EXISTS "Users can view accessible challenges" ON challenges;
DROP POLICY IF EXISTS "Anonymous users can view challenges with invite codes" ON challenges;
-- Catch-all for any other policies on challenges
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'challenges'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON challenges', r.policyname);
  END LOOP;
END $$;

-- Policies on old challenge_participants table (from migrations 010, 011)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'challenge_participants'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON challenge_participants', r.policyname);
  END LOOP;
END $$;

-- Policies on circle_challenges (from migration 036)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'circle_challenges'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON circle_challenges', r.policyname);
  END LOOP;
END $$;

-- Policies on circle_challenge_participants
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'circle_challenge_participants'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON circle_challenge_participants', r.policyname);
  END LOOP;
END $$;

-- Policies on circle_challenge_logs
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'circle_challenge_logs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON circle_challenge_logs', r.policyname);
  END LOOP;
END $$;

-- Policies on circle_challenge_invites
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'circle_challenge_invites'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON circle_challenge_invites', r.policyname);
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: Rename the old tables
-- PostgreSQL automatically updates FK references when renaming.
-- ============================================================================

-- challenges → fitcircles (the social group container)
ALTER TABLE challenges RENAME TO fitcircles;

-- challenge_participants → fitcircle_members (group membership)
ALTER TABLE challenge_participants RENAME TO fitcircle_members;
ALTER TABLE fitcircle_members RENAME COLUMN challenge_id TO fitcircle_id;

-- ============================================================================
-- STEP 3: Add role column to fitcircle_members
-- ============================================================================

ALTER TABLE fitcircle_members ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member'
  CHECK (role IN ('owner', 'admin', 'member'));

-- Set creators as owners
UPDATE fitcircle_members fm
  SET role = 'owner'
  FROM fitcircles f
  WHERE fm.fitcircle_id = f.id AND fm.user_id = f.creator_id;

-- ============================================================================
-- STEP 4: Make fitcircles time-boxing optional (groups are permanent)
-- ============================================================================

ALTER TABLE fitcircles ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE fitcircles ALTER COLUMN end_date DROP NOT NULL;
ALTER TABLE fitcircles ALTER COLUMN registration_deadline DROP NOT NULL;

-- ============================================================================
-- STEP 5: Add is_default and check_in_mode to circle_challenges
-- (before rename so we can reference the current name)
-- ============================================================================

ALTER TABLE circle_challenges ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
ALTER TABLE circle_challenges ADD COLUMN IF NOT EXISTS check_in_mode TEXT DEFAULT 'multi_daily'
  CHECK (check_in_mode IN ('single_daily', 'multi_daily', 'unlimited'));

-- ============================================================================
-- STEP 6: Migrate existing FitCircle data into circle_challenges as default challenges
-- Each existing FitCircle with a type gets a default challenge created.
-- ============================================================================

INSERT INTO circle_challenges (
  circle_id, creator_id, template_id, name, description,
  category, goal_amount, unit, logging_prompt,
  is_open, status, starts_at, ends_at,
  participant_count, is_default, check_in_mode
)
SELECT
  f.id,
  f.creator_id,
  NULL,
  f.name,
  f.description,
  CASE f.type::text
    WHEN 'weight_loss' THEN 'wellness'
    WHEN 'step_count' THEN 'cardio'
    WHEN 'workout_minutes' THEN 'cardio'
    WHEN 'custom' THEN 'custom'
    ELSE 'custom'
  END,
  100, -- default goal, users have individual goals in their participant records
  CASE f.type::text
    WHEN 'weight_loss' THEN 'lbs'
    WHEN 'step_count' THEN 'steps'
    WHEN 'workout_minutes' THEN 'minutes'
    ELSE 'units'
  END,
  CASE f.type::text
    WHEN 'weight_loss' THEN 'What is your weight today?'
    WHEN 'step_count' THEN 'How many steps today?'
    WHEN 'workout_minutes' THEN 'How many minutes did you work out?'
    ELSE 'Log your progress'
  END,
  true,
  COALESCE(f.status::text, 'active'),
  COALESCE(f.start_date, NOW()),
  COALESCE(f.end_date, NOW() + INTERVAL '90 days'),
  f.participant_count,
  true,
  CASE f.type::text
    WHEN 'weight_loss' THEN 'single_daily'
    ELSE 'multi_daily'
  END
FROM fitcircles f
WHERE f.type IS NOT NULL;

-- Migrate fitcircle_members into circle_challenge_participants for default challenges
INSERT INTO circle_challenge_participants (
  challenge_id, user_id, circle_id, invited_by,
  status, cumulative_total, today_total,
  current_streak, longest_streak, log_count, rank,
  goal_completion_pct, joined_at
)
SELECT
  cc.id,
  fm.user_id,
  cc.circle_id,
  NULL,
  CASE fm.status
    WHEN 'active' THEN 'active'
    WHEN 'completed' THEN 'active'
    WHEN 'pending' THEN 'invited'
    ELSE 'active'
  END,
  COALESCE(fm.current_value, 0),
  0,
  COALESCE(fm.streak_days, fm.current_streak, 0),
  COALESCE(fm.longest_streak, 0),
  COALESCE(fm.check_ins_count, 0),
  fm.rank,
  COALESCE(fm.progress_percentage, 0),
  COALESCE(fm.joined_at, fm.created_at, NOW())
FROM circle_challenges cc
JOIN fitcircle_members fm ON fm.fitcircle_id = cc.circle_id
WHERE cc.is_default = true
  AND fm.status IN ('active', 'completed', 'pending')
ON CONFLICT (challenge_id, user_id) DO NOTHING;

-- ============================================================================
-- STEP 7: Rename circle_challenges → challenges (the competition)
-- ============================================================================

ALTER TABLE circle_challenges RENAME TO challenges;

-- Rename circle_challenge_participants → challenge_participants
ALTER TABLE circle_challenge_participants RENAME TO challenge_participants;

-- Rename circle_challenge_logs → challenge_logs
ALTER TABLE circle_challenge_logs RENAME TO challenge_logs;

-- Rename circle_challenge_invites → challenge_invites
ALTER TABLE circle_challenge_invites RENAME TO challenge_invites;

-- ============================================================================
-- STEP 8: Rename FK column in challenges for clarity
-- circle_id → fitcircle_id
-- ============================================================================

ALTER TABLE challenges RENAME COLUMN circle_id TO fitcircle_id;
ALTER TABLE challenge_participants RENAME COLUMN circle_id TO fitcircle_id;
ALTER TABLE challenge_logs RENAME COLUMN circle_id TO fitcircle_id;

-- ============================================================================
-- STEP 9: Recreate RLS policies on new table names
-- ============================================================================

-- fitcircles: authenticated users can view
ALTER TABLE fitcircles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fitcircles_select" ON fitcircles
  FOR SELECT USING (true);

CREATE POLICY "fitcircles_insert" ON fitcircles
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "fitcircles_update" ON fitcircles
  FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "fitcircles_delete" ON fitcircles
  FOR DELETE USING (auth.uid() = creator_id);

-- fitcircle_members
ALTER TABLE fitcircle_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fitcircle_members_select" ON fitcircle_members
  FOR SELECT USING (true);

CREATE POLICY "fitcircle_members_insert" ON fitcircle_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "fitcircle_members_update" ON fitcircle_members
  FOR UPDATE USING (auth.uid() = user_id);

-- challenges (competitions)
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "challenges_select" ON challenges
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM fitcircle_members
      WHERE fitcircle_id = challenges.fitcircle_id AND status = 'active'
    )
  );

CREATE POLICY "challenges_insert" ON challenges
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "challenges_update" ON challenges
  FOR UPDATE USING (auth.uid() = creator_id);

-- challenge_participants
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "challenge_participants_select" ON challenge_participants
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM fitcircle_members
      WHERE fitcircle_id = challenge_participants.fitcircle_id AND status = 'active'
    )
  );

CREATE POLICY "challenge_participants_insert" ON challenge_participants
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- challenge_logs
ALTER TABLE challenge_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "challenge_logs_insert" ON challenge_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "challenge_logs_select" ON challenge_logs
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM challenge_participants
      WHERE challenge_id = challenge_logs.challenge_id AND status = 'active'
    )
  );

CREATE POLICY "challenge_logs_delete" ON challenge_logs
  FOR DELETE USING (auth.uid() = user_id AND log_date = CURRENT_DATE);

-- challenge_invites
ALTER TABLE challenge_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "challenge_invites_select" ON challenge_invites
  FOR SELECT USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);

CREATE POLICY "challenge_invites_insert" ON challenge_invites
  FOR INSERT WITH CHECK (auth.uid() = inviter_id);

CREATE POLICY "challenge_invites_update" ON challenge_invites
  FOR UPDATE USING (auth.uid() = invitee_id);

-- ============================================================================
-- STEP 10: Grant permissions
-- ============================================================================

GRANT SELECT ON fitcircles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitcircles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitcircle_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenges TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_invites TO authenticated;
