-- Fix for ambiguous column reference error in progress functions
-- Run this in Supabase SQL Editor

-- Drop existing functions to recreate them
DROP FUNCTION IF EXISTS get_user_circles_with_progress();
DROP FUNCTION IF EXISTS get_participant_progress(UUID, UUID);
DROP FUNCTION IF EXISTS get_progress_history(UUID, UUID);

-- Create fixed function for getting user circles with progress
CREATE OR REPLACE FUNCTION get_user_circles_with_progress()
RETURNS TABLE (
    challenge_id UUID,
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
        c.id as challenge_id,
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

-- Create fixed function for getting participant progress
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
            c.creator_id as creator_id
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

-- Create fixed function for getting progress history
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_circles_with_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION get_participant_progress(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_progress_history(UUID, UUID) TO authenticated;
