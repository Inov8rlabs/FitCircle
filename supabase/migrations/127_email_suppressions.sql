-- 127_email_suppressions.sql
-- Email suppression list (docs/EMAIL_QUALITY.md §C).
--
-- Addresses that hard-bounced or marked a FitCircle email as spam, written by
-- POST /api/webhooks/resend and read before EVERY email send
-- (lib/email/email-service.ts → lib/email/suppression.ts).
--
-- Keyed by the salted hash of the lower-cased address (same hash as
-- referral_invites.contact_hash / referral_email_optouts.email_hash:
-- sha256('<REFERRAL_DEVICE_SALT>:email:<address>')), so we keep no plaintext
-- address for people who aren't members.
--
-- Schema only: no functions, no triggers. Service role only (RLS on, no policies).
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/127_email_suppressions.sql
--   then insert '127' into supabase_migrations.schema_migrations.
-- The app fails open (sends without the check, logs loudly) until this exists.

create table if not exists public.email_suppressions (
  email_hash             text primary key,
  reason                 text not null check (reason in ('hard_bounce', 'complaint', 'manual')),
  domain                 text,
  source                 text not null default 'resend_webhook',
  first_event_at         timestamptz not null default now(),
  last_event_at          timestamptz not null default now(),
  event_count            integer not null default 1 check (event_count >= 1),
  last_provider_email_id text,
  detail                 jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

comment on table public.email_suppressions is
  'Hard-bounced / complained email addresses (hashed). Every FitCircle email send skips these. Written by /api/webhooks/resend.';

create index if not exists email_suppressions_reason_idx on public.email_suppressions (reason, last_event_at desc);

alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;
grant select, insert, update, delete on public.email_suppressions to service_role;
