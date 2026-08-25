-- ============================================================================
-- Migration 051: Multi-image food logs, meal-time ordering, alcohol photos
--
-- Three feature additions, all backwards compatible:
--
-- 1. Meal-time ordering for food log entries
--    `food_log_entries.logged_at` already exists and stores a TIMESTAMPTZ.
--    Until now the iOS/Android/Web clients only sent a date; they will now
--    send a full datetime that represents WHEN the meal was consumed (not
--    when the row was inserted). Renaming would break clients in flight, so
--    we keep the column name and just add an index that supports the new
--    daily-chronological sort.
--
-- 2. Multiple images per food log entry
--    The `food_log_images` table is already a one-to-many child of
--    `food_log_entries` with a `display_order` column. No schema change is
--    required for the storage layer. We add a helpful unique partial index
--    so reordering stays consistent.
--
-- 3. Alcohol logging with photos
--    `beverage_logs.category` already accepts 'alcohol'. Alcohol-specific
--    structured fields (alcohol_type, brand, name, abv_percent,
--    serving_count, serving_size_ml) live inside the existing
--    `customizations` JSONB column, which is GIN-indexed and queryable.
--    The one new piece of schema is a `beverage_log_images` table so users
--    can attach photos (e.g. a beer label) to a beverage log entry. The
--    table mirrors `food_log_images` for consistency.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Food log: meal-time ordering
-- ----------------------------------------------------------------------------

-- Backfill: many existing rows have logged_at set to created_at (the moment
-- the row was inserted), which is fine — daily sort still works because all
-- entries for a day get a real timestamp. New writes will carry the true
-- consumed-at moment.

-- Composite index optimised for the per-day chronological list:
--   "give me all of today's entries in the order they were eaten"
-- The existing idx_food_log_entries_user_date orders by entry_date DESC
-- only, which is fine for cross-day pagination but suboptimal for the
-- in-day chronological sort the UI now needs.
CREATE INDEX IF NOT EXISTS idx_food_log_entries_user_day_time
    ON food_log_entries(user_id, entry_date DESC, logged_at ASC)
    WHERE deleted_at IS NULL;

COMMENT ON COLUMN food_log_entries.logged_at IS
    'Timestamp when the user CONSUMED the food/drink. Used to order entries '
    'chronologically within a day. Defaults to NOW() but clients should send '
    'the user-picked meal time.';

-- ----------------------------------------------------------------------------
-- 2. Food log: multiple images per entry
-- ----------------------------------------------------------------------------

-- food_log_images already supports many-per-entry via display_order.
-- Add a partial unique index so two images can't share a slot per entry.
-- (Soft-deleted rows are excluded so we don't block recreation after delete.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_log_images_entry_order_unique
    ON food_log_images(food_log_entry_id, display_order)
    WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Alcohol logging: beverage_log_images table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS beverage_log_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    beverage_log_id UUID NOT NULL REFERENCES beverage_logs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Storage
    storage_path TEXT NOT NULL,
    storage_bucket TEXT NOT NULL DEFAULT 'beverage-logs',
    file_name TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,

    -- Image metadata
    width INTEGER,
    height INTEGER,
    thumbnail_path TEXT,

    -- Ordering for multi-image entries (most alcohol logs will only have one,
    -- but the schema matches food_log_images so the same upload pipeline works)
    display_order INTEGER DEFAULT 0,

    -- Audit
    upload_ip TEXT,
    upload_user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT bev_img_valid_file_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    CONSTRAINT bev_img_valid_mime_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic'))
);

CREATE INDEX IF NOT EXISTS idx_beverage_log_images_entry
    ON beverage_log_images(beverage_log_id, display_order)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_beverage_log_images_user
    ON beverage_log_images(user_id)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_beverage_log_images_entry_order_unique
    ON beverage_log_images(beverage_log_id, display_order)
    WHERE deleted_at IS NULL;

CREATE TRIGGER update_beverage_log_images_updated_at
    BEFORE UPDATE ON beverage_log_images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS for beverage_log_images
-- ----------------------------------------------------------------------------

ALTER TABLE beverage_log_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own beverage log images"
    ON beverage_log_images FOR SELECT
    USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can upload images to own beverage logs"
    ON beverage_log_images FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM beverage_logs
            WHERE id = beverage_log_id
              AND user_id = auth.uid()
              AND deleted_at IS NULL
        )
    );

CREATE POLICY "Users can delete own beverage log images"
    ON beverage_log_images FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT ALL ON beverage_log_images TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Alcohol-friendly customizations: documentation only
-- ----------------------------------------------------------------------------
--
-- Standard JSONB shape clients should write for alcohol entries:
--   {
--     "alcohol_type":    "beer" | "wine" | "spirit" | "cocktail" | "other",
--     "brand":           "Stella Artois",                 // optional
--     "name":            "Stella Artois Lager",           // optional
--     "abv_percent":     5.0,                              // optional, 0-100
--     "serving_count":   1,                                // optional, default 1
--     "serving_size_ml": 355                               // optional
--   }
--
-- All five keys are queryable via the existing GIN index on customizations.
-- Examples:
--   SELECT * FROM beverage_logs
--    WHERE category = 'alcohol'
--      AND customizations @> '{"alcohol_type":"beer"}'::jsonb;
--
--   SELECT SUM((customizations->>'serving_count')::int) FROM beverage_logs
--    WHERE user_id = $1 AND category = 'alcohol'
--      AND entry_date >= CURRENT_DATE - INTERVAL '7 days';
--
-- If a specific filter becomes hot later, promote it to a generated column
-- backed by `customizations->>'<key>'`.

COMMENT ON TABLE beverage_log_images IS
    'Photos attached to beverage_logs entries (alcohol labels, latte art, etc).';

-- ============================================================================
-- STORAGE BUCKET SETUP (manual step — see end of file)
-- ============================================================================
-- A new Supabase Storage bucket named "beverage-logs" must be created in the
-- Supabase Dashboard. See the bottom of this file for the exact steps.
-- ============================================================================
