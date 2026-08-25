-- Migration: 014_food_logging_feature.sql
-- Food Logging Feature with Photo Uploads, Privacy Controls, and Sharing
-- Created: 2025-11-09

-- =====================================================
-- 1. FEATURE FLAGS TABLE (reusable for all features)
-- =====================================================

CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    is_enabled BOOLEAN DEFAULT false,
    rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    allowed_user_ids UUID[] DEFAULT '{}',
    allowed_tiers TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. FOOD LOG ENTRIES TABLE
-- =====================================================

CREATE TABLE food_log_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Entry metadata
    entry_type TEXT NOT NULL CHECK (entry_type IN ('food', 'water', 'supplement')),
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),

    -- Content
    title TEXT,
    description TEXT,
    notes TEXT,

    -- Nutrition data (optional, for future AI analysis)
    nutrition_data JSONB DEFAULT '{}'::jsonb,

    -- Water tracking
    water_ml INTEGER CHECK (water_ml > 0 AND water_ml <= 10000),

    -- Supplement tracking
    supplement_name TEXT,
    supplement_dosage TEXT,

    -- Privacy and sharing
    is_private BOOLEAN DEFAULT true,
    visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'circle')),

    -- Image references
    has_images BOOLEAN DEFAULT false,
    image_count INTEGER DEFAULT 0,

    -- Future features
    tags TEXT[] DEFAULT '{}',
    location JSONB,

    -- AI analysis (future)
    ai_analyzed BOOLEAN DEFAULT false,
    ai_analysis JSONB DEFAULT '{}'::jsonb,
    ai_analyzed_at TIMESTAMPTZ,

    -- Metadata
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'api')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Soft delete
    deleted_at TIMESTAMPTZ,

    -- Entry type validation
    CONSTRAINT valid_entry_type CHECK (
        (entry_type = 'food' AND meal_type IS NOT NULL) OR
        (entry_type = 'water' AND water_ml IS NOT NULL) OR
        (entry_type = 'supplement' AND supplement_name IS NOT NULL)
    )
);

-- =====================================================
-- 3. FOOD LOG IMAGES TABLE
-- =====================================================

CREATE TABLE food_log_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    food_log_entry_id UUID NOT NULL REFERENCES food_log_entries(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Storage information
    storage_path TEXT NOT NULL,
    storage_bucket TEXT NOT NULL DEFAULT 'food-logs',
    file_name TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,

    -- Image metadata
    width INTEGER,
    height INTEGER,
    thumbnail_path TEXT,

    -- Order for multiple images per entry
    display_order INTEGER DEFAULT 0,

    -- Image analysis (future AI features)
    ai_analyzed BOOLEAN DEFAULT false,
    ai_tags TEXT[] DEFAULT '{}',
    ai_detected_foods TEXT[] DEFAULT '{}',
    ai_analysis JSONB DEFAULT '{}'::jsonb,

    -- Security
    upload_ip TEXT,
    upload_user_agent TEXT,

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT valid_file_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    CONSTRAINT valid_mime_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic'))
);

-- =====================================================
-- 4. FOOD LOG SHARES TABLE
-- =====================================================

CREATE TABLE food_log_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    food_log_entry_id UUID NOT NULL REFERENCES food_log_entries(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    shared_with_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    shared_with_circle_id UUID REFERENCES challenges(id) ON DELETE CASCADE,

    -- Permissions
    can_view BOOLEAN DEFAULT true,
    can_comment BOOLEAN DEFAULT false,

    -- Share metadata
    share_message TEXT,
    expires_at TIMESTAMPTZ,

    -- Tracking
    viewed_at TIMESTAMPTZ,
    view_count INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Must share with either a user OR a circle, not both
    CONSTRAINT share_target CHECK (
        (shared_with_user_id IS NOT NULL AND shared_with_circle_id IS NULL) OR
        (shared_with_user_id IS NULL AND shared_with_circle_id IS NOT NULL)
    ),

    -- Unique constraint
    UNIQUE NULLS NOT DISTINCT (food_log_entry_id, shared_with_user_id, shared_with_circle_id)
);

-- =====================================================
-- 5. AUDIT LOG TABLE
-- =====================================================

CREATE TABLE food_log_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    food_log_entry_id UUID REFERENCES food_log_entries(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'view', 'share', 'unshare', 'image_upload', 'image_delete')),
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ip_address TEXT,
    user_agent TEXT,
    changes JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 6. INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX idx_food_log_entries_user_date ON food_log_entries(user_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_food_log_entries_user_type ON food_log_entries(user_id, entry_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_food_log_entries_logged_at ON food_log_entries(logged_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_food_log_entries_visibility ON food_log_entries(visibility) WHERE deleted_at IS NULL AND is_private = false;
CREATE INDEX idx_food_log_entries_tags ON food_log_entries USING gin(tags) WHERE deleted_at IS NULL;

CREATE INDEX idx_food_log_images_entry ON food_log_images(food_log_entry_id, display_order);
CREATE INDEX idx_food_log_images_user ON food_log_images(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_food_log_images_storage_path ON food_log_images(storage_path) WHERE deleted_at IS NULL;

CREATE INDEX idx_food_log_shares_entry ON food_log_shares(food_log_entry_id);
CREATE INDEX idx_food_log_shares_user ON food_log_shares(shared_with_user_id) WHERE shared_with_user_id IS NOT NULL;
CREATE INDEX idx_food_log_shares_circle ON food_log_shares(shared_with_circle_id) WHERE shared_with_circle_id IS NOT NULL;
CREATE INDEX idx_food_log_shares_owner ON food_log_shares(owner_id);

CREATE INDEX idx_food_log_audit_entry ON food_log_audit(food_log_entry_id, created_at DESC);
CREATE INDEX idx_food_log_audit_user ON food_log_audit(user_id, created_at DESC);
CREATE INDEX idx_food_log_audit_action ON food_log_audit(action);

CREATE INDEX idx_feature_flags_name ON feature_flags(name) WHERE is_enabled = true;

-- =====================================================
-- 7. UPDATE TRIGGERS
-- =====================================================

CREATE TRIGGER update_food_log_entries_updated_at
    BEFORE UPDATE ON food_log_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_food_log_images_updated_at
    BEFORE UPDATE ON food_log_images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_food_log_shares_updated_at
    BEFORE UPDATE ON food_log_shares
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_feature_flags_updated_at
    BEFORE UPDATE ON feature_flags
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_log_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_log_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_log_audit ENABLE ROW LEVEL SECURITY;

-- Feature flags: viewable by all authenticated users
CREATE POLICY "Feature flags viewable by authenticated users"
    ON feature_flags FOR SELECT
    USING (true);

-- Food log entries: Users can view their own + shared entries
CREATE POLICY "Users can view own food log entries"
    ON food_log_entries FOR SELECT
    USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can view shared food log entries"
    ON food_log_entries FOR SELECT
    USING (
        deleted_at IS NULL AND
        EXISTS (
            SELECT 1 FROM food_log_shares
            WHERE food_log_entry_id = food_log_entries.id
            AND shared_with_user_id = auth.uid()
            AND (expires_at IS NULL OR expires_at > NOW())
        )
    );

CREATE POLICY "Users can create own food log entries"
    ON food_log_entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own food log entries"
    ON food_log_entries FOR UPDATE
    USING (auth.uid() = user_id AND deleted_at IS NULL)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can soft delete own food log entries"
    ON food_log_entries FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id AND deleted_at IS NOT NULL);

-- Food log images: Follow parent entry permissions
CREATE POLICY "Users can view own food log images"
    ON food_log_images FOR SELECT
    USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can view shared food log images"
    ON food_log_images FOR SELECT
    USING (
        deleted_at IS NULL AND
        EXISTS (
            SELECT 1 FROM food_log_entries fle
            WHERE fle.id = food_log_images.food_log_entry_id
            AND fle.deleted_at IS NULL
            AND EXISTS (
                SELECT 1 FROM food_log_shares
                WHERE food_log_entry_id = fle.id
                AND shared_with_user_id = auth.uid()
                AND (expires_at IS NULL OR expires_at > NOW())
            )
        )
    );

CREATE POLICY "Users can upload images to own entries"
    ON food_log_images FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM food_log_entries
            WHERE id = food_log_entry_id
            AND user_id = auth.uid()
            AND deleted_at IS NULL
        )
    );

CREATE POLICY "Users can delete own images"
    ON food_log_images FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Food log shares: Users can manage their own shares
CREATE POLICY "Users can view shares they created"
    ON food_log_shares FOR SELECT
    USING (auth.uid() = owner_id);

CREATE POLICY "Users can view shares targeting them"
    ON food_log_shares FOR SELECT
    USING (auth.uid() = shared_with_user_id);

CREATE POLICY "Users can create shares for own entries"
    ON food_log_shares FOR INSERT
    WITH CHECK (
        auth.uid() = owner_id AND
        EXISTS (
            SELECT 1 FROM food_log_entries
            WHERE id = food_log_entry_id
            AND user_id = auth.uid()
            AND deleted_at IS NULL
        )
    );

CREATE POLICY "Users can delete own shares"
    ON food_log_shares FOR DELETE
    USING (auth.uid() = owner_id);

-- Audit log: Users can view their own audit trail
CREATE POLICY "Users can view own audit logs"
    ON food_log_audit FOR SELECT
    USING (auth.uid() = user_id);

-- =====================================================
-- 9. GRANT PERMISSIONS
-- =====================================================

GRANT ALL ON food_log_entries TO authenticated;
GRANT ALL ON food_log_images TO authenticated;
GRANT ALL ON food_log_shares TO authenticated;
GRANT ALL ON food_log_audit TO authenticated;
GRANT SELECT ON feature_flags TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- =====================================================
-- 10. INSERT DEFAULT FEATURE FLAG
-- =====================================================

INSERT INTO feature_flags (name, description, is_enabled, rollout_percentage, allowed_tiers)
VALUES (
    'food_logging',
    'Food, water, and supplement logging with photo uploads',
    false,
    0,
    ARRAY['premium', 'enterprise']
) ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- 11. HELPER FUNCTIONS
-- =====================================================

-- Function to increment image count on entry
CREATE OR REPLACE FUNCTION increment_image_count(entry_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE food_log_entries
    SET image_count = image_count + 1,
        has_images = true,
        updated_at = NOW()
    WHERE id = entry_id;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement image count on entry
CREATE OR REPLACE FUNCTION decrement_image_count(entry_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE food_log_entries
    SET image_count = GREATEST(image_count - 1, 0),
        has_images = CASE WHEN image_count - 1 <= 0 THEN false ELSE true END,
        updated_at = NOW()
    WHERE id = entry_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STORAGE BUCKET SETUP (Run in Supabase Dashboard)
-- =====================================================

-- Note: You'll need to create the storage bucket manually in Supabase Dashboard:
-- 1. Go to Storage > Create new bucket
-- 2. Name: "food-logs"
-- 3. Public: false (private bucket)
-- 4. File size limit: 10MB
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp, image/heic

-- Then set up storage policies (run this after creating bucket):
--
-- CREATE POLICY "Users can upload to own folder"
-- ON storage.objects FOR INSERT
-- WITH CHECK (
--   bucket_id = 'food-logs' AND
--   auth.uid()::text = (storage.foldername(name))[1]
-- );
--
-- CREATE POLICY "Users can view own images"
-- ON storage.objects FOR SELECT
-- USING (
--   bucket_id = 'food-logs' AND
--   auth.uid()::text = (storage.foldername(name))[1]
-- );
--
-- CREATE POLICY "Users can delete own images"
-- ON storage.objects FOR DELETE
-- USING (
--   bucket_id = 'food-logs' AND
--   auth.uid()::text = (storage.foldername(name))[1]
-- );

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

COMMENT ON TABLE feature_flags IS 'Feature flags for remote configuration and gradual rollout';
COMMENT ON TABLE food_log_entries IS 'Main food, water, and supplement log entries';
COMMENT ON TABLE food_log_images IS 'Images attached to food log entries';
COMMENT ON TABLE food_log_shares IS 'Sharing permissions for food log entries';
COMMENT ON TABLE food_log_audit IS 'Audit trail for food log operations';
