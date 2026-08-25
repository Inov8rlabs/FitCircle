-- Migration 055: foods reference table + full-text search + barcode lookup
-- PRD v4 §6.1 (search, barcode, custom foods & recipes) / §7.4 (schema).
--
-- ADDITIVE ONLY. New `foods` table (read-mostly reference data: Open Food Facts + USDA,
-- plus user custom foods and recipes), with a generated tsvector for full-text search and a
-- barcode index. food_log_entries.food_id (added in 054) will FK to this once populated.
--
-- Macros are stored PER 100g (the OFF/USDA convention) so a logged entry scales by servings.
-- Custom foods / recipes live in the same table (source='custom'|'recipe') with owner_id set;
-- global reference rows (off/usda) have owner_id NULL and are visible to everyone.

CREATE TABLE IF NOT EXISTS foods (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text NOT NULL CHECK (source IN ('off','usda','custom','recipe')),
  source_id          text,                         -- external id within the source (OFF code, USDA fdcId)
  owner_id           uuid REFERENCES profiles(id) ON DELETE CASCADE,  -- set for custom/recipe; NULL for global ref
  name               text NOT NULL,
  brand              text,
  barcode            text,
  serving_size_g     numeric,                      -- a sensible default serving in grams
  serving_unit       text,                         -- human label for a serving, e.g. "1 cup", "1 slice"
  calories_per_100g  numeric,
  protein_per_100g   numeric,
  carbs_per_100g     numeric,
  fat_per_100g       numeric,
  fiber_per_100g     numeric,
  sugar_per_100g     numeric,
  locale             text,                         -- region bias for ranking, e.g. 'en-CA','en-GB','en-IN'
  -- recipes are multi-ingredient: keep the component breakdown + per-serving math inputs here
  recipe_ingredients jsonb,                        -- [{name, grams, food_id?}]; null for non-recipes
  recipe_servings    numeric,                      -- how many servings the recipe yields
  -- generated FTS vector over name + brand (weighted): name is primary, brand secondary.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '')), 'B')
  ) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foods_owner_required_for_custom CHECK (
    (source IN ('custom','recipe')) = (owner_id IS NOT NULL)
  )
);

-- Full-text search (the §6.1 combined index) + trigram for fuzzy/typo-tolerant prefix search.
CREATE INDEX IF NOT EXISTS foods_search_idx ON foods USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS foods_name_trgm_idx ON foods USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS foods_barcode_idx ON foods(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS foods_owner_idx ON foods(owner_id) WHERE owner_id IS NOT NULL;
-- One row per external item per source (lets the OFF/USDA loader upsert idempotently).
-- Must be a NON-partial unique constraint so it's usable for ON CONFLICT (source, source_id)
-- inference. NULLs are distinct by default, so custom/recipe rows (source_id NULL) never collide.
ALTER TABLE foods ADD CONSTRAINT foods_source_uniq UNIQUE (source, source_id);

-- pg_trgm is needed for the trigram index. Enable if not already (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- updated_at trigger (reuse the project convention; update_updated_at() exists since 001).
CREATE TRIGGER trg_foods_updated_at
  BEFORE UPDATE ON foods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: global reference rows (off/usda, owner_id NULL) are readable by all authenticated
-- users; custom/recipe rows are private to their owner (read + write). Inserts of global
-- reference data are done by the loader via the service-role client (bypasses RLS).
-- ----------------------------------------------------------------------------
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY foods_read_global_or_own ON foods
  FOR SELECT
  USING (owner_id IS NULL OR owner_id = auth.uid());

CREATE POLICY foods_insert_own_custom ON foods
  FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND source IN ('custom','recipe'));

CREATE POLICY foods_update_own_custom ON foods
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY foods_delete_own_custom ON foods
  FOR DELETE
  USING (owner_id = auth.uid());

-- Now that foods exists, make food_log_entries.food_id a real FK (added column in 054).
ALTER TABLE food_log_entries
  ADD CONSTRAINT food_log_entries_food_id_fkey
  FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE SET NULL NOT VALID;

GRANT SELECT, INSERT, UPDATE, DELETE ON foods TO authenticated;

COMMENT ON TABLE foods IS 'Food reference data: Open Food Facts + USDA (global, owner_id NULL) plus user custom foods/recipes (owner_id set). Macros per 100g.';
COMMENT ON COLUMN foods.search_vector IS 'Generated FTS vector: name (weight A) + brand (weight B), simple config.';
