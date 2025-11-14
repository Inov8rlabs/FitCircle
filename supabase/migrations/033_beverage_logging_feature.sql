-- Migration: 033_beverage_logging_feature.sql
-- Beverage Logging Feature with Privacy Controls and Favorites
-- Created: 2025-11-14
--
-- This migration adds comprehensive beverage tracking functionality including:
-- - Water, coffee, tea, smoothies, protein shakes, alcohol, and more
-- - Detailed customizations (size, temperature, add-ins, etc.)
-- - Nutritional information (calories, caffeine, sugar)
-- - Favorites for quick logging
-- - Privacy controls
-- - Full cross-platform sync support

-- =====================================================
-- 1. BEVERAGE LOGS TABLE
-- =====================================================

CREATE TABLE beverage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Beverage classification
    category TEXT NOT NULL CHECK (category IN ('water', 'coffee', 'tea', 'smoothie', 'protein_shake', 'juice', 'soda', 'alcohol', 'energy_drink', 'sports_drink', 'milk', 'other')),
    beverage_type TEXT NOT NULL, -- e.g., "Latte", "Green Tea", "Orange Juice"

    -- Customizations (stored as JSONB for flexibility)
    customizations JSONB DEFAULT '{}'::jsonb,
    -- Example structure:
    -- {
    --   "size": "medium",
    --   "temperature": "hot",
    --   "milk_type": "oat",
    --   "sweetener": "honey",
    --   "add_ins": ["cinnamon", "vanilla"],
    --   "ice": true,
    --   "shots": 2
    -- }

    -- Volume and nutrition
    volume_ml INTEGER NOT NULL CHECK (volume_ml > 0 AND volume_ml <= 10000),
    calories INTEGER CHECK (calories >= 0 AND calories <= 5000),
    caffeine_mg INTEGER CHECK (caffeine_mg >= 0 AND caffeine_mg <= 1000),
    sugar_g DECIMAL(6,2) CHECK (sugar_g >= 0 AND sugar_g <= 500),

    -- User notes
    notes TEXT,

    -- Favorites functionality
    is_favorite BOOLEAN DEFAULT false,
    favorite_name TEXT, -- Custom name for saved favorite

    -- Privacy
    is_private BOOLEAN DEFAULT true,

    -- Timing
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Metadata
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'api', 'ios', 'android', 'web')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Soft delete
    deleted_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT favorite_name_required CHECK (
        (is_favorite = false) OR
        (is_favorite = true AND favorite_name IS NOT NULL)
    )
);

-- =====================================================
-- 2. INDEXES FOR PERFORMANCE
-- =====================================================

-- Primary query patterns
CREATE INDEX idx_beverage_logs_user_date ON beverage_logs(user_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_beverage_logs_user_category ON beverage_logs(user_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_beverage_logs_logged_at ON beverage_logs(logged_at DESC) WHERE deleted_at IS NULL;

-- Favorites lookup
CREATE INDEX idx_beverage_logs_favorites ON beverage_logs(user_id, is_favorite) WHERE deleted_at IS NULL AND is_favorite = true;

-- Category filtering
CREATE INDEX idx_beverage_logs_category ON beverage_logs(category) WHERE deleted_at IS NULL;

-- Date range queries
CREATE INDEX idx_beverage_logs_date_range ON beverage_logs(entry_date) WHERE deleted_at IS NULL;

-- JSONB customizations queries (GIN index for flexible querying)
CREATE INDEX idx_beverage_logs_customizations ON beverage_logs USING gin(customizations) WHERE deleted_at IS NULL;

-- =====================================================
-- 3. UPDATE TRIGGER
-- =====================================================

CREATE TRIGGER update_beverage_logs_updated_at
    BEFORE UPDATE ON beverage_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE beverage_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own beverage logs
CREATE POLICY "Users can view own beverage logs"
    ON beverage_logs FOR SELECT
    USING (auth.uid() = user_id AND deleted_at IS NULL);

-- Users can create their own beverage logs
CREATE POLICY "Users can create own beverage logs"
    ON beverage_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own beverage logs
CREATE POLICY "Users can update own beverage logs"
    ON beverage_logs FOR UPDATE
    USING (auth.uid() = user_id AND deleted_at IS NULL)
    WITH CHECK (auth.uid() = user_id);

-- Users can soft delete their own beverage logs
CREATE POLICY "Users can soft delete own beverage logs"
    ON beverage_logs FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id AND deleted_at IS NOT NULL);

-- =====================================================
-- 5. GRANT PERMISSIONS
-- =====================================================

GRANT ALL ON beverage_logs TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- =====================================================
-- 6. COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE beverage_logs IS 'Comprehensive beverage tracking with customizations, nutrition, and favorites';
COMMENT ON COLUMN beverage_logs.category IS 'Broad beverage category for filtering and grouping';
COMMENT ON COLUMN beverage_logs.beverage_type IS 'Specific beverage name or type';
COMMENT ON COLUMN beverage_logs.customizations IS 'Flexible JSONB storage for size, temperature, add-ins, etc.';
COMMENT ON COLUMN beverage_logs.volume_ml IS 'Volume in milliliters (1-10000)';
COMMENT ON COLUMN beverage_logs.calories IS 'Total calories (0-5000)';
COMMENT ON COLUMN beverage_logs.caffeine_mg IS 'Caffeine content in milligrams (0-1000)';
COMMENT ON COLUMN beverage_logs.sugar_g IS 'Sugar content in grams (0-500)';
COMMENT ON COLUMN beverage_logs.is_favorite IS 'Whether this beverage configuration is saved as a favorite';
COMMENT ON COLUMN beverage_logs.favorite_name IS 'Custom name for favorite beverages (required when is_favorite=true)';
COMMENT ON COLUMN beverage_logs.is_private IS 'Privacy control for sharing features';
COMMENT ON COLUMN beverage_logs.source IS 'Platform or method used to log the beverage';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Usage Examples:
--
-- Log a simple water entry:
-- INSERT INTO beverage_logs (user_id, category, beverage_type, volume_ml)
-- VALUES (auth.uid(), 'water', 'Water', 500);
--
-- Log a custom latte:
-- INSERT INTO beverage_logs (user_id, category, beverage_type, volume_ml, customizations, calories, caffeine_mg)
-- VALUES (
--   auth.uid(),
--   'coffee',
--   'Latte',
--   355,
--   '{"size": "medium", "temperature": "hot", "milk_type": "oat", "shots": 2}'::jsonb,
--   150,
--   150
-- );
--
-- Save as favorite:
-- INSERT INTO beverage_logs (user_id, category, beverage_type, volume_ml, customizations, is_favorite, favorite_name)
-- VALUES (
--   auth.uid(),
--   'coffee',
--   'Iced Vanilla Latte',
--   473,
--   '{"size": "large", "temperature": "iced", "milk_type": "almond", "flavor": "vanilla", "ice": true}'::jsonb,
--   true,
--   'My Morning Latte'
-- );
--
-- Query favorites:
-- SELECT * FROM beverage_logs
-- WHERE user_id = auth.uid() AND is_favorite = true AND deleted_at IS NULL
-- ORDER BY favorite_name;
--
-- Get daily water intake:
-- SELECT SUM(volume_ml) as total_water_ml
-- FROM beverage_logs
-- WHERE user_id = auth.uid()
--   AND category = 'water'
--   AND entry_date = CURRENT_DATE
--   AND deleted_at IS NULL;
--
-- Get caffeine intake for today:
-- SELECT SUM(caffeine_mg) as total_caffeine_mg
-- FROM beverage_logs
-- WHERE user_id = auth.uid()
--   AND entry_date = CURRENT_DATE
--   AND deleted_at IS NULL;
