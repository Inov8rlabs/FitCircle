-- ============================================================================
-- Daily Streak Check-In Enhancements
-- Add columns for XP tracking, freeze rewards, and check-in tracking
-- ============================================================================

-- ============================================================================
-- 1. EXTEND ENGAGEMENT_STREAKS TABLE
-- ============================================================================

-- Add total_points for XP tracking
ALTER TABLE engagement_streaks
ADD COLUMN IF NOT EXISTS total_points INTEGER DEFAULT 0 CHECK (total_points >= 0);

-- Add last_freeze_earned_at to track when last freeze was earned (every 7 days)
ALTER TABLE engagement_streaks
ADD COLUMN IF NOT EXISTS last_freeze_earned_at TIMESTAMPTZ;

-- Add comments
COMMENT ON COLUMN engagement_streaks.total_points IS 'Total XP earned from check-ins and milestones';
COMMENT ON COLUMN engagement_streaks.last_freeze_earned_at IS 'Last timestamp when freeze was earned (every 7 consecutive days)';

-- ============================================================================
-- 2. UPDATE ENGAGEMENT_ACTIVITIES TABLE
-- ============================================================================

-- Add new activity types for daily check-in tracking
-- Note: engagement_activities.activity_type already has constraint
-- We need to add new types: 'streak_checkin', 'freeze_used', 'freeze_earned'

-- Drop existing constraint
ALTER TABLE engagement_activities
DROP CONSTRAINT IF EXISTS engagement_activities_activity_type_check;

-- Add new constraint with additional types
ALTER TABLE engagement_activities
ADD CONSTRAINT engagement_activities_activity_type_check
CHECK (activity_type IN (
    'weight_log',
    'steps_log',
    'mood_log',
    'circle_checkin',
    'social_interaction',
    'streak_checkin',
    'freeze_used',
    'freeze_earned',
    'milestone_achieved'
));

-- Add metadata column for storing additional info (XP earned, milestone details, etc.)
ALTER TABLE engagement_activities
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_engagement_activities_type_date
ON engagement_activities(user_id, activity_type, activity_date DESC);

-- Add comments
COMMENT ON COLUMN engagement_activities.metadata IS 'Additional data: xp_earned, milestone_name, freeze_reason, etc.';

-- ============================================================================
-- 3. INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index for checking if user has checked in today
CREATE INDEX IF NOT EXISTS idx_engagement_activities_today_checkin
ON engagement_activities(user_id, activity_date, activity_type)
WHERE activity_type = 'streak_checkin';

-- Index for total_points queries
CREATE INDEX IF NOT EXISTS idx_engagement_streaks_points
ON engagement_streaks(user_id, total_points DESC);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Migration adds support for:
-- 1. XP/points tracking (total_points column)
-- 2. Freeze earning tracking (last_freeze_earned_at column)
-- 3. Daily check-in activity tracking (new activity_type: 'streak_checkin')
-- 4. Freeze usage tracking (new activity_type: 'freeze_used')
-- 5. Freeze earning tracking (new activity_type: 'freeze_earned')
-- 6. Milestone achievement tracking (new activity_type: 'milestone_achieved')
-- 7. Metadata storage for activity details (metadata JSONB column)
