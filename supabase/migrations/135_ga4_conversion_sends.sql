-- 135_ga4_conversion_sends.sql
-- Server-side GA4 subscription conversions (docs/GA4_SERVER_CONVERSIONS.md).
--
--   ga4_conversion_sends  one row per subscription_events row that maps to a GA4
--                         conversion (trial_started_server, purchase_server,
--                         trial_converted, subscription_renewed, refund). It is the
--                         exactly-once record for the Measurement Protocol send:
--                         the PK insert is the claim; status 'sent' is never sent
--                         again (RevenueCat retries, the sweep cron, concurrent runs).
--                         Rows skipped for a missing Firebase app instance id are
--                         how that gap is counted.
--
-- Schema only: no functions, no triggers. Service-role only (RLS on, no policies).
-- Volume: ≤ subscription_events (a few per paying user per month).
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/135_ga4_conversion_sends.sql
--   then insert '135' into supabase_migrations.schema_migrations,
--   then refresh the DB contract snapshot (node scripts/db-contract/refresh-snapshot.mjs).
-- Until it is applied the app fails soft: nothing is sent (no idempotency record,
-- no send), logged once per instance per 10 min.

create table if not exists public.ga4_conversion_sends (
  subscription_event_id text primary key references public.subscription_events(id) on delete cascade,
  user_id               uuid references public.profiles(id) on delete set null,
  -- GA4 event name sent (or that would have been sent).
  event_name            text not null,
  -- RevenueCat event time (what timestamp_micros carries).
  event_at              timestamptz,
  status                text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  -- skipped: no_app_instance_id (retried by the sweep) | test_user | ios_user | no_user
  skip_reason           text,
  attempts              integer not null default 1,
  -- Value / currency sent (USD gross unless RevenueCat had no USD price).
  value                 numeric(14, 2),
  currency              text,
  http_status           integer,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  sent_at               timestamptz
);

create index if not exists ga4_conversion_sends_status_idx on public.ga4_conversion_sends (status, updated_at);
create index if not exists ga4_conversion_sends_user_idx on public.ga4_conversion_sends (user_id);

alter table public.ga4_conversion_sends enable row level security;
-- Intentionally no policies: service role only.
