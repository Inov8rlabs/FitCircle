-- ============================================================================
-- Migration 050: Mark platform-curated FitCircles
--
-- Adds an `is_official` flag so a small set of monthly, themed circles can
-- be seeded centrally and surfaced to every user (including the account
-- that technically owns them) in the public-circles Library.
--
-- Why a flag rather than a dedicated system user:
--   - profiles.id has a FK to auth.users(id) which is managed by Supabase
--     Auth. Inserting fake auth rows from SQL is fragile.
--   - The flag is a one-column change with idempotent semantics.
--   - When/if we move to a real system user later, this column still
--     correctly identifies the curated set.
--
-- The discover query in CircleService.getJoinablePublicCircles is updated
-- in the same change-set to honour this flag (an official circle is
-- visible even if the viewer is the creator).
-- ============================================================================

ALTER TABLE fitcircles
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;

-- Index helps the discover query, which filters on (visibility, status,
-- is_official) and orders by created_at.
CREATE INDEX IF NOT EXISTS idx_fitcircles_official_active
  ON fitcircles (created_at DESC)
  WHERE is_official = TRUE AND visibility = 'public' AND status IN ('upcoming', 'active');
