-- =============================================================================
-- FIX: Update longest_streak to match actual data
-- =============================================================================
-- This will set longest_streak = current_streak = 14 days
-- for abajirao@gmail.com
-- =============================================================================

-- First, let's see the current values
SELECT
  u.email,
  es.current_streak,
  es.longest_streak,
  es.last_engagement_date,
  es.streak_freezes_available
FROM engagement_streaks es
JOIN auth.users u ON es.user_id = u.id
WHERE u.email = 'abajirao@gmail.com';

-- Now update the longest_streak to match the actual longest (14 days)
UPDATE engagement_streaks
SET longest_streak = 14
WHERE user_id = (
  SELECT id
  FROM auth.users
  WHERE email = 'abajirao@gmail.com'
);

-- Verify the fix
SELECT
  u.email,
  es.current_streak,
  es.longest_streak,
  es.last_engagement_date,
  es.streak_freezes_available
FROM engagement_streaks es
JOIN auth.users u ON es.user_id = u.id
WHERE u.email = 'abajirao@gmail.com';
