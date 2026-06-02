-- Migration 056: Plate Score (PRD v4 §6.8)
-- ADDITIVE ONLY. Introduces a per-user, per-day "Plate Score": a single glanceable
-- 0–100 daily nutrition score that abstracts macros into one friendly, non-triggering
-- number. It is the default circle-visible metric for non-athletes (more shareable +
-- less triggering than raw calories; athletes can still opt into full macros).
--
-- HEALTHY-ENGAGEMENT (PRD §6.7 — hard requirement):
-- The score is NOT a restriction metric. It rewards LOGGING + balanced macros +
-- HITTING (not undershooting) goals. Eating less for its own sake never raises the
-- score. All scoring logic lives in TypeScript (PlateScoreService) — this table is a
-- cache of computed results, not a stored procedure. Nothing here ranks by calorie
-- deficit. The `breakdown` JSONB exists for full transparency back to the user.
--
-- Nothing is dropped or altered. New table only, with RLS so users see only their own.

CREATE TABLE IF NOT EXISTS plate_scores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score_date         date NOT NULL,

  -- Final 0–100 glanceable score (transparent blend of the three components below).
  score              integer NOT NULL CHECK (score >= 0 AND score <= 100),

  -- The three transparent inputs, each normalized to 0–100 before weighting.
  --  adherence  = did they log today (scaled by meal coverage), never "ate little".
  --  balance    = how reasonable the macro distribution is (variety/balance).
  --  goalfit    = alignment to any active challenge/goal target; rewards HITTING it.
  adherence_component numeric NOT NULL DEFAULT 0 CHECK (adherence_component >= 0 AND adherence_component <= 100),
  balance_component   numeric NOT NULL DEFAULT 0 CHECK (balance_component   >= 0 AND balance_component   <= 100),
  goalfit_component   numeric NOT NULL DEFAULT 0 CHECK (goalfit_component   >= 0 AND goalfit_component   <= 100),

  -- Full transparency payload: weights used, raw macro totals, and friendly,
  -- non-punitive notes. Rendered to the user verbatim; never contains shaming copy.
  breakdown          jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, score_date)
);

-- Power the per-user history range query (newest first).
CREATE INDEX IF NOT EXISTS idx_plate_scores_user_date
  ON plate_scores (user_id, score_date DESC);

-- Keep updated_at fresh on upsert/update (shared trigger fn used across the schema).
DROP TRIGGER IF EXISTS update_plate_scores_updated_at ON plate_scores;
CREATE TRIGGER update_plate_scores_updated_at
  BEFORE UPDATE ON plate_scores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: users can read/write ONLY their own plate scores. The service uses the
-- admin client (bypasses RLS) after explicit auth, mirroring the rest of the
-- nutrition surface; these policies protect any direct authenticated access.
-- ----------------------------------------------------------------------------
ALTER TABLE plate_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plate_scores_select_own ON plate_scores;
CREATE POLICY plate_scores_select_own
  ON plate_scores FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS plate_scores_insert_own ON plate_scores;
CREATE POLICY plate_scores_insert_own
  ON plate_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS plate_scores_update_own ON plate_scores;
CREATE POLICY plate_scores_update_own
  ON plate_scores FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS plate_scores_delete_own ON plate_scores;
CREATE POLICY plate_scores_delete_own
  ON plate_scores FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE plate_scores IS
  'PRD §6.8 Plate Score: cached per-user-per-day 0–100 nutrition score. Rewards logging + macro balance + hitting goals; never rewards restriction (§6.7). Logic in PlateScoreService (TS), this is a cache.';
COMMENT ON COLUMN plate_scores.breakdown IS
  'Transparency payload: weights, raw macro totals, and friendly non-shaming notes shown to the user.';
