-- ============================================================================
-- ⚠️  STAGING-VERIFY BEFORE PRODUCTION. Deploy ONLY together with the browser
--     read-rewiring (see below). Shipping this without the app changes breaks
--     join-by-code, leaderboards, member lists, and cross-user names/avatars.
-- ============================================================================
-- Migration 069: Security / RLS Hardening — CROSS-USER SELECT tightening
--
-- Closes the CRITICAL world-readable holes on the four tables that expose PII /
-- private goal+weight data:
--   profiles (email/phone/DOB/weight/stripe_id), fitcircle_members (start/target
--   weight, goals), daily_tracking (daily weight/steps/mood), fitcircles (private
--   circles + invite codes).
--
-- APPROACH (CLAUDE.md-aligned): RLS becomes a dumb OWN-ROW floor — no helper
-- functions, no stored procedures, no cross-table subqueries. Every legitimate
-- CROSS-USER read (leaderboards, member lists, invite preview, another user's
-- name/avatar) is served by an existing/added SERVICE-ROLE API route that
-- authorizes the caller in TypeScript, exactly per the project's architecture.
-- The one exception is `public_profiles`, a column-projection VIEW (no logic) that
-- exposes only non-sensitive profile columns for name/avatar rendering.
--
-- REQUIRED APP CHANGES that ship with this migration (browser anon-key reads ->
-- routes / view):
--   * Invite preview:   GET /api/fitcircles/validate?code=  (new)
--       join/[code]/page.tsx, components/JoinCircleModal.tsx, components/QuickJoinCircle.tsx
--   * Circle detail + members/leaderboard:  existing /api/fitcircles/[id],
--       /api/fitcircles/[id]/leaderboard, /api/fitcircles/[id]/participants
--       fitcircles/[id]/page.tsx, lib/services/leaderboard-service.ts
--   * My circles list:  existing /api/fitcircles  (fitcircles/page.tsx)
--   * Cross-user check-in read:  route  (fitcircles/[id]/checkin/page.tsx:114)
--   * Other users' name/avatar:  public_profiles view (join preview, member rows)
-- Own-row reads (dashboard, profile, hooks/useProfile, settings/notifications,
-- StepsGoalCard, GoalProgressIndicator) are UNAFFECTED — they filter by auth.uid().
--
-- VERIFY on staging with the two-user deny test in
-- apps/web/__tests__/integration/rls-cross-user-deny.test.ts before production.
-- Idempotent (DROP ... IF EXISTS before CREATE).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- profiles — base SELECT restricted to the owner; public columns via a view.
--   The view is a plain column projection (NOT security_invoker) so it acts as a
--   public directory of non-sensitive fields while the base table stays owner-only.
--   It contains no logic, so it does not violate the no-stored-procedure rule.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, username, display_name, avatar_url
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;
-- Note: anon is intentionally NOT granted. Anonymous invite previews are served by
-- the /api/fitcircles/validate service-role route, which returns the creator's
-- public fields without any client DB read.


-- ----------------------------------------------------------------------------
-- fitcircle_members — own-row only. Member lists / leaderboards go through
--   /api/fitcircles/[id]/participants and /leaderboard (service-role).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "fitcircle_members_select" ON fitcircle_members;
CREATE POLICY "fitcircle_members_select" ON fitcircle_members
  FOR SELECT
  USING (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- daily_tracking — own-row only. Cross-user check-in reads go through a route.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can select daily_tracking" ON daily_tracking;
CREATE POLICY "Authenticated users can select daily_tracking" ON daily_tracking
  FOR SELECT
  USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- fitcircles — public circles + own circles readable directly; private circles a
--   user belongs to are read via /api/fitcircles/[id] (service-role). Revoke anon
--   (invite preview no longer reads this table from the browser).
--   Uses only direct checks (visibility, creator_id) — no helper, no subquery.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "fitcircles_select" ON fitcircles;
CREATE POLICY "fitcircles_select" ON fitcircles
  FOR SELECT
  USING (visibility = 'public' OR creator_id = auth.uid());

REVOKE SELECT ON fitcircles FROM anon;


-- ----------------------------------------------------------------------------
-- progress_milestones — was completely unprotected (012). Enable RLS; reads are
--   service-role only (surfaced through the circle/challenge API routes). No
--   client SELECT policy + revoked SELECT = no direct browser access.
--   (If any browser code reads this table directly, route it — verify on staging.)
-- ----------------------------------------------------------------------------
ALTER TABLE progress_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "progress_milestones_select" ON progress_milestones;
REVOKE SELECT, INSERT, UPDATE, DELETE ON progress_milestones FROM authenticated;

-- ============================================================================
-- END 069_security_rls_hardening_crossuser
-- ============================================================================
