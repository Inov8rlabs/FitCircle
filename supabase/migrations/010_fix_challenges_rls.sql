-- Migration 010: Fix RLS policies for challenges table
-- Ensures users can create FitCircles

-- Drop ALL existing policies to avoid conflicts
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'challenges') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON challenges', r.policyname);
    END LOOP;
END $$;

-- Recreate policies with correct permissions

-- SELECT policies
CREATE POLICY "Users can view public challenges"
  ON challenges FOR SELECT
  TO authenticated
  USING (
    visibility = 'public'
    OR auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = challenges.id
      AND user_id = auth.uid()
    )
  );

-- INSERT policy - allow authenticated users to create challenges
CREATE POLICY "Authenticated users can create challenges"
  ON challenges FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = creator_id);

-- UPDATE policy - creators can update their own challenges
CREATE POLICY "Challenge creators can update their challenges"
  ON challenges FOR UPDATE
  TO authenticated
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

-- DELETE policy - creators can delete their draft challenges
CREATE POLICY "Challenge creators can delete draft challenges"
  ON challenges FOR DELETE
  TO authenticated
  USING (auth.uid() = creator_id AND status = 'draft');

-- Ensure RLS is enabled
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON challenges TO authenticated;

-- ============================================================================
-- FIX CHALLENGE_PARTICIPANTS POLICIES
-- ============================================================================

-- Drop ALL existing policies for challenge_participants
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'challenge_participants') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON challenge_participants', r.policyname);
    END LOOP;
END $$;

-- Recreate policies

-- SELECT policy - users can see their own participations and others in same challenges
CREATE POLICY "Users can view challenge participants"
  ON challenge_participants FOR SELECT
  TO authenticated
  USING (
    -- Users can always see their own participations
    auth.uid() = user_id
    OR
    -- Users can see other participants in challenges they're in
    EXISTS (
      SELECT 1 FROM challenge_participants cp
      WHERE cp.challenge_id = challenge_participants.challenge_id
      AND cp.user_id = auth.uid()
    )
    OR
    -- Challenge creators can see all participants
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_participants.challenge_id
      AND c.creator_id = auth.uid()
    )
  );

-- INSERT policy - allow users to join challenges
CREATE POLICY "Users can join challenges"
  ON challenge_participants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE policy
CREATE POLICY "Users can update their participation"
  ON challenge_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Ensure RLS is enabled
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_participants TO authenticated;
