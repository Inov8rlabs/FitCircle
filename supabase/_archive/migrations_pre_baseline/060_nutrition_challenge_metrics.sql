-- Migration 060: Nutrition-driven challenge metrics (PRD v4 §6.5)
-- ADDITIVE ONLY. No existing table is altered or dropped. One new table:
-- `nutrition_challenge_config` — links an EXISTING challenge (fitcircles row) to a
-- single nutrition metric so the challenge type reshapes what nutrition data is
-- tracked/ranked:
--   weight_loss   -> calorie_target (calorie ring + weight)
--   muscle_gain   -> protein_target (avg protein vs target)
--   "vegetarian"  -> veg_days       (meal categorization)
--   "sober month" -> sober_days     (yes/no daily check-in via beverage abv flag)
--   marathon prep -> carb_target    (carbs + active calories)
--   daily / other -> standard       (standard nutrition view)
--
-- This REUSES the existing challenge library (fitcircles + fitcircle_members). It
-- does NOT touch the challenge services or their tables. Computation lives entirely
-- in TypeScript (NutritionChallengeService). This table only stores configuration.
--
-- HEALTHY-ENGAGEMENT (PRD §6.7 — hard requirement):
-- target_value is a goal to HIT / adhere to, never a "less is better" target. All
-- ranking in the service is on adherence / consistency, never on eating least.
--
-- Grounding (verified against live schema 2026-06-01):
--   * Circle / challenge = `fitcircles(id, creator_id, start_date, end_date, type, status)`
--   * Membership         = `fitcircle_members(fitcircle_id, user_id, status)`, ACTIVE = 'active'
--   * Owner / writer     = `fitcircles.creator_id`
--   * Shared trigger fn  = `update_updated_at()` (used by migration 056)
--
-- No stored procedures / business-logic triggers (CLAUDE.md hard rule). DB-side
-- constructs are limited to: one table, RLS policies (inline membership predicates),
-- the shared updated_at timestamp trigger, and grants.

-- ----------------------------------------------------------------------------
-- nutrition_challenge_config — one nutrition metric per challenge (fitcircle)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nutrition_challenge_config (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fitcircle_id uuid NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,

    -- Which nutrition metric this challenge tracks. Reshapes the tracked view (§6.5).
    metric_type  text NOT NULL CHECK (metric_type IN (
        'calorie_target',  -- days within calorie target (weight-loss)
        'protein_target',  -- avg protein vs target (muscle-gain)
        'carb_target',     -- avg carbs vs target (marathon-prep)
        'veg_days',        -- count of fully-vegetarian logged days
        'sober_days',      -- count of days with no alcohol beverage_logs
        'standard'         -- standard nutrition view (daily challenge / default)
    )),

    -- The goal to HIT / adhere to (e.g. kcal/day, grams protein/day). NULL for
    -- metrics that need no numeric target (veg_days, sober_days, standard).
    target_value numeric NULL CHECK (target_value IS NULL OR target_value >= 0),

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    -- One nutrition metric per challenge (upsert target).
    UNIQUE (fitcircle_id)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_challenge_config_fitcircle
    ON nutrition_challenge_config (fitcircle_id);

-- Keep updated_at fresh on upsert/update (shared trigger fn used across the schema).
DROP TRIGGER IF EXISTS update_nutrition_challenge_config_updated_at ON nutrition_challenge_config;
CREATE TRIGGER update_nutrition_challenge_config_updated_at
    BEFORE UPDATE ON nutrition_challenge_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: active members of the circle may READ the config; only the circle creator
-- may WRITE it. The service uses the admin client (bypasses RLS) after explicit
-- in-code auth checks, mirroring the rest of the nutrition surface; these policies
-- protect any direct authenticated access (defense in depth).
-- ----------------------------------------------------------------------------
ALTER TABLE nutrition_challenge_config ENABLE ROW LEVEL SECURITY;

-- Read: any active member of the circle.
DROP POLICY IF EXISTS nutrition_challenge_config_member_select ON nutrition_challenge_config;
CREATE POLICY nutrition_challenge_config_member_select
    ON nutrition_challenge_config FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM fitcircle_members m
            WHERE m.fitcircle_id = nutrition_challenge_config.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- Insert: only the circle creator.
DROP POLICY IF EXISTS nutrition_challenge_config_creator_insert ON nutrition_challenge_config;
CREATE POLICY nutrition_challenge_config_creator_insert
    ON nutrition_challenge_config FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM fitcircles f
            WHERE f.id = nutrition_challenge_config.fitcircle_id
              AND f.creator_id = auth.uid()
        )
    );

-- Update: only the circle creator.
DROP POLICY IF EXISTS nutrition_challenge_config_creator_update ON nutrition_challenge_config;
CREATE POLICY nutrition_challenge_config_creator_update
    ON nutrition_challenge_config FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM fitcircles f
            WHERE f.id = nutrition_challenge_config.fitcircle_id
              AND f.creator_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM fitcircles f
            WHERE f.id = nutrition_challenge_config.fitcircle_id
              AND f.creator_id = auth.uid()
        )
    );

-- Delete: only the circle creator.
DROP POLICY IF EXISTS nutrition_challenge_config_creator_delete ON nutrition_challenge_config;
CREATE POLICY nutrition_challenge_config_creator_delete
    ON nutrition_challenge_config FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM fitcircles f
            WHERE f.id = nutrition_challenge_config.fitcircle_id
              AND f.creator_id = auth.uid()
        )
    );

-- ----------------------------------------------------------------------------
-- Grants (RLS still governs row visibility; these grant table-level access).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON nutrition_challenge_config TO authenticated;

COMMENT ON TABLE nutrition_challenge_config IS
  'PRD §6.5 nutrition-driven challenge metrics: links a challenge (fitcircle) to one nutrition metric. Active members read; creator writes. Progress computed in NutritionChallengeService (TS); ranking is adherence/consistency only (§6.7), never restriction.';
COMMENT ON COLUMN nutrition_challenge_config.target_value IS
  'Goal to HIT/adhere to (e.g. kcal or grams per day). Never a less-is-better target (§6.7). NULL for veg_days/sober_days/standard.';
