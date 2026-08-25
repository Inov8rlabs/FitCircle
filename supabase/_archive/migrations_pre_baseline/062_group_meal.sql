-- Migration 062: Dining-Out & Group Meal Mode — group_meals + group_meal_tags
-- PRD v4 §6.12.
--
-- ADDITIVE ONLY. No existing table is altered destructively. When a circle eats together,
-- one member logs a SHARED meal (group_meals) and TAGS other members (group_meal_tags).
-- Each tagged member ACCEPTS the meal into their own diary with one tap, which creates a
-- food_log_entry for them (done in the service, input_method='group_meal'). One person does
-- the work for the table.
--
-- Grounding (verified against real schema 2026-06-04):
--   * Circle      = `fitcircles(id)`
--   * Membership  = `fitcircle_members(fitcircle_id, user_id, status)`, ACTIVE = status='active'
--   * User FK     = `profiles(id)`
--   * Diary entry = `food_log_entries(id)` (031; macros calories/protein_g/carbs_g/fat_g +
--                    input_method/nutrition_source added in 054)
--
-- No stored procedures / business-logic triggers (CLAUDE.md hard rule). DB-side constructs are
-- limited to: two tables, indexes, RLS policies (inline membership predicates), the existing
-- update_updated_at() timestamp trigger (created in 001), and grants. All accept/decline/insert
-- business logic lives in GroupMealService (admin client, explicit auth).

-- ----------------------------------------------------------------------------
-- 0. Allow 'group_meal' as a food_log_entries.input_method value.
--    Migration 054 added a NOT VALID CHECK enumerating input methods; accepting a
--    group meal stamps input_method='group_meal', so widen that allow-list. Drop &
--    recreate (additive to the value space; NOT VALID keeps it cheap, matching 054).
-- ----------------------------------------------------------------------------
ALTER TABLE food_log_entries
  DROP CONSTRAINT IF EXISTS food_log_entries_input_method_chk;

ALTER TABLE food_log_entries
  ADD CONSTRAINT food_log_entries_input_method_chk
  CHECK (input_method IS NULL OR input_method IN
    ('photo','voice','barcode','search','recent','manual','imported','group_meal')) NOT VALID;

-- ----------------------------------------------------------------------------
-- 1. group_meals — the shared meal definition (one per table/occasion).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_meals (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fitcircle_id    uuid NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
    creator_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name            text NOT NULL,
    restaurant_name text,
    logged_at       timestamptz NOT NULL DEFAULT now(),
    meal_type       text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack','other')),
    -- Per-person macros for the shared item (each tagged accepter gets these). Nullable:
    -- a photo-estimated meal may carry macros, a "we ate at X" tag-only meal may not.
    calories        numeric,
    protein_g       numeric,
    carbs_g         numeric,
    fat_g           numeric,
    photo_url       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_meals_fitcircle ON group_meals(fitcircle_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_meals_creator   ON group_meals(creator_id);

-- ----------------------------------------------------------------------------
-- 2. group_meal_tags — who's tagged + whether they accepted into their diary.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_meal_tags (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_meal_id              uuid NOT NULL REFERENCES group_meals(id) ON DELETE CASCADE,
    tagged_user_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status                     text NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','accepted','declined')),
    -- The diary entry created when this user accepted (NULL until accepted). ON DELETE SET NULL:
    -- if the user later deletes that diary entry, the tag stays accepted but the link clears.
    accepted_food_log_entry_id uuid REFERENCES food_log_entries(id) ON DELETE SET NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (group_meal_id, tagged_user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_meal_tags_meal ON group_meal_tags(group_meal_id);
-- Powers the per-user "accept into diary" inbox (pending tags for me).
CREATE INDEX IF NOT EXISTS idx_group_meal_tags_user_pending
    ON group_meal_tags(tagged_user_id, status);

-- ----------------------------------------------------------------------------
-- 3. updated_at triggers (project convention: update_updated_at(), exists since 001).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_group_meals_updated_at ON group_meals;
CREATE TRIGGER trg_group_meals_updated_at
    BEFORE UPDATE ON group_meals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_group_meal_tags_updated_at ON group_meal_tags;
CREATE TRIGGER trg_group_meal_tags_updated_at
    BEFORE UPDATE ON group_meal_tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS. The service uses the admin client (service role bypasses RLS) and authorizes
--    explicitly in-code; these policies are defense-in-depth for any direct client access.
-- ----------------------------------------------------------------------------
ALTER TABLE group_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_meal_tags ENABLE ROW LEVEL SECURITY;

-- group_meals: active members of the circle can read its group meals.
CREATE POLICY group_meals_member_select ON group_meals
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM fitcircle_members m
            WHERE m.fitcircle_id = group_meals.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- group_meals: only an active member can create one, and only as themselves (creator_id = me).
CREATE POLICY group_meals_creator_insert ON group_meals
    FOR INSERT
    WITH CHECK (
        creator_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM fitcircle_members m
            WHERE m.fitcircle_id = group_meals.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- group_meal_tags: a tagged user reads their OWN tag rows; the creator reads tags on
-- meals they created (to see who accepted).
CREATE POLICY group_meal_tags_select ON group_meal_tags
    FOR SELECT
    USING (
        tagged_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM group_meals gm
            WHERE gm.id = group_meal_tags.group_meal_id
              AND gm.creator_id = auth.uid()
        )
    );

-- group_meal_tags: the creator inserts the tags when creating the meal.
CREATE POLICY group_meal_tags_creator_insert ON group_meal_tags
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM group_meals gm
            WHERE gm.id = group_meal_tags.group_meal_id
              AND gm.creator_id = auth.uid()
        )
    );

-- group_meal_tags: a tagged user updates only their OWN tag row (accept/decline).
CREATE POLICY group_meal_tags_owner_update ON group_meal_tags
    FOR UPDATE
    USING (tagged_user_id = auth.uid())
    WITH CHECK (tagged_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5. Grants (RLS still governs row visibility; these grant table-level access).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON group_meals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON group_meal_tags TO authenticated;

COMMENT ON TABLE group_meals IS
  'PRD §6.12 — a shared meal one circle member logs on behalf of the table; per-person macros.';
COMMENT ON TABLE group_meal_tags IS
  'PRD §6.12 — circle members tagged in a group meal; accept creates their own food_log_entry.';
