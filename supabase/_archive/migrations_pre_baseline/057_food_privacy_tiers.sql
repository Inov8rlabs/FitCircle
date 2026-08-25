-- Migration 057: three-tier per-circle food privacy
-- PRD v4 §6.4 (privacy tiers) / §7.2.1, §7.7 (fail-closed, server-side filtering).
--
-- ADDITIVE ONLY. Upgrades the legacy binary per-entry privacy (is_private/visibility on
-- food_log_entries, migration 031 — left untouched) to THREE tiers chosen PER CIRCLE:
--   full    — the circle sees every log (photo, food name, calories, macros)
--   summary — daily totals only (calories, adherence); no individual meals
--   private — nothing food-related (the user still appears on non-food social surfaces)
-- Per-circle (not per-log) avoids decision fatigue; the per-log "hide this" override on
-- food_log_entries is retained. Default = 'summary' for circles a user hasn't configured:
-- the ABSENCE of a row means 'summary', and getTier() applies that default in code. This
-- table only stores explicit choices, so it stays sparse and the default is centralized.

CREATE TABLE IF NOT EXISTS circle_food_privacy (
  fitcircle_id uuid NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  tier         text NOT NULL DEFAULT 'summary'
                 CHECK (tier IN ('full','summary','private')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fitcircle_id, user_id)
);

-- Lookup the tiers for all members of a circle (the feed/leaderboard fetch path).
CREATE INDEX IF NOT EXISTS idx_circle_food_privacy_circle
  ON circle_food_privacy (fitcircle_id);

-- updated_at trigger (project convention; update_updated_at() exists since 001).
CREATE TRIGGER trg_circle_food_privacy_updated_at
  BEFORE UPDATE ON circle_food_privacy
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: a user may read AND write ONLY their own rows (auth.uid() = user_id).
-- A member must never set or read another member's tier. The actual privacy
-- *enforcement* (stripping food data for viewers) is done server-side by
-- FoodPrivacyService.filterEntriesForCircle via the service-role client; these
-- policies just guarantee the per-user ownership of the tier choice itself.
-- ----------------------------------------------------------------------------
ALTER TABLE circle_food_privacy ENABLE ROW LEVEL SECURITY;

CREATE POLICY circle_food_privacy_select_own ON circle_food_privacy
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY circle_food_privacy_insert_own ON circle_food_privacy
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY circle_food_privacy_update_own ON circle_food_privacy
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY circle_food_privacy_delete_own ON circle_food_privacy
  FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON circle_food_privacy TO authenticated;

COMMENT ON TABLE circle_food_privacy IS
  'Per-circle per-user food privacy tier (full|summary|private), PRD §6.4. Absent row = summary (default applied in code). Enforcement is server-side in FoodPrivacyService.';
COMMENT ON COLUMN circle_food_privacy.tier IS
  'full = sees every log incl photo/name/macros; summary = daily totals only; private = nothing food-related.';
