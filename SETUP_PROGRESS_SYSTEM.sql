-- Complete setup script for FitCircle progress system
-- Run this in Supabase SQL Editor to set up all progress tracking functionality

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
DROP POLICY IF EXISTS "Users can view own progress" ON progress_entries;
CREATE POLICY "Users can view own progress"
ON progress_entries FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can view public entries from other participants in their challenges
DROP POLICY IF EXISTS "Users can view public progress in their challenges" ON progress_entries;
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
DROP POLICY IF EXISTS "Challenge creators can view all progress" ON progress_entries;
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
DROP POLICY IF EXISTS "Users can insert own progress" ON progress_entries;
CREATE POLICY "Users can insert own progress"
ON progress_entries FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can update their own progress entries
DROP POLICY IF EXISTS "Users can update own progress" ON progress_entries;
CREATE POLICY "Users can update own progress"
ON progress_entries FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Users can delete their own progress entries
DROP POLICY IF EXISTS "Users can delete own progress" ON progress_entries;
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

DROP TRIGGER IF EXISTS update_progress_entries_updated_at ON progress_entries;
CREATE TRIGGER update_progress_entries_updated_at
    BEFORE UPDATE ON progress_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT ON progress_entries TO authenticated;
GRANT INSERT, UPDATE, DELETE ON progress_entries TO authenticated;

-- ============================================================================
-- 7. SUCCESS MESSAGE
-- ============================================================================

SELECT 'Progress tracking system setup complete!' as status;
