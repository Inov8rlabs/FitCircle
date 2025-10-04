-- ============================================================================
-- Migration: Remove Stored Procedures and Simplify RLS
-- Description: Removes all stored procedures and updates RLS policies to work
--              without function dependencies. All business logic moved to backend.
-- ============================================================================

-- Drop all stored procedures from 004_stored_procedures.sql
DROP FUNCTION IF EXISTS increment_participant_count(UUID);
DROP FUNCTION IF EXISTS decrement_participant_count(UUID);
DROP FUNCTION IF EXISTS increment_team_member_count(UUID);
DROP FUNCTION IF EXISTS decrement_team_member_count(UUID);
DROP FUNCTION IF EXISTS update_participant_stats(UUID, DATE);
DROP FUNCTION IF EXISTS update_leaderboard(UUID);
DROP FUNCTION IF EXISTS process_challenge_status_updates();
DROP FUNCTION IF EXISTS calculate_team_points(UUID);
DROP FUNCTION IF EXISTS award_achievement(UUID, UUID, achievement_type, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS process_streak_achievements();

-- Drop all stored procedures from 003_functions_procedures.sql
DROP FUNCTION IF EXISTS calculate_user_progress(UUID, UUID);
DROP FUNCTION IF EXISTS get_challenge_leaderboard(UUID, TEXT);
DROP FUNCTION IF EXISTS get_user_stats(UUID);
DROP FUNCTION IF EXISTS verify_check_in(UUID);

-- ============================================================================
-- Update RLS Policies - Remove function dependencies
-- ============================================================================

-- Drop old challenge policies that used helper functions
DROP POLICY IF EXISTS "Public challenges are viewable by everyone" ON challenges;
DROP POLICY IF EXISTS "Users can create challenges" ON challenges;
DROP POLICY IF EXISTS "Challenge creators can update their challenges" ON challenges;
DROP POLICY IF EXISTS "Challenge creators can delete draft challenges" ON challenges;

-- Create simpler challenge policies
CREATE POLICY "Anyone can view public challenges"
  ON challenges FOR SELECT
  USING (visibility = 'public' OR creator_id = auth.uid());

CREATE POLICY "Users can create their own challenges"
  ON challenges FOR INSERT
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their challenges"
  ON challenges FOR UPDATE
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their draft challenges"
  ON challenges FOR DELETE
  USING (auth.uid() = creator_id AND status = 'draft');

-- Update team policies
DROP POLICY IF EXISTS "Teams are viewable by challenge participants" ON teams;
DROP POLICY IF EXISTS "Team captains can update team" ON teams;
DROP POLICY IF EXISTS "Team captains can delete team" ON teams;

CREATE POLICY "Anyone can view teams in public challenges"
  ON teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = teams.challenge_id
      AND (c.visibility = 'public' OR c.creator_id = auth.uid())
    )
  );

CREATE POLICY "Users can create teams"
  ON teams FOR INSERT
  WITH CHECK (auth.uid() = captain_id);

CREATE POLICY "Captains can update their teams"
  ON teams FOR UPDATE
  USING (auth.uid() = captain_id)
  WITH CHECK (auth.uid() = captain_id);

CREATE POLICY "Captains can delete their teams"
  ON teams FOR DELETE
  USING (auth.uid() = captain_id);

-- Update team members policies
DROP POLICY IF EXISTS "Team members can view their team" ON team_members;
DROP POLICY IF EXISTS "Users can join teams" ON team_members;
DROP POLICY IF EXISTS "Team members can leave team" ON team_members;
DROP POLICY IF EXISTS "Captains can remove team members" ON team_members;

CREATE POLICY "Users can view team members"
  ON team_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_members.team_id
      AND t.captain_id = auth.uid()
    )
  );

CREATE POLICY "Users can join teams"
  ON team_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own membership"
  ON team_members FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave teams or captains can remove members"
  ON team_members FOR DELETE
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_members.team_id
      AND t.captain_id = auth.uid()
    )
  );

-- Update challenge participants policies
DROP POLICY IF EXISTS "Participants can view their own participation" ON challenge_participants;
DROP POLICY IF EXISTS "Users can join challenges" ON challenge_participants;
DROP POLICY IF EXISTS "Participants can update their own data" ON challenge_participants;

CREATE POLICY "Users can view participation"
  ON challenge_participants FOR SELECT
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_participants.challenge_id
      AND c.creator_id = auth.uid()
    )
  );

CREATE POLICY "Users can join public challenges"
  ON challenge_participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_id
      AND c.visibility = 'public'
    )
  );

CREATE POLICY "Participants can update their data"
  ON challenge_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Update check-ins policies (for challenge check-ins)
DROP POLICY IF EXISTS "Participants can view their check-ins" ON check_ins;
DROP POLICY IF EXISTS "Participants can create check-ins" ON check_ins;
DROP POLICY IF EXISTS "Participants can update their check-ins" ON check_ins;

CREATE POLICY "Users can view their own check-ins"
  ON check_ins FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create check-ins"
  ON check_ins FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their check-ins"
  ON check_ins FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Drop RLS helper functions (no longer needed)
DROP FUNCTION IF EXISTS public.is_team_member(UUID);
DROP FUNCTION IF EXISTS public.is_team_captain(UUID);
DROP FUNCTION IF EXISTS public.is_challenge_participant(UUID);
DROP FUNCTION IF EXISTS public.is_challenge_creator(UUID);

-- ============================================================================
-- Keep simple utility functions
-- ============================================================================

-- Note: We're keeping update_daily_tracking_updated_at() as it's a simple
-- timestamp trigger that doesn't contain business logic
