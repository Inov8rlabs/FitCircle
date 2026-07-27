-- ============================================================================
-- 072: Body-composition photo-parse cost-governance tables.
-- BODY_COMP_BUILD_CONTRACT §2 "Photo-parse implementation": sha256 content-hash
-- cache (an identical scan photo never re-bills the vision model) + per-user
-- daily soft-cap accounting (cap 10/day). Mirrors the nutrition_parse_cache /
-- nutrition_parse_log pattern from 054 exactly, but as SEPARATE tables so
-- body-comp scans never consume the nutrition photo budget (and vice versa).
-- These are NOT user content and hold no business logic — plain tables +
-- indexes only (no functions/triggers, per project rule).
-- ============================================================================

-- Content-hash cache: image sha256 -> { model, parse } envelope (the validated
-- BodyCompParseResult plus the model that produced it).
CREATE TABLE IF NOT EXISTS body_comp_parse_cache (
  image_hash text PRIMARY KEY,                 -- sha256 over the image bytes (see service)
  result     jsonb NOT NULL,                   -- { model, parse: BodyCompParseResult }
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per billed vision parse (a multi-image request is ONE call), for the
-- per-user daily soft cap.
CREATE TABLE IF NOT EXISTS body_comp_parse_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_body_comp_parse_log_user_day
  ON body_comp_parse_log (user_id, created_at DESC);

-- Service-role only (the service uses the admin client; no direct client access). RLS on,
-- no policies = deny-all to anon/authenticated, which is what we want for these internal tables.
ALTER TABLE body_comp_parse_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_comp_parse_log ENABLE ROW LEVEL SECURITY;
