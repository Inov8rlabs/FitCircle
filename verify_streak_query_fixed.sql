-- =============================================================================
-- QUERY 1: Calculate All Streaks and Find the Longest
-- =============================================================================
-- Run this first to see all streaks the user has had
-- This will show if 26 days is really the longest streak
-- =============================================================================

WITH user_lookup AS (
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
  ORDER BY ea.activity_date
),
date_with_row AS (
  -- Add row number to identify consecutive dates
  SELECT
    activity_date,
    email,
    ROW_NUMBER() OVER (ORDER BY activity_date) AS row_num,
    activity_date::date - (ROW_NUMBER() OVER (ORDER BY activity_date) * INTERVAL '1 day') AS streak_group
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


-- =============================================================================
-- QUERY 2: Summary Statistics
-- =============================================================================
-- Run this second to see overall stats and compare to database values
-- =============================================================================

WITH user_lookup AS (
  SELECT id, email
  FROM auth.users
  WHERE email = 'abajirao@gmail.com'
)
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


-- =============================================================================
-- QUERY 3: Daily Activity Log (Last 45 Days)
-- =============================================================================
-- Run this third to see recent daily activities
-- =============================================================================

WITH user_lookup AS (
  SELECT id, email
  FROM auth.users
  WHERE email = 'abajirao@gmail.com'
)
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


-- =============================================================================
-- QUERY 4: Gap Analysis (Last 90 Days)
-- =============================================================================
-- Run this fourth to see every day and identify streak breaks
-- =============================================================================

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
      WHEN COUNT(ea.id) > 0 THEN '✓ Activity'
      ELSE '✗ No Activity'
    END AS has_activity,
    COUNT(ea.id) AS activity_count
  FROM all_dates ad
  CROSS JOIN user_lookup ul
  LEFT JOIN engagement_activities ea
    ON ea.user_id = ul.id
    AND ea.activity_date::date = ad.check_date
  GROUP BY ad.check_date
  ORDER BY ad.check_date DESC
)
SELECT
  check_date,
  TO_CHAR(check_date, 'Dy') AS day_of_week,
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


-- =============================================================================
-- BONUS QUERY: Current Streak Verification
-- =============================================================================
-- Run this to verify the current 14-day streak by counting backwards from today
-- =============================================================================

WITH user_lookup AS (
  SELECT id, email
  FROM auth.users
  WHERE email = 'abajirao@gmail.com'
),
recent_activities AS (
  SELECT DISTINCT
    ea.activity_date::date AS activity_date
  FROM engagement_activities ea
  INNER JOIN user_lookup ul ON ea.user_id = ul.id
  WHERE ea.activity_date >= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY ea.activity_date DESC
),
days_series AS (
  SELECT
    generate_series(
      CURRENT_DATE,
      CURRENT_DATE - INTERVAL '30 days',
      -INTERVAL '1 day'
    )::date AS check_date
),
streak_check AS (
  SELECT
    ds.check_date,
    CASE WHEN ra.activity_date IS NOT NULL THEN 1 ELSE 0 END AS has_activity,
    ROW_NUMBER() OVER (ORDER BY ds.check_date DESC) - 1 AS days_ago
  FROM days_series ds
  LEFT JOIN recent_activities ra ON ds.check_date = ra.activity_date
  ORDER BY ds.check_date DESC
)
SELECT
  check_date,
  TO_CHAR(check_date, 'Dy, Mon DD') AS formatted_date,
  days_ago,
  CASE
    WHEN has_activity = 1 THEN '✓ Checked In'
    WHEN days_ago = 0 THEN '○ Today (no activity yet)'
    ELSE '✗ No Activity'
  END AS status,
  -- Calculate current streak
  CASE
    WHEN days_ago = 0 AND has_activity = 0 THEN 'Today - no activity yet (doesn''t break streak)'
    WHEN SUM(CASE WHEN has_activity = 0 AND days_ago > 0 THEN 1 ELSE 0 END)
         OVER (ORDER BY check_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) > 0
    THEN 'Streak ended here'
    ELSE 'Part of current streak'
  END AS streak_analysis
FROM streak_check
ORDER BY check_date DESC
LIMIT 20;
