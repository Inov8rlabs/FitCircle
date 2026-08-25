-- Migration 061: nutrition sync state for HealthKit / Health Connect (PRD v4 §6.2)
-- ADDITIVE ONLY. Extends the existing health integration (migration 024 = steps only) to nutrition.
--
-- Two pieces:
--  1. food_log_entries.source_external_id — the dedup key for platform IMPORTS (a user who keeps
--     MyFitnessPal: their entries flow in via background sync, deduped by external id so a re-sync
--     never double-inserts). nutrition_source/input_method already exist (054).
--  2. health_nutrition_sync — per-(user,platform) cursor: enabled flag + last sync time + cursor,
--     so each client knows what's new since last pull. Mirrors the §7.4 proposal.

-- 1. Dedup key for imported entries (idempotent platform sync).
ALTER TABLE food_log_entries
  ADD COLUMN IF NOT EXISTS source_external_id text;

-- One imported entry per (user, source, external id). Partial: only enforced for rows that carry
-- an external id (FitCircle-native logs leave it NULL and are unconstrained).
CREATE UNIQUE INDEX IF NOT EXISTS food_log_entries_external_uniq
  ON food_log_entries (user_id, nutrition_source, source_external_id)
  WHERE source_external_id IS NOT NULL;

-- 2. Per-user, per-platform nutrition sync cursor.
CREATE TABLE IF NOT EXISTS health_nutrition_sync (
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('healthkit','healthconnect','mfp')),
  enabled      boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_cursor  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);

ALTER TABLE health_nutrition_sync ENABLE ROW LEVEL SECURITY;

-- Users manage only their own sync state.
CREATE POLICY health_nutrition_sync_self_select ON health_nutrition_sync
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY health_nutrition_sync_self_insert ON health_nutrition_sync
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY health_nutrition_sync_self_update ON health_nutrition_sync
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_health_nutrition_sync_updated_at
  BEFORE UPDATE ON health_nutrition_sync
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT, INSERT, UPDATE ON health_nutrition_sync TO authenticated;

COMMENT ON COLUMN food_log_entries.source_external_id IS 'External id from the source platform (HealthKit UUID / Health Connect record id / MFP id) for idempotent import dedup; NULL for FitCircle-native logs.';
COMMENT ON TABLE health_nutrition_sync IS 'Per-user per-platform nutrition sync cursor (PRD §6.2). enabled + last_sync_at + last_cursor.';
