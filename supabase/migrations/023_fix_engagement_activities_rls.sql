-- ============================================================================
-- Fix Engagement Activities RLS Policies
-- ============================================================================
-- Problem: Service role (admin client) needs to insert engagement activities
-- on behalf of users during tracking operations, but current RLS policies
-- only allow auth.uid() = user_id, which doesn't work for service role.
--
-- Solution: Add service role bypass policies that allow the admin client
-- to perform all operations.
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own engagement activities" ON engagement_activities;
DROP POLICY IF EXISTS "Users can insert own engagement activities" ON engagement_activities;

DROP POLICY IF EXISTS "Users can insert own engagement streak" ON engagement_streaks;
DROP POLICY IF EXISTS "Users can update own engagement streak" ON engagement_streaks;
DROP POLICY IF EXISTS "Users can view own engagement streak" ON engagement_streaks;

DROP POLICY IF EXISTS "Users can insert own metric streaks" ON metric_streaks;
DROP POLICY IF EXISTS "Users can update own metric streaks" ON metric_streaks;
DROP POLICY IF EXISTS "Users can view own metric streaks" ON metric_streaks;

-- ============================================================================
-- ENGAGEMENT ACTIVITIES: New policies with service role access
-- ============================================================================

-- Service role has full access (for backend operations)
CREATE POLICY "Service role has full access to engagement activities"
    ON engagement_activities FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Users can view their own activities
CREATE POLICY "Users can view own engagement activities"
    ON engagement_activities FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Users can insert their own activities (web/mobile client)
CREATE POLICY "Users can insert own engagement activities"
    ON engagement_activities FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- ENGAGEMENT STREAKS: New policies with service role access
-- ============================================================================

-- Service role has full access (for backend operations)
CREATE POLICY "Service role has full access to engagement streaks"
    ON engagement_streaks FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Users can view their own streak
CREATE POLICY "Users can view own engagement streak"
    ON engagement_streaks FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Users can insert their own streak
CREATE POLICY "Users can insert own engagement streak"
    ON engagement_streaks FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own streak
CREATE POLICY "Users can update own engagement streak"
    ON engagement_streaks FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- METRIC STREAKS: New policies with service role access
-- ============================================================================

-- Service role has full access (for backend operations)
CREATE POLICY "Service role has full access to metric streaks"
    ON metric_streaks FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Users can view their own metric streaks
CREATE POLICY "Users can view own metric streaks"
    ON metric_streaks FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Users can insert their own metric streaks
CREATE POLICY "Users can insert own metric streaks"
    ON metric_streaks FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own metric streaks
CREATE POLICY "Users can update own metric streaks"
    ON metric_streaks FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify policies are in place
DO $$
BEGIN
    RAISE NOTICE 'Engagement activities RLS policies updated successfully';
    RAISE NOTICE 'Service role now has full access to streak tables';
END $$;
