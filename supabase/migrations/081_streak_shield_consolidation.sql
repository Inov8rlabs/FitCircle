-- ============================================================================
-- 081: STREAK SHIELD CONSOLIDATION
-- (written as 078 on 2026-08-03 but never applied; renumbered because 078
--  was taken by restore_consent_management in the 2026-08-04 baseline push)
-- ============================================================================
-- The app previously kept TWO independent shield inventories:
--   1. streak_shields (rows per user per type)            — claim system
--   2. engagement_streaks.streak_freezes_available (int)  — engagement system
-- Different endpoints consumed different inventories and they never
-- reconciled. From this migration on:
--   * streak_shields is the ONLY inventory (owned by StreakShieldService)
--   * engagement_streaks.streak_freezes_available becomes a read-only MIRROR
--     of the total, kept in sync by the service layer for legacy clients
--   * weekly free-freeze gifts are gone — shields are EARNED by streak
--     milestones (+1 per 7-day, +1 extra per 30-day boundary), banked to a
--     cap of 3; Pro users have unlimited shields (never decremented)
-- Data migration below folds the larger of the two balances into
-- streak_shields so nobody loses shields they could see in either UI.
-- ============================================================================

-- 1. Ensure every user has the three shield rows. Users with NO rows yet get
--    the starter freeze (SHIELD_RULES.STARTER_SHIELDS = 1), exactly what
--    StreakShieldService.getInventory would seed on first touch — seeding 0
--    here would silently cost them that starter shield.
INSERT INTO streak_shields (user_id, shield_type, available_count)
SELECT p.id,
       t.shield_type,
       CASE
         WHEN t.shield_type = 'freeze'
          AND NOT EXISTS (SELECT 1 FROM streak_shields s WHERE s.user_id = p.id)
         THEN 1
         ELSE 0
       END
FROM profiles p
CROSS JOIN (VALUES ('freeze'), ('milestone_shield'), ('purchased')) AS t(shield_type)
ON CONFLICT (user_id, shield_type) DO NOTHING;

-- 2. Fold the legacy engagement_streaks balance into the freeze row.
--    Take the GREATEST of the two (summing would double-count the same
--    conceptual freeze shown in both UIs).
UPDATE streak_shields ss
SET available_count = GREATEST(
      ss.available_count,
      COALESCE(es.streak_freezes_available, 0)
    )
FROM engagement_streaks es
WHERE es.user_id = ss.user_id
  AND ss.shield_type = 'freeze';

-- 3. Cap total banked shields at the new maximum (3), draining in reverse
--    consumption order (purchased last so paid shields survive).
WITH totals AS (
  SELECT user_id, SUM(available_count) AS total
  FROM streak_shields
  GROUP BY user_id
  HAVING SUM(available_count) > 3
),
capped AS (
  SELECT
    ss.user_id,
    ss.shield_type,
    ss.available_count,
    SUM(ss.available_count) OVER (
      PARTITION BY ss.user_id
      ORDER BY CASE ss.shield_type
        WHEN 'purchased' THEN 1
        WHEN 'milestone_shield' THEN 2
        WHEN 'freeze' THEN 3
      END
    ) AS running_total
  FROM streak_shields ss
  JOIN totals t ON t.user_id = ss.user_id
)
UPDATE streak_shields ss
SET available_count = GREATEST(
      0,
      LEAST(ss.available_count, 3 - (c.running_total - c.available_count))
    )
FROM capped c
WHERE c.user_id = ss.user_id
  AND c.shield_type = ss.shield_type;

-- 4. Mirror the consolidated total back into the legacy column so
--    pre-update mobile clients keep displaying a truthful count.
UPDATE engagement_streaks es
SET streak_freezes_available = COALESCE(t.total, 0)
FROM (
  SELECT user_id, LEAST(SUM(available_count), 3)::int AS total
  FROM streak_shields
  GROUP BY user_id
) t
WHERE t.user_id = es.user_id;

-- 5. Documentation
COMMENT ON TABLE streak_shields IS
  'THE shield inventory (single source of truth, owned by StreakShieldService). Earned via streak milestones (+1/7-day, +1/30-day), capped at 3. Pro users are unlimited and never decrement.';
COMMENT ON COLUMN engagement_streaks.streak_freezes_available IS
  'READ-ONLY MIRROR of streak_shields total for legacy clients. Written only by StreakShieldService.mirrorLegacyBalance.';
COMMENT ON COLUMN engagement_streaks.streak_freezes_used_this_week IS
  'DEPRECATED (weekly freeze model removed in 081). Not read by current code.';
COMMENT ON COLUMN engagement_streaks.auto_freeze_reset_date IS
  'DEPRECATED (weekly freeze model removed in 081). Not read by current code.';
COMMENT ON COLUMN engagement_streaks.shields_available IS
  'DEPRECATED legacy field (superseded by streak_shields in 029, formally dead since 081).';
