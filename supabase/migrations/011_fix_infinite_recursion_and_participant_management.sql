-- Migration 011: Fix infinite recursion in RLS policies and add participant management features
-- This migration fixes the infinite recursion error and adds features for participant management

-- ============================================================================
-- 1. FIX INFINITE RECURSION IN CHALLENGE_PARTICIPANTS RLS POLICIES
-- ============================================================================

-- Drop ALL existing policies for challenge_participants to start fresh
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'challenge_participants') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON challenge_participants', r.policyname);
    END LOOP;
END $$;

-- Create new, non-recursive policies

-- SELECT policy - simplified to avoid recursion
CREATE POLICY "Users can view participants in their challenges"
  ON challenge_participants FOR SELECT
  TO authenticated
  USING (
    -- Users can see participants if they are the challenge creator
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_participants.challenge_id
      AND c.creator_id = auth.uid()
    )
    OR
    -- Or if they are a participant themselves (check by their user_id)
    user_id = auth.uid()
    OR
    -- Or if the challenge is public
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_participants.challenge_id
      AND c.visibility = 'public'
    )
  );

-- INSERT policy - users can join challenges
CREATE POLICY "Users can join challenges"
  ON challenge_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_participants.challenge_id
      AND (
        -- Can join if public
        c.visibility = 'public'
        -- Or if invite_only and has valid invite code (this is checked at app level)
        OR c.visibility = 'invite_only'
        -- Or if they're the creator
        OR c.creator_id = auth.uid()
      )
    )
  );

-- UPDATE policy - users can update their own participation
CREATE POLICY "Users can update their participation"
  ON challenge_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE policy - users can leave challenges
CREATE POLICY "Users can leave challenges"
  ON challenge_participants FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Challenge creators can remove participants
CREATE POLICY "Challenge creators can manage participants"
  ON challenge_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_participants.challenge_id
      AND c.creator_id = auth.uid()
    )
  );

-- Ensure RLS is enabled
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. ADD PARTICIPANT INVITATION TRACKING
-- ============================================================================

-- Create table to track pending invitations
CREATE TABLE IF NOT EXISTS challenge_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invited_email TEXT,
    invited_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
    
    -- Prevent duplicate invites
    UNIQUE(challenge_id, invited_email),
    UNIQUE(challenge_id, invited_user_id)
);

-- Add indexes for performance
CREATE INDEX idx_challenge_invitations_challenge ON challenge_invitations(challenge_id);
CREATE INDEX idx_challenge_invitations_email ON challenge_invitations(invited_email) WHERE invited_email IS NOT NULL;
CREATE INDEX idx_challenge_invitations_user ON challenge_invitations(invited_user_id) WHERE invited_user_id IS NOT NULL;
CREATE INDEX idx_challenge_invitations_status ON challenge_invitations(status);

-- RLS for invitations
ALTER TABLE challenge_invitations ENABLE ROW LEVEL SECURITY;

-- Policies for invitations
CREATE POLICY "Users can view invitations for their challenges"
  ON challenge_invitations FOR SELECT
  TO authenticated
  USING (
    -- Challenge creators can see all invitations
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_invitations.challenge_id
      AND c.creator_id = auth.uid()
    )
    OR
    -- Users can see invitations sent to them
    invited_user_id = auth.uid()
    OR
    -- Users can see invitations they sent
    invited_by = auth.uid()
  );

CREATE POLICY "Challenge creators can send invitations"
  ON challenge_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_invitations.challenge_id
      AND (c.creator_id = auth.uid() OR 
           EXISTS (
             SELECT 1 FROM challenge_participants cp
             WHERE cp.challenge_id = c.id
             AND cp.user_id = auth.uid()
             AND cp.status = 'active'
           ))
    )
  );

CREATE POLICY "Users can update invitation status"
  ON challenge_invitations FOR UPDATE
  TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
  )
  WITH CHECK (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
  );

-- ============================================================================
-- 3. CREATE QUICK JOIN VIEW (Will be created after column alterations)
-- ============================================================================

-- Note: View creation moved to after column alterations to avoid dependency issues

-- ============================================================================
-- 4. ADD FUNCTION FOR QUICK JOIN WITH CODE
-- ============================================================================

-- Function to join a challenge using invite code
CREATE OR REPLACE FUNCTION join_challenge_with_code(
    p_invite_code TEXT,
    p_starting_value DECIMAL DEFAULT NULL,
    p_goal_value DECIMAL DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_challenge_id UUID;
    v_challenge RECORD;
    v_participant_count INTEGER;
    v_result JSONB;
BEGIN
    -- Normalize invite code (uppercase, remove spaces)
    p_invite_code := UPPER(TRIM(p_invite_code));
    
    -- Find the challenge
    SELECT * INTO v_challenge
    FROM challenges
    WHERE invite_code = p_invite_code;
    
    -- Check if challenge exists
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid invite code'
        );
    END IF;
    
    v_challenge_id := v_challenge.id;
    
    -- Check if challenge is accepting participants
    IF v_challenge.status = 'completed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This challenge has already ended'
        );
    END IF;
    
    -- Check if already a participant
    IF EXISTS (
        SELECT 1 FROM challenge_participants
        WHERE challenge_id = v_challenge_id
        AND user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'You are already a participant in this challenge'
        );
    END IF;
    
    -- Check max participants
    IF v_challenge.max_participants IS NOT NULL THEN
        SELECT COUNT(*) INTO v_participant_count
        FROM challenge_participants
        WHERE challenge_id = v_challenge_id
        AND status = 'active';
        
        IF v_participant_count >= v_challenge.max_participants THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'This challenge is full'
            );
        END IF;
    END IF;
    
    -- Add participant
    INSERT INTO challenge_participants (
        challenge_id,
        user_id,
        status,
        starting_value,
        goal_value,
        current_value,
        joined_at
    ) VALUES (
        v_challenge_id,
        auth.uid(),
        'active',
        p_starting_value,
        p_goal_value,
        p_starting_value,
        NOW()
    );
    
    -- Update any pending invitation to accepted
    UPDATE challenge_invitations
    SET status = 'accepted',
        responded_at = NOW()
    WHERE challenge_id = v_challenge_id
    AND invited_user_id = auth.uid()
    AND status = 'pending';
    
    -- Return success with challenge details
    RETURN jsonb_build_object(
        'success', true,
        'challenge_id', v_challenge_id,
        'challenge_name', v_challenge.name,
        'message', 'Successfully joined the challenge!'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'An error occurred while joining the challenge'
        );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION join_challenge_with_code TO authenticated;

-- ============================================================================
-- 5. UPDATE INVITE CODE COLUMN SIZE (if needed)
-- ============================================================================

-- First drop the view that depends on this column
DROP VIEW IF EXISTS challenge_with_participants CASCADE;

-- Increase invite_code column size to support new format
ALTER TABLE challenges 
ALTER COLUMN invite_code TYPE VARCHAR(10);

-- Create/Recreate the view after altering the column
CREATE OR REPLACE VIEW challenge_with_participants AS
SELECT 
    c.*,
    COUNT(DISTINCT cp.user_id) FILTER (WHERE cp.status = 'active') as active_participants,
    COUNT(DISTINCT ci.id) FILTER (WHERE ci.status = 'pending') as pending_invitations
FROM challenges c
LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
LEFT JOIN challenge_invitations ci ON c.id = ci.challenge_id
GROUP BY c.id;

GRANT SELECT ON challenge_with_participants TO authenticated;

-- ============================================================================
-- 6. ADD HELPER FUNCTION TO GENERATE UNIQUE INVITE CODES
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_unique_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_code TEXT;
    v_exists BOOLEAN;
BEGIN
    LOOP
        -- Generate a code in format: FIT-XXXXXX
        v_code := 'FIT-' || 
            SUBSTRING(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            encode(gen_random_bytes(4), 'base64'),
                            '/', ''
                        ),
                        '+', ''
                    ),
                    '=', ''
                ),
                1, 6
            );
        
        -- Check if code already exists
        SELECT EXISTS(
            SELECT 1 FROM challenges WHERE invite_code = v_code
        ) INTO v_exists;
        
        -- Exit loop if unique code found
        EXIT WHEN NOT v_exists;
    END LOOP;
    
    RETURN v_code;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION generate_unique_invite_code TO authenticated;
