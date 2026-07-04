-- ============================================================================
-- Migration 066: Security / RLS Hardening — SAFE / SHIP-NOW blocks
--
-- This half closes real RLS holes WITHOUT tightening any cross-user SELECT that
-- the web app reads directly from the browser, so it breaks no existing flow and
-- needs no app-code changes. Every statement is idempotent (DROP ... IF EXISTS,
-- guarded ALTER/REVOKE) and uses NO helper functions / stored procedures, in line
-- with CLAUDE.md ("keep RLS simple: only check auth.uid()").
--
-- The cross-user SELECT tightening (profiles / fitcircles / fitcircle_members /
-- daily_tracking) lives in the companion migration 069_security_rls_hardening_
-- crossuser.sql, which MUST land together with the browser-read rewiring and be
-- staging-verified first.
--
-- Recommended: deploy this file after a staging smoke test of payments read,
-- notifications mark-read, and circle streak surfaces.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. fitcircle_members — kill self role-escalation (UPDATE only; SELECT unchanged)
--    Any authenticated (anon-key/browser) user could UPDATE their own membership
--    row to role='owner' or inflate progress_percentage/high_fives (038:271).
--    Legit member mutations go through service-role API routes (unaffected).
--    NOTE: SELECT tightening for this table is deferred to 067.
-- ----------------------------------------------------------------------------
REVOKE UPDATE ON fitcircle_members FROM authenticated;

-- Defense-in-depth own-row UPDATE policy in case a future migration re-grants UPDATE.
DROP POLICY IF EXISTS "fitcircle_members_update" ON fitcircle_members;
CREATE POLICY "fitcircle_members_update" ON fitcircle_members
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2. payments — remove client write access (002:378-385)
--    Any authenticated user could INSERT payment rows or set anyone's to
--    'refunded'. Payments are written only by the service role (Stripe webhooks).
--    Own-row SELECT policy + SELECT grant remain so users see their own history.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can create payments" ON payments;
DROP POLICY IF EXISTS "System can update payments" ON payments;
REVOKE INSERT, UPDATE, DELETE ON payments FROM authenticated;


-- ----------------------------------------------------------------------------
-- 3. notifications + achievements — remove client INSERT (002:257 / 002:399)
--    Any user could push arbitrary in-app notifications (phishing title/body/url)
--    or mint achievements. Both are written by the service role.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can create notifications" ON notifications;
REVOKE INSERT ON notifications FROM authenticated;

DROP POLICY IF EXISTS "System can create achievements" ON achievements;
REVOKE INSERT ON achievements FROM authenticated;


-- ----------------------------------------------------------------------------
-- 4. circle_streak_tracking — drop the "any logged-in user" FOR ALL policy (022:198)
--    USING(auth.uid() IS NOT NULL) let anyone read/write any circle's streak row.
--    Service-role writes bypass RLS; the member-scoped SELECT policy from 022 stays.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can manage circle streaks" ON circle_streak_tracking;


-- ----------------------------------------------------------------------------
-- 5. Views that bypass RLS -> enforce caller RLS (027:146 / 011:308)
--    current_weekly_goals and challenge_with_participants ran as the view owner
--    and leaked every user's rows (incl. invite_code). security_invoker makes
--    them inherit the caller's policies.
-- ----------------------------------------------------------------------------
ALTER VIEW IF EXISTS public.current_weekly_goals SET (security_invoker = true);
ALTER VIEW IF EXISTS public.challenge_with_participants SET (security_invoker = true);


-- ----------------------------------------------------------------------------
-- 6. circle_invites — match on verified JWT email, not the mutable profiles.email
--    (008:204 / 008:189). `authenticated` holds no table grant on circle_invites
--    (writes go through service-role routes), so these are defense-in-depth. Kept
--    helper-free: co-membership visibility (previously via a helper) is dropped;
--    an invitee sees their own invites by verified email, an inviter by id.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update their own invites" ON circle_invites;
CREATE POLICY "Users can update their own invites" ON circle_invites
  FOR UPDATE
  USING (auth.uid() = inviter_id OR email = (auth.jwt() ->> 'email'))
  WITH CHECK (auth.uid() = inviter_id OR email = (auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Users can view invites for their circles" ON circle_invites;
CREATE POLICY "Users can view invites for their circles" ON circle_invites
  FOR SELECT
  USING (auth.uid() = inviter_id OR email = (auth.jwt() ->> 'email'));


-- ----------------------------------------------------------------------------
-- 7. Blanket / over-broad grants -> least privilege (002:412-414, 031:352/355)
--    Strip non-CRUD privileges (TRUNCATE/REFERENCES/TRIGGER) from `authenticated`;
--    row-gated SELECT/INSERT/UPDATE/DELETE are preserved. food_log_audit is an
--    append-only, service-role-written audit trail — lock the client to SELECT.
-- ----------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON food_log_audit FROM authenticated;
GRANT SELECT ON food_log_audit TO authenticated;


-- ----------------------------------------------------------------------------
-- 8. Drop stale / unhardened SECURITY DEFINER functions (011 / 029)
--    join_challenge_with_code: 0 app callers, logic lives in the TS service layer.
--    decrement_shield_count: had no auth check (let anyone burn a victim's
--    shields); already dropped in 064, guarded here.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.join_challenge_with_code(text, numeric, numeric);
DROP FUNCTION IF EXISTS public.decrement_shield_count(uuid, character varying);

-- ============================================================================
-- END 066_security_rls_hardening_safe
-- ============================================================================
