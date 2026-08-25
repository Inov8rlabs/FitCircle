-- Migration 054: structured nutrition columns on food_log_entries
-- PRD v4 §6.1 (nutrition intelligence) / §7.4 (schema additions).
--
-- ADDITIVE ONLY. food_log_entries already has a free-form `nutrition_data` JSONB (storage-only,
-- migration 031) and unused `ai_analysis`/`ai_analyzed` placeholders. This adds FIRST-CLASS,
-- queryable macro columns + provenance so the social/leaderboard/summary surfaces can aggregate
-- nutrition without parsing JSON, and so we can tell how a value was produced (photo/voice/etc).
-- Nothing is dropped or altered; existing rows get NULL macros (unknown), which is correct.

ALTER TABLE food_log_entries
  ADD COLUMN IF NOT EXISTS food_id          uuid,                    -- FK to a future foods table (§6.1); nullable until that lands
  ADD COLUMN IF NOT EXISTS servings         numeric,                 -- multiplier applied to the matched food/portion
  ADD COLUMN IF NOT EXISTS calories         numeric,                 -- per the entry as logged (already scaled)
  ADD COLUMN IF NOT EXISTS protein_g        numeric,
  ADD COLUMN IF NOT EXISTS carbs_g          numeric,
  ADD COLUMN IF NOT EXISTS fat_g            numeric,
  ADD COLUMN IF NOT EXISTS input_method     text,                    -- photo | voice | barcode | search | recent | manual | imported
  ADD COLUMN IF NOT EXISTS nutrition_source text,                    -- llm_vision | llm_voice | foods_db | user | healthkit | healthconnect | mfp
  ADD COLUMN IF NOT EXISTS llm_confidence   numeric;                 -- 0..1 overall confidence when produced by an LLM

-- Soft validation: keep the value space honest without rejecting NULLs (unknown is allowed).
-- Use NOT VALID so the constraint applies to new/updated rows without a full-table scan on add.
ALTER TABLE food_log_entries
  ADD CONSTRAINT food_log_entries_input_method_chk
  CHECK (input_method IS NULL OR input_method IN
    ('photo','voice','barcode','search','recent','manual','imported')) NOT VALID;

ALTER TABLE food_log_entries
  ADD CONSTRAINT food_log_entries_nutrition_source_chk
  CHECK (nutrition_source IS NULL OR nutrition_source IN
    ('llm_vision','llm_voice','foods_db','user','healthkit','healthconnect','mfp')) NOT VALID;

ALTER TABLE food_log_entries
  ADD CONSTRAINT food_log_entries_llm_confidence_chk
  CHECK (llm_confidence IS NULL OR (llm_confidence >= 0 AND llm_confidence <= 1)) NOT VALID;

-- Index to power "logged nutrition today" / adherence aggregates (entries that actually carry macros).
CREATE INDEX IF NOT EXISTS idx_food_log_entries_user_day_calories
  ON food_log_entries (user_id, entry_date)
  WHERE calories IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN food_log_entries.input_method IS 'How the entry was created: photo|voice|barcode|search|recent|manual|imported';
COMMENT ON COLUMN food_log_entries.nutrition_source IS 'Where the macros came from: llm_vision|llm_voice|foods_db|user|healthkit|healthconnect|mfp';
COMMENT ON COLUMN food_log_entries.llm_confidence IS '0..1 overall model confidence when nutrition_source is an LLM; NULL otherwise';

-- ============================================================================
-- Cost-governance tables for the photo-parse pipeline (PRD §7.6, §9.2).
-- These are NOT user content — they back the perceptual/content-hash cache (so an
-- identical photo never re-bills the vision model) and the per-user daily soft cap.
-- ============================================================================

-- Content-hash cache: image sha256 -> the validated PhotoParseResult JSON.
CREATE TABLE IF NOT EXISTS nutrition_parse_cache (
  image_hash text PRIMARY KEY,                 -- sha256 of the image bytes
  result     jsonb NOT NULL,                   -- validated PhotoParseResult
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per billed vision call, for the per-user daily soft cap.
CREATE TABLE IF NOT EXISTS nutrition_parse_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nutrition_parse_log_user_day
  ON nutrition_parse_log (user_id, created_at DESC);

-- Service-role only (the service uses the admin client; no direct client access). RLS on,
-- no policies = deny-all to anon/authenticated, which is what we want for these internal tables.
ALTER TABLE nutrition_parse_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_parse_log ENABLE ROW LEVEL SECURITY;
