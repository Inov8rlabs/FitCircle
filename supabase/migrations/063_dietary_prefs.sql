-- Migration 063: dietary preferences, allergens, and unit preference
-- PRD v4 §6.15 (Dietary Preferences / Allergens + Units).
--
-- ADDITIVE ONLY. A dedicated, sparse prefs table (NOT bloating profiles): one row per user,
-- created lazily only when a user sets a preference. The ABSENCE of a row means "no declared
-- diet, no allergens"; the unit default is inferred from profiles.country_code in code
-- (Canada → metric, US → imperial, otherwise metric). DietaryPreferencesService.getPrefs
-- centralizes those defaults so callers never special-case a missing row.
--
-- These prefs make SEARCH, SUGGESTIONS, and the COACH respect the user's diet/allergens.
-- Units are a display concern only: the API always stores/returns canonical grams/kcal and the
-- client formats per the unit pref — there is NO backend conversion.

CREATE TABLE IF NOT EXISTS dietary_preferences (
  user_id    uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- Declared dietary pattern. NULL = none declared (treated as 'none' in code).
  diet       text
               CHECK (diet IN ('none','vegetarian','vegan','pescatarian','halal','kosher','gluten_free')),
  -- Free-form lowercase allergen tokens (e.g. {'peanuts','shellfish','milk'}). Empty = none.
  allergens  text[] NOT NULL DEFAULT '{}',
  -- Unit display preference. NULL = not explicitly chosen → inferred from locale in code.
  units      text
               CHECK (units IN ('metric','imperial')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger (project convention; update_updated_at() exists since 001).
CREATE TRIGGER trg_dietary_preferences_updated_at
  BEFORE UPDATE ON dietary_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: a user may read AND write ONLY their own row (auth.uid() = user_id).
-- The pref-aware ranking in FoodsService and the coach grounding run through the
-- service-role client, which bypasses RLS; these policies guarantee per-user
-- ownership of the preference itself for any direct client access.
-- ----------------------------------------------------------------------------
ALTER TABLE dietary_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY dietary_preferences_select_own ON dietary_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY dietary_preferences_insert_own ON dietary_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY dietary_preferences_update_own ON dietary_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY dietary_preferences_delete_own ON dietary_preferences
  FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON dietary_preferences TO authenticated;

COMMENT ON TABLE dietary_preferences IS
  'Per-user dietary pattern, allergens, and unit preference (PRD §6.15). Sparse: absent row = no diet/allergens; units inferred from profiles.country_code in code. Powers pref-aware search ranking + coach grounding. Units are display-only (no backend conversion).';
COMMENT ON COLUMN dietary_preferences.diet IS
  'Declared dietary pattern; NULL = none. One of none|vegetarian|vegan|pescatarian|halal|kosher|gluten_free.';
COMMENT ON COLUMN dietary_preferences.allergens IS
  'Lowercase allergen tokens, e.g. {peanuts,shellfish,milk}. Used as a ranking nudge in search and grounding for the coach; never a hard filter.';
COMMENT ON COLUMN dietary_preferences.units IS
  'metric|imperial display preference; NULL = inferred from locale (CA metric, US imperial, else metric). Display-only — API always returns canonical grams/kcal.';
