-- 131: profiles.date_of_birth becomes server-only (docs/PRIVACY_COMPLIANCE_SPEC.md §5).
--
-- The 18+ rule is enforced in the API (PUT /api/mobile/profile, /profile/settings,
-- /onboarding/*). Migration 128 still lets `authenticated` write date_of_birth straight
-- through PostgREST, which bypasses that check. The web onboarding page now saves the
-- date through PUT /api/mobile/profile; the iOS/Android apps never write profiles directly.
--
-- ORDER: apply AFTER migration 128 (column grants, already in prod) AND AFTER the web
-- release that stops writing date_of_birth directly is live (an old cached web bundle
-- that still sends date_of_birth would get 42501 on its onboarding save).
--
-- Column privileges only. No functions or triggers. Apply alone:
--   npx -y supabase@latest db query --linked -f supabase/migrations/131_profiles_dob_server_only.sql
-- then record '131' in supabase_migrations.schema_migrations.

revoke insert (date_of_birth) on public.profiles from authenticated;
revoke update (date_of_birth) on public.profiles from authenticated;
