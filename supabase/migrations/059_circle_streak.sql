-- Migration 059: Circle Streak + food streak mechanics — PRD v4 §6.13.
--
-- ADDITIVE ONLY. No existing table is altered or dropped. Two new tables:
--
--   1. `circle_streaks`       — one row per circle holding its COLLECTIVE streak.
--                               A circle earns a streak for consecutive days where
--                               MOST of its active members log a calorie-bearing food
--                               entry (shared, gentle accountability — §6.13).
--   2. `circle_streak_saves`  — pro-social "streak save": a member can cover for another
--                               member once per period (per covered member per save_date),
--                               making the covered member count as "logged" for that day's
--                               recompute. Consistent with the forgiveness principle —
--                               never punish a lapse, let the circle carry each other.
--
-- "MOST members" is defined as a STRICT MAJORITY: > 50% of active members logged that day.
-- The threshold in code is ceil((activeMembers + 1) / 2), i.e. the smallest integer that
-- is strictly greater than half. (1 member -> 1, 2 -> 2, 3 -> 2, 4 -> 3, 5 -> 3 ...)
--
-- Grounding (verified against the live schema 2026-06-01):
--   * Circle      = `fitcircles(id uuid)`
--   * Membership  = `fitcircle_members(fitcircle_id uuid, user_id uuid, status text)`,
--                    ACTIVE = status = 'active'
--   * Food log    = `food_log_entries(user_id uuid, entry_date date, calories numeric,
--                    deleted_at timestamptz)`; a "log" for streak purposes is a
--                    non-deleted entry with calories IS NOT NULL on entry_date.
--   * User FK     = `profiles(id)`
--
-- No stored procedures / business-logic triggers (CLAUDE.md hard rule). DB-side
-- constructs are limited to: two tables, indexes, RLS policies (inline membership
-- predicates), grants, and the project-standard updated_at timestamp trigger
-- (update_updated_at() exists since migration 001). All streak math lives in
-- CircleStreakService — the DB only stores state.

-- ----------------------------------------------------------------------------
-- circle_streaks — the circle's collective streak state (one row per circle)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_streaks (
    fitcircle_id     uuid PRIMARY KEY REFERENCES fitcircles(id) ON DELETE CASCADE,
    current_streak   integer NOT NULL DEFAULT 0,
    longest_streak   integer NOT NULL DEFAULT 0,
    last_active_date date,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE circle_streaks ENABLE ROW LEVEL SECURITY;

-- Active members of the circle can read their circle's streak.
CREATE POLICY circle_streaks_member_select ON circle_streaks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM fitcircle_members m
            WHERE m.fitcircle_id = circle_streaks.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- updated_at maintenance (project convention; function exists since migration 001).
CREATE TRIGGER trg_circle_streaks_updated_at
    BEFORE UPDATE ON circle_streaks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- circle_streak_saves — a pro-social "cover for a member" once per period (§6.13)
-- ----------------------------------------------------------------------------
-- A save makes `covered_user_id` count as having logged on `save_date` for that
-- day's recompute. The unique(fitcircle_id, covered_user_id, save_date) constraint
-- enforces "once per covered member per period" (period = day): a given member can
-- be covered at most once on a given day, in a given circle.
CREATE TABLE IF NOT EXISTS circle_streak_saves (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fitcircle_id    uuid NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
    saver_user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    covered_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    save_date       date NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (fitcircle_id, covered_user_id, save_date)
);

CREATE INDEX IF NOT EXISTS idx_circle_streak_saves_circle_date
    ON circle_streak_saves (fitcircle_id, save_date);

ALTER TABLE circle_streak_saves ENABLE ROW LEVEL SECURITY;

-- Active members of the circle can read saves within their circle.
CREATE POLICY circle_streak_saves_member_select ON circle_streak_saves
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM fitcircle_members m
            WHERE m.fitcircle_id = circle_streak_saves.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- An active member may record a save AS THEMSELVES (saver_user_id = caller), covering
-- another active member of the SAME circle. The covered member must also be active.
CREATE POLICY circle_streak_saves_member_insert ON circle_streak_saves
    FOR INSERT
    WITH CHECK (
        saver_user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM fitcircle_members saver_m
            WHERE saver_m.fitcircle_id = circle_streak_saves.fitcircle_id
              AND saver_m.user_id = auth.uid()
              AND saver_m.status = 'active'
        )
        AND EXISTS (
            SELECT 1
            FROM fitcircle_members covered_m
            WHERE covered_m.fitcircle_id = circle_streak_saves.fitcircle_id
              AND covered_m.user_id = circle_streak_saves.covered_user_id
              AND covered_m.status = 'active'
        )
    );

-- ----------------------------------------------------------------------------
-- Grants (RLS still governs row visibility; these grant table-level access).
-- The service uses the admin/service-role client which bypasses RLS; these grants
-- + policies are defense in depth for any RLS-scoped client access.
-- ----------------------------------------------------------------------------
GRANT SELECT ON circle_streaks TO authenticated;
GRANT SELECT, INSERT ON circle_streak_saves TO authenticated;
