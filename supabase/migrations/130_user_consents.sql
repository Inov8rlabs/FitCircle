-- 130_user_consents.sql
-- Server-side consent records (docs/PRIVACY_COMPLIANCE_SPEC.md §2).
--
-- One append-only row per consent decision (grant or withdrawal). The current
-- state for a (user, type) is the newest row by (granted_at, created_at). Rows
-- are never updated or deleted by the app; they disappear only with the user
-- (ON DELETE CASCADE on account deletion).
--
-- Types:
--   health_data      explicit consent to process health data (UK GDPR Art. 9(2)(a),
--                    PIPEDA express consent, India SPDI r.5). Record-only for now.
--   ai_processing    consent to send the user's data to third-party AI providers.
--                    Checked server-side on every AI route (ConsentService).
--   marketing_email  opt-in to marketing / lifecycle email.
--
-- Written ONLY by the backend with the service role (ConsentService). RLS is on
-- with NO client policies, and anon/authenticated are revoked, so clients can
-- neither read nor forge rows directly; they go through /api/mobile/consents.
--
-- Tables + indexes + RLS only. No functions, procedures or triggers.
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/130_user_consents.sql
-- then record '130' in supabase_migrations.schema_migrations.
-- Until it is applied, reads fail soft (no record) and writes return 503.

create table if not exists public.user_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  consent_type    text not null check (consent_type in ('health_data', 'ai_processing', 'marketing_email')),
  granted         boolean not null,
  -- The policy / consent-copy version the user saw, e.g. '2026-11'.
  policy_version  text not null check (char_length(policy_version) between 1 and 40),
  source          text not null check (source in ('ios', 'android', 'web', 'server')),
  app_version     text check (app_version is null or char_length(app_version) <= 40),
  -- When the user made the decision. Equals created_at unless a client migrated
  -- an on-device consent with its original timestamp (clamped server-side).
  granted_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table public.user_consents is
  'Append-only consent decisions (health_data, ai_processing, marketing_email). Service role only; see ConsentService.';

create index if not exists user_consents_user_type_idx
  on public.user_consents (user_id, consent_type, granted_at desc, created_at desc);

alter table public.user_consents enable row level security;
revoke all on public.user_consents from anon, authenticated;
grant select, insert on public.user_consents to service_role;
