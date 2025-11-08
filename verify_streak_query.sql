-- Query to verify longest streak for a user
-- Replace 'USER_EMAIL_HERE' with the actual email: abajirao@gmail.com
--
-- This calculates:
-- 1. All unique dates with activity (multiple check-ins per day = 1 day)
-- 2. Groups consecutive dates into streaks
-- 3. Finds the longest continuous streak

WITH user_lookup AS (
  -- Get user ID from email
  SELECT id, email
  FROM auth.users
  WHERE email = 'abajirao@gmail.com'
),
activity_dates AS (
  -- Get all unique dates with engagement activities (deduplicated by date)
  SELECT DISTINCT
    ea.activity_date::date AS activity_date,
    ul.email
  FROM engagement_activities ea
  INNER JOIN user_lookup ul ON ea.user_id = ul.id
  ORDER BY ea.activity_date DESC
),
date_with_row AS (
  -- Add row number to identify consecutive dates
  SELECT
    activity_date,
    email,
    ROW_NUMBER() OVER (ORDER BY activity_date) AS row_num,
    activity_date::date - INTERVAL '1 day' * ROW_NUMBER() OVER (ORDER BY activity_date) AS streak_group
  FROM activity_dates
),
streaks AS (
  -- Group consecutive dates and calculate streak length
  SELECT
    email,
    MIN(activity_date) AS streak_start,
    MAX(activity_date) AS streak_end,
    COUNT(*) AS streak_length,
    streak_group
  FROM date_with_row
  GROUP BY email, streak_group
  ORDER BY streak_length DESC
)
SELECT
  email,
  streak_start,
  streak_end,
  streak_length AS days_in_streak,
  CASE
    WHEN ROW_NUMBER() OVER (ORDER BY streak_length DESC) = 1 THEN '🏆 LONGEST STREAK'
    ELSE ''
  END AS status
FROM streaks
ORDER BY streak_length DESC, streak_end DESC;

-- Summary stats
SELECT
  ul.email,
  COUNT(DISTINCT ea.activity_date) AS total_unique_days_with_activity,
  MIN(ea.activity_date) AS first_activity_date,
  MAX(ea.activity_date) AS last_activity_date,
  COUNT(*) AS total_activities,
  (
    SELECT current_streak
    FROM engagement_streaks es
    WHERE es.user_id = ul.id
  ) AS current_streak_in_db,
  (
    SELECT longest_streak
    FROM engagement_streaks es
    WHERE es.user_id = ul.id
  ) AS longest_streak_in_db
FROM engagement_activities ea
INNER JOIN user_lookup ul ON ea.user_id = ul.id
GROUP BY ul.id, ul.email;

-- Detailed activity log (last 45 days) to manually verify
SELECT
  ea.activity_date,
  COUNT(*) AS activities_that_day,
  STRING_AGG(DISTINCT ea.activity_type, ', ' ORDER BY ea.activity_type) AS activity_types,
  ul.email
FROM engagement_activities ea
INNER JOIN user_lookup ul ON ea.user_id = ul.id
WHERE ea.activity_date >= CURRENT_DATE - INTERVAL '45 days'
GROUP BY ea.activity_date, ul.email
ORDER BY ea.activity_date DESC;

-- Check for gaps in the last 90 days to see where streaks broke
WITH user_lookup AS (
  SELECT id, email
  FROM auth.users
  WHERE email = 'abajirao@gmail.com'
),
all_dates AS (
  -- Generate all dates in the last 90 days
  SELECT
    generate_series(
      CURRENT_DATE - INTERVAL '90 days',
      CURRENT_DATE,
      INTERVAL '1 day'
    )::date AS check_date
),
activity_check AS (
  -- Check which dates have activity
  SELECT
    ad.check_date,
    CASE
      WHEN ea.activity_date IS NOT NULL THEN '✓ Activity'
      ELSE '✗ No Activity'
    END AS has_activity,
    COUNT(ea.id) AS activity_count
  FROM all_dates ad
  CROSS JOIN user_lookup ul
  LEFT JOIN engagement_activities ea
    ON ea.user_id = ul.id
    AND ea.activity_date::date = ad.check_date
  GROUP BY ad.check_date, ea.activity_date
  ORDER BY ad.check_date DESC
)
SELECT
  check_date,
  has_activity,
  activity_count,
  -- Show streak breaks
  CASE
    WHEN has_activity = '✗ No Activity'
      AND LAG(has_activity) OVER (ORDER BY check_date) = '✓ Activity'
    THEN '🔴 STREAK BREAK'
    ELSE ''
  END AS streak_status
FROM activity_check
ORDER BY check_date DESC;
