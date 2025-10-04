-- Enable Row Level Security on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS (in public schema)
CREATE OR REPLACE FUNCTION public.is_team_member(team_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = team_uuid
    AND user_id = auth.uid()
    AND is_active = true
  )
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_team_captain(team_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = team_uuid
    AND user_id = auth.uid()
    AND role = 'captain'
    AND is_active = true
  )
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_challenge_participant(challenge_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM challenge_participants
    WHERE challenge_id = challenge_uuid
    AND user_id = auth.uid()
    AND status IN ('active', 'completed')
  )
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_challenge_creator(challenge_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM challenges
    WHERE id = challenge_uuid
    AND creator_id = auth.uid()
  )
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles policies
CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Challenges policies
CREATE POLICY "Public challenges are viewable by everyone"
  ON challenges FOR SELECT
  USING (
    visibility = 'public'
    OR creator_id = auth.uid()
    OR (visibility = 'private' AND public.is_challenge_participant(id))
    OR (visibility = 'invite_only' AND EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = challenges.id
      AND user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can create challenges"
  ON challenges FOR INSERT
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Challenge creators can update their challenges"
  ON challenges FOR UPDATE
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Challenge creators can delete draft challenges"
  ON challenges FOR DELETE
  USING (auth.uid() = creator_id AND status = 'draft');

-- Teams policies
CREATE POLICY "Teams are viewable by challenge participants"
  ON teams FOR SELECT
  USING (
    is_public = true
    OR public.is_team_member(id)
    OR public.is_challenge_participant(challenge_id)
  );

CREATE POLICY "Team captains can create teams"
  ON teams FOR INSERT
  WITH CHECK (
    public.is_challenge_participant(challenge_id)
    AND NOT EXISTS (
      SELECT 1 FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.user_id = auth.uid()
      AND t.challenge_id = challenge_id
      AND tm.is_active = true
    )
  );

CREATE POLICY "Team captains can update their teams"
  ON teams FOR UPDATE
  USING (public.is_team_captain(id))
  WITH CHECK (public.is_team_captain(id));

CREATE POLICY "Team captains can delete their teams"
  ON teams FOR DELETE
  USING (public.is_team_captain(id));

-- Team members policies
CREATE POLICY "Team members are viewable by team members and challenge participants"
  ON team_members FOR SELECT
  USING (
    public.is_team_member(team_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_id
      AND public.is_challenge_participant(t.challenge_id)
    )
  );

CREATE POLICY "Users can join teams"
  ON team_members FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_id
      AND public.is_challenge_participant(t.challenge_id)
      AND t.member_count < t.max_members
    )
  );

CREATE POLICY "Team captains can update team members"
  ON team_members FOR UPDATE
  USING (public.is_team_captain(team_id))
  WITH CHECK (public.is_team_captain(team_id));

CREATE POLICY "Users can leave teams"
  ON team_members FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND is_active = false
  );

-- Challenge participants policies
CREATE POLICY "Participants are viewable by challenge members"
  ON challenge_participants FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_challenge_participant(challenge_id)
    OR EXISTS (
      SELECT 1 FROM challenges
      WHERE id = challenge_id
      AND visibility = 'public'
    )
  );

CREATE POLICY "Users can join challenges"
  ON challenge_participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM challenges
      WHERE id = challenge_id
      AND status IN ('upcoming', 'active')
      AND (
        registration_deadline >= NOW()
        OR (allow_late_join = true AND status = 'active')
      )
    )
  );

CREATE POLICY "Users can update their participation"
  ON challenge_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Check-ins policies
CREATE POLICY "Check-ins are viewable by challenge participants"
  ON check_ins FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_challenge_participant(challenge_id)
    OR EXISTS (
      SELECT 1 FROM challenges
      WHERE id = challenge_id
      AND visibility = 'public'
    )
  );

CREATE POLICY "Users can create their own check-ins"
  ON check_ins FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_challenge_participant(challenge_id)
    AND EXISTS (
      SELECT 1 FROM challenges
      WHERE id = challenge_id
      AND status = 'active'
    )
  );

CREATE POLICY "Users can update their own check-ins"
  ON check_ins FOR UPDATE
  USING (
    auth.uid() = user_id
    AND created_at > NOW() - INTERVAL '24 hours'
  )
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recent check-ins"
  ON check_ins FOR DELETE
  USING (
    auth.uid() = user_id
    AND created_at > NOW() - INTERVAL '1 hour'
  );

-- Leaderboard policies
CREATE POLICY "Leaderboard is viewable by everyone"
  ON leaderboard FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM challenges
      WHERE id = challenge_id
      AND (
        visibility = 'public'
        OR public.is_challenge_participant(id)
      )
    )
  );

-- Notifications policies
CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (true); -- Will be restricted by service role

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Comments policies
CREATE POLICY "Comments are viewable by relevant users"
  ON comments FOR SELECT
  USING (
    CASE entity_type
      WHEN 'check_in' THEN EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.id = entity_id::uuid
        AND (
          ci.user_id = auth.uid()
          OR public.is_challenge_participant(ci.challenge_id)
        )
      )
      WHEN 'challenge' THEN EXISTS (
        SELECT 1 FROM challenges c
        WHERE c.id = entity_id::uuid
        AND (
          c.visibility = 'public'
          OR public.is_challenge_participant(c.id)
        )
      )
      WHEN 'team' THEN public.is_team_member(entity_id::uuid)
      ELSE false
    END
  );

CREATE POLICY "Users can create comments"
  ON comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND CASE entity_type
      WHEN 'check_in' THEN EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.id = entity_id::uuid
        AND public.is_challenge_participant(ci.challenge_id)
      )
      WHEN 'challenge' THEN public.is_challenge_participant(entity_id::uuid)
      WHEN 'team' THEN public.is_team_member(entity_id::uuid)
      ELSE false
    END
  );

CREATE POLICY "Users can update their own comments"
  ON comments FOR UPDATE
  USING (
    auth.uid() = user_id
    AND created_at > NOW() - INTERVAL '1 hour'
  )
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can soft delete their own comments"
  ON comments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND is_deleted = true
  );

-- Reactions policies
CREATE POLICY "Reactions are viewable by relevant users"
  ON reactions FOR SELECT
  USING (
    CASE entity_type
      WHEN 'check_in' THEN EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.id = entity_id::uuid
        AND (
          ci.user_id = auth.uid()
          OR public.is_challenge_participant(ci.challenge_id)
        )
      )
      WHEN 'comment' THEN EXISTS (
        SELECT 1 FROM comments c
        WHERE c.id = entity_id::uuid
        AND NOT c.is_deleted
      )
      ELSE false
    END
  );

CREATE POLICY "Users can create reactions"
  ON reactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND CASE entity_type
      WHEN 'check_in' THEN EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.id = entity_id::uuid
        AND public.is_challenge_participant(ci.challenge_id)
      )
      WHEN 'comment' THEN EXISTS (
        SELECT 1 FROM comments c
        WHERE c.id = entity_id::uuid
        AND NOT c.is_deleted
      )
      ELSE false
    END
  );

CREATE POLICY "Users can delete their own reactions"
  ON reactions FOR DELETE
  USING (auth.uid() = user_id);

-- Payments policies
CREATE POLICY "Users can view their own payments"
  ON payments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can create payments"
  ON payments FOR INSERT
  WITH CHECK (true); -- Will be restricted by service role

CREATE POLICY "System can update payments"
  ON payments FOR UPDATE
  USING (true) -- Will be restricted by service role
  WITH CHECK (true);

-- Achievements policies
CREATE POLICY "Achievements are viewable by everyone"
  ON achievements FOR SELECT
  USING (
    user_id = auth.uid()
    OR shared = true
    OR (
      challenge_id IS NOT NULL
      AND public.is_challenge_participant(challenge_id)
    )
  );

CREATE POLICY "System can create achievements"
  ON achievements FOR INSERT
  WITH CHECK (true); -- Will be restricted by service role

CREATE POLICY "Users can update sharing status of their achievements"
  ON achievements FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND shared IN (true, false)
  );

-- Grant necessary permissions to authenticated users
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Grant permissions to service role for system operations
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;