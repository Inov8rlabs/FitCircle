-- 124: close the public_profiles view to API roles (production-readiness audit 2026-11-02).
--
-- The view bypasses RLS (security advisor: security_definer_view) and the anon key
-- shipped in the web bundle could list every user's id, username, display name and
-- avatar. Nothing in the backend, web, iOS or Android reads it; the backend uses the
-- service role for any cross-user profile reads. Revoking (not dropping) keeps it
-- available to service_role / postgres for ad-hoc use.

REVOKE ALL ON public.public_profiles FROM anon, authenticated;
