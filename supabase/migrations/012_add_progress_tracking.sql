-- Migration 012: Add progress tracking for FitCircles
-- This migration adds tables and functions for tracking user progress in challenges

-- ============================================================================
-- 1. CREATE PROGRESS ENTRIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS progress_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    value DECIMAL(10,2) NOT NULL CHECK (value >= 0),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_public BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one entry per user per challenge per day
    UNIQUE(user_id, challenge_id, date)
);

-- ============================================================================
-- 2. CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_progress_entries_user_challenge ON progress_entries(user_id, challenge_id);
CREATE INDEX IF NOT EXISTS idx_progress_entries_challenge_date ON progress_entries(challenge_id, date);
CREATE INDEX IF NOT EXISTS idx_progress_entries_public ON progress_entries(is_public) WHERE is_public = true;

-- ============================================================================
-- 3. ENABLE RLS ON PROGRESS ENTRIES
-- ============================================================================

ALTER TABLE progress_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. CREATE RLS POLICIES FOR PROGRESS ENTRIES
-- ============================================================================

-- Users can view their own entries
CREATE POLICY "Users can view own progress"
ON progress_entries FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can view public entries from other participants in their challenges
CREATE POLICY "Users can view public progress in their challenges"
ON progress_entries FOR SELECT
TO authenticated
USING (
    is_public = true
    AND EXISTS (
        SELECT 1 FROM challenge_participants cp
        WHERE cp.challenge_id = progress_entries.challenge_id
        AND cp.user_id = auth.uid()
        AND cp.status = 'active'
    )
);

-- Challenge creators can view all entries in their challenges
CREATE POLICY "Challenge creators can view all progress"
ON progress_entries FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM challenges c
        WHERE c.id = progress_entries.challenge_id
        AND c.creator_id = auth.uid()
    )
);

-- Users can insert their own progress entries
CREATE POLICY "Users can insert own progress"
ON progress_entries FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can update their own progress entries
CREATE POLICY "Users can update own progress"
ON progress_entries FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Users can delete their own progress entries
CREATE POLICY "Users can delete own progress"
ON progress_entries FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- ============================================================================
-- 5. CREATE UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_progress_entries_updated_at
    BEFORE UPDATE ON progress_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. CREATE HELPER FUNCTION FOR GETTING USER CIRCLES WITH PROGRESS
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_circles_with_progress();

CREATE OR REPLACE FUNCTION get_user_circles_with_progress()
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    type challenge_type,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    creator_id UUID,
    invite_code VARCHAR(10),
    visibility challenge_visibility,
    max_participants INTEGER,
    created_at TIMESTAMPTZ,
    participant_count BIGINT,
    is_creator BOOLEAN,
    is_participant BOOLEAN,
    latest_progress DECIMAL(10,2),
    total_entries BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.name,
        c.description,
        c.type,
        c.start_date,
        c.end_date,
        c.creator_id,
        c.invite_code,
        c.visibility,
        c.max_participants,
        c.created_at,
        COALESCE(participant_counts.participant_count, 0) as participant_count,
        (c.creator_id = auth.uid()) as is_creator,
        EXISTS(
            SELECT 1 FROM challenge_participants cp2
            WHERE cp2.challenge_id = c.id
            AND cp2.user_id = auth.uid()
            AND cp2.status = 'active'
        ) as is_participant,
        COALESCE(user_progress.latest_progress, 0) as latest_progress,
        COALESCE(user_progress.total_entries, 0) as total_entries
    FROM challenges c
    LEFT JOIN (
        SELECT
            cp.challenge_id,
            COUNT(DISTINCT cp.user_id) as participant_count
        FROM challenge_participants cp
        WHERE cp.status = 'active'
        GROUP BY cp.challenge_id
    ) participant_counts ON c.id = participant_counts.challenge_id
    LEFT JOIN (
        SELECT
            pe.challenge_id,
            pe.value as latest_progress,
            COUNT(*) as total_entries
        FROM progress_entries pe
        WHERE pe.user_id = auth.uid()
        GROUP BY pe.challenge_id, pe.value
        ORDER BY MAX(pe.date) DESC
        LIMIT 1
    ) user_progress ON c.id = user_progress.challenge_id
    WHERE c.creator_id = auth.uid()
       OR EXISTS (
           SELECT 1 FROM challenge_participants cp
           WHERE cp.challenge_id = c.id
           AND cp.user_id = auth.uid()
           AND cp.status = 'active'
       )
       OR c.visibility = 'public'
    ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. CREATE FUNCTION TO GET PARTICIPANT PROGRESS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_participant_progress(p_challenge_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
    participant_id UUID,
    user_id UUID,
    display_name TEXT,
    avatar_url TEXT,
    latest_value DECIMAL(10,2),
    latest_date DATE,
    total_entries BIGINT,
    is_public BOOLEAN,
    is_creator BOOLEAN,
    is_current_user BOOLEAN,
    progress_percentage DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH participant_list AS (
        -- Get active participants in the challenge
        SELECT DISTINCT
            cp.id as participant_id,
            cp.user_id,
            COALESCE(p.display_name, 'Unknown User') as display_name,
            COALESCE(p.avatar_url, '') as avatar_url,
            c.creator_id
        FROM challenge_participants cp
        LEFT JOIN profiles p ON cp.user_id = p.id
        JOIN challenges c ON cp.challenge_id = c.id
        WHERE cp.challenge_id = p_challenge_id
          AND cp.status = 'active'
          AND (p_user_id IS NULL OR cp.user_id = p_user_id)
    ),
    latest_entries AS (
        -- Get latest entry for each participant
        SELECT DISTINCT ON (pe.user_id)
            pe.user_id,
            pe.value as latest_value,
            pe.date as latest_date,
            pe.is_public,
            COUNT(*) OVER (PARTITION BY pe.user_id) as total_entries
        FROM progress_entries pe
        WHERE pe.challenge_id = p_challenge_id
          AND pe.user_id IN (SELECT user_id FROM participant_list)
        ORDER BY pe.user_id, pe.date DESC
    )
    SELECT
        pl.participant_id,
        pl.user_id,
        pl.display_name,
        pl.avatar_url,
        COALESCE(le.latest_value, 0) as latest_value,
        COALESCE(le.latest_date, CURRENT_DATE) as latest_date,
        COALESCE(le.total_entries, 0) as total_entries,
        COALESCE(le.is_public, false) as is_public,
        (pl.creator_id = pl.user_id) as is_creator,
        (pl.user_id = auth.uid()) as is_current_user,
        CASE
            WHEN le.latest_value IS NOT NULL AND le.latest_value > 0
            THEN LEAST(100.0, (le.latest_value / 100.0) * 100)
            ELSE 0
        END as progress_percentage
    FROM participant_list pl
    LEFT JOIN latest_entries le ON pl.user_id = le.user_id
    ORDER BY
        CASE WHEN pl.creator_id = pl.user_id THEN 0 ELSE 1 END, -- Creators first
        COALESCE(le.latest_value, 0) DESC; -- Then by progress
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. CREATE FUNCTION TO GET PROGRESS HISTORY
-- ============================================================================

CREATE OR REPLACE FUNCTION get_progress_history(p_challenge_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    value DECIMAL(10,2),
    date DATE,
    is_public BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pe.id,
        pe.value,
        pe.date,
        pe.is_public,
        pe.created_at
    FROM progress_entries pe
    WHERE pe.challenge_id = p_challenge_id
      AND (p_user_id IS NULL OR pe.user_id = p_user_id)
      AND (
          -- Show own entries always
          pe.user_id = auth.uid()
          -- Show public entries if user is in the challenge
          OR (pe.is_public = true AND EXISTS (
              SELECT 1 FROM challenge_participants cp
              WHERE cp.challenge_id = pe.challenge_id
              AND cp.user_id = auth.uid()
              AND cp.status = 'active'
          ))
          -- Show all entries if user is the creator
          OR EXISTS (
              SELECT 1 FROM challenges c
              WHERE c.id = pe.challenge_id
              AND c.creator_id = auth.uid()
          )
      )
    ORDER BY pe.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT ON progress_entries TO authenticated;
GRANT INSERT, UPDATE, DELETE ON progress_entries TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_circles_with_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION get_participant_progress(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_progress_history(UUID, UUID) TO authenticated;

-- ============================================================================
-- 10. CREATE SAMPLE DATA FOR TESTING (Optional - remove in production)
-- ============================================================================

-- Uncomment the following section if you want to add sample data for testing:

-- INSERT INTO progress_entries (user_id, challenge_id, value, date, is_public) VALUES
--   ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 75.5, CURRENT_DATE - INTERVAL '2 days', true),
--   ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 78.2, CURRENT_DATE - INTERVAL '1 day', true),
--   ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 82.1, CURRENT_DATE, false);

COMMENT ON TABLE progress_entries IS 'Stores user progress entries for FitCircle challenges';
COMMENT ON FUNCTION get_user_circles_with_progress() IS 'Gets user circles with their latest progress data';
COMMENT ON FUNCTION get_participant_progress(UUID, UUID) IS 'Gets participant progress data for a specific challenge';
COMMENT ON FUNCTION get_progress_history(UUID, UUID) IS 'Gets progress history for a user in a challenge';
