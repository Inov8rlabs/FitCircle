-- ============================================================================
-- Migration: Remove Stored Procedures and Simplify RLS (v2 - Fixed)
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

-- Drop RLS helper functions (no longer needed)
DROP FUNCTION IF EXISTS public.is_team_member(UUID);
DROP FUNCTION IF EXISTS public.is_team_captain(UUID);
DROP FUNCTION IF EXISTS public.is_challenge_participant(UUID);
DROP FUNCTION IF EXISTS public.is_challenge_creator(UUID);

-- ============================================================================
-- Update RLS Policies - Remove function dependencies
-- ============================================================================

-- ============================================================================
-- CHALLENGES POLICIES
-- ============================================================================
-- Drop all existing challenge policies
DROP POLICY IF EXISTS "Public challenges are viewable by everyone" ON challenges;
DROP POLICY IF EXISTS "Users can create challenges" ON challenges;
DROP POLICY IF EXISTS "Challenge creators can update their challenges" ON challenges;
DROP POLICY IF EXISTS "Challenge creators can delete draft challenges" ON challenges;
DROP POLICY IF EXISTS "Anyone can view public challenges" ON challenges;
DROP POLICY IF EXISTS "Users can create their own challenges" ON challenges;
DROP POLICY IF EXISTS "Creators can update their challenges" ON challenges;
DROP POLICY IF EXISTS "Creators can delete their draft challenges" ON challenges;

-- Create new simplified challenge policies
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

-- ============================================================================
-- TEAMS POLICIES
-- ============================================================================
-- Drop all existing team policies
DROP POLICY IF EXISTS "Teams are viewable by challenge participants" ON teams;
DROP POLICY IF EXISTS "Team captains can update team" ON teams;
DROP POLICY IF EXISTS "Team captains can delete team" ON teams;
DROP POLICY IF EXISTS "Anyone can view teams in public challenges" ON teams;
DROP POLICY IF EXISTS "Team members can create teams" ON teams;
DROP POLICY IF EXISTS "Team captains can update their teams" ON teams;
DROP POLICY IF EXISTS "Team captains can delete their teams" ON teams;
DROP POLICY IF EXISTS "Users can create teams" ON teams;
DROP POLICY IF EXISTS "Captains can update their teams" ON teams;
DROP POLICY IF EXISTS "Captains can delete their teams" ON teams;

-- Create new team policies
CREATE POLICY "Anyone can view teams in public challenges"
  ON teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = teams.challenge_id
      AND (c.visibility = 'public' OR c.creator_id = auth.uid())
    )
  );

CREATE POLICY "Team members can create teams"
  ON teams FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Team captains can update their teams"
  ON teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.role = 'captain'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.role = 'captain'
    )
  );

CREATE POLICY "Team captains can delete their teams"
  ON teams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.role = 'captain'
    )
  );

-- ============================================================================
-- TEAM MEMBERS POLICIES
-- ============================================================================
-- Drop all existing team member policies
DROP POLICY IF EXISTS "Team members can view their team" ON team_members;
DROP POLICY IF EXISTS "Users can join teams" ON team_members;
DROP POLICY IF EXISTS "Team members can leave team" ON team_members;
DROP POLICY IF EXISTS "Captains can remove team members" ON team_members;
DROP POLICY IF EXISTS "Users can view team members" ON team_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON team_members;
DROP POLICY IF EXISTS "Users can leave teams or captains can remove members" ON team_members;

-- Create new team member policies
CREATE POLICY "Users can view team members"
  ON team_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'captain'
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
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'captain'
    )
  );

-- ============================================================================
-- CHALLENGE PARTICIPANTS POLICIES
-- ============================================================================
-- Drop all existing challenge participant policies
DROP POLICY IF EXISTS "Participants can view their own participation" ON challenge_participants;
DROP POLICY IF EXISTS "Users can join challenges" ON challenge_participants;
DROP POLICY IF EXISTS "Participants can update their own data" ON challenge_participants;
DROP POLICY IF EXISTS "Users can view participation" ON challenge_participants;
DROP POLICY IF EXISTS "Users can join public challenges" ON challenge_participants;
DROP POLICY IF EXISTS "Participants can update their data" ON challenge_participants;

-- Create new challenge participant policies
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

-- ============================================================================
-- CHECK-INS POLICIES (for challenge check-ins)
-- ============================================================================
-- Drop all existing check-in policies
DROP POLICY IF EXISTS "Participants can view their check-ins" ON check_ins;
DROP POLICY IF EXISTS "Participants can create check-ins" ON check_ins;
DROP POLICY IF EXISTS "Participants can update their check-ins" ON check_ins;
DROP POLICY IF EXISTS "Users can view their own check-ins" ON check_ins;
DROP POLICY IF EXISTS "Users can create check-ins" ON check_ins;
DROP POLICY IF EXISTS "Users can update their check-ins" ON check_ins;

-- Create new check-in policies
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

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Note: We're keeping update_daily_tracking_updated_at() as it's a simple
-- timestamp trigger that doesn't contain business logic
