-- 115_paywall_last_opened.sql
--
-- APPLY ALONE (`npx -y supabase@latest db query --linked -f supabase/migrations/115_paywall_last_opened.sql`
-- then insert '115' into supabase_migrations.schema_migrations). Never `db push --include-all`:
-- 104 is still unapplied on purpose.
--
-- FitCircle 1.1.0 (docs/USER_TARGETS_CONTRACT.md §4, docs/RELEASE_1.1.0_PLAN.md W3): the Home
-- crown marker. GET /api/mobile/entitlements returns proBadge.marker = true for a non-subscriber
-- while a Pro offer is live AND they have not opened the paywall since it started. This column is
-- "last time the paywall was opened, automatically or by a tap", written by
-- POST /api/mobile/me/journey/events {event:'paywall_shown'} (JourneyService.markPaywallOpened).
-- profiles.paywall_auto_last_at (110) only records AUTOMATIC presentations, so it can't serve.
--
--   * ADDITIVE: one nullable column. Nothing dropped, renamed or backfilled.
--   * Idempotent (`if not exists`).
--   * No functions, procedures or triggers (CLAUDE.md); the marker rule lives in
--     apps/web/app/lib/entitlements/pro-badge.ts.
--   * Service-role writes only; profiles RLS is unchanged.
--
-- The API works without it: the write logs + no-ops and the read is treated as "never opened"
-- (the apps also clear the marker locally on paywall open, keyed by proBadge.offerId).
--
-- Also widens the onboarding flow checks from 112 to allow 'v3' (onboarding v3, 1.1.0). Apply this
-- BEFORE deploying code that accepts flow 'v3', or saves with v3 fail the constraint.
--
-- Daily targets (calories / protein / carbs / fat / water / steps) need NO migration: they live in
-- profiles.preferences.nutrition, preferences.hydration and goals[type=steps] (jsonb).

alter table public.profiles add column if not exists paywall_last_opened_at timestamptz;

comment on column public.profiles.paywall_last_opened_at is
  'Last time the Pro paywall was opened (automatic or user tap). Clears the Home crown marker for offers that started earlier. App-written via /api/mobile/me/journey/events.';

-- Onboarding v3: allow flow 'v3' (112 allowed v1/v2). Drop + re-add is idempotent.
alter table public.profiles drop constraint if exists profiles_onboarding_flow_check;
alter table public.profiles
  add constraint profiles_onboarding_flow_check check (onboarding_flow is null or onboarding_flow in ('v1', 'v2', 'v3'));

alter table public.onboarding_progress drop constraint if exists onboarding_progress_flow_check;
alter table public.onboarding_progress
  add constraint onboarding_progress_flow_check check (flow is null or flow in ('v1', 'v2', 'v3'));
