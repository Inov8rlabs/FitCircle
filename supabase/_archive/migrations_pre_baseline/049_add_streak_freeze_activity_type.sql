-- ============================================================================
-- Migration 049: Allow 'streak_freeze' as a valid engagement_activities.activity_type
--
-- The TypeScript ActivityType (streak.ts) and iOS EngagementActivityType enum
-- both expect 'streak_freeze' for manually-applied shields. The DB CHECK
-- constraint, last touched in migration 036, only allowed the older
-- 'freeze_used'. Inserts from EngagementStreakService.applyFreeze were 500ing
-- with check-constraint code 23514:
--
--   new row for relation "engagement_activities" violates check constraint
--   "engagement_activities_activity_type_check"
--
-- Fix: extend the constraint as a superset so 'streak_freeze' is accepted
-- without invalidating any historical rows that might still carry the older
-- values. We don't drop any existing values.
-- ============================================================================

ALTER TABLE engagement_activities
DROP CONSTRAINT IF EXISTS engagement_activities_activity_type_check;

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
    'milestone_achieved',
    'exercise_log',
    'streak_freeze'
));
