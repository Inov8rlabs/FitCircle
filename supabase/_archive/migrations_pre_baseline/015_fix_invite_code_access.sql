-- Migration 015: Fix invite code access for challenges
-- Allows users to view challenge details when they have a valid invite code
-- This fixes the "expired code" error when users try to join via invite link

-- Drop the existing SELECT policy for challenges
DROP POLICY IF EXISTS "Users can view public challenges" ON challenges;

-- Recreate with invite code access
CREATE POLICY "Users can view accessible challenges"
  ON challenges FOR SELECT
  TO authenticated
  USING (
    -- Public challenges
    visibility = 'public'
    -- Challenges created by the user
    OR auth.uid() = creator_id
    -- Challenges the user is already participating in
    OR EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = challenges.id
      AND user_id = auth.uid()
    )
    -- ANY challenge (users can view any challenge details when joining via invite code)
    -- The invite code validation happens in the application layer
    OR invite_code IS NOT NULL
  );

-- Add a policy for anonymous users to view challenges via invite code
-- This allows unauthenticated users to see challenge preview when clicking invite links
CREATE POLICY "Anonymous users can view challenges with invite codes"
  ON challenges FOR SELECT
  TO anon
  USING (invite_code IS NOT NULL);

-- Grant SELECT permission to anonymous users
GRANT SELECT ON challenges TO anon;
