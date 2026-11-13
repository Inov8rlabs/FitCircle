-- 136_user_active_days.sql
-- Daily user activity from Amplitude (PMF retention fix, 2026-11-12;
-- lib/activity/amplitude-sync-service.ts, GET /api/cron/activity/amplitude-sync).
--
--   user_active_days       one row per (user, local day, platform, source): the user did at
--                          least one user action that day. source = 'amplitude' (Export API,
--                          every client version; background sync / push delivery / security
--                          events excluded — AMPLITUDE_INACTIVE_EVENT_TYPES) or 'app_opens'
--                          (reserved; app_opens is read directly today). local_date is in the
--                          profile time zone at sync time (else America/New_York); first_at /
--                          last_at are the UTC instants of the first / last counted event, which
--                          is what reports bucket by (so a later time-zone change is harmless).
--                          Read by the PMF scorecard and the Finance DAU via FinanceData.activity.
--   amplitude_export_sync  one row per synced UTC hour ('YYYYMMDDTHH'): makes re-runs skip hours
--                          already merged (event_count accumulates), and gives the coverage start
--                          (earliest hour) that retention cohorts are gated on.
--
-- Schema only: no functions, no triggers. Service-role only (RLS on, no policies).
-- Volume: ≈ daily active users × platforms per day (tens of rows/day today); 24 rows/day sync log.
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/136_user_active_days.sql
--   then insert '136' into supabase_migrations.schema_migrations,
--   then refresh the DB contract snapshot (node scripts/db-contract/refresh-snapshot.mjs).
-- Until it is applied the reports fail soft (FinanceData.activity notes the missing table and
-- falls back to Home feed loads / app opens / meals) and the sync cron returns 500.

create table if not exists public.user_active_days (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  local_date   date not null,
  platform     text not null default 'unknown' check (platform in ('ios', 'android', 'web', 'unknown')),
  source       text not null check (source in ('amplitude', 'app_opens')),
  first_at     timestamptz not null,
  last_at      timestamptz not null,
  event_count  int not null default 1,
  primary key (user_id, local_date, platform, source)
);

create index if not exists user_active_days_local_date_idx on public.user_active_days (local_date);
create index if not exists user_active_days_first_at_idx on public.user_active_days (first_at);

alter table public.user_active_days enable row level security;
revoke all on public.user_active_days from anon, authenticated;
grant select, insert, update, delete on public.user_active_days to service_role;

create table if not exists public.amplitude_export_sync (
  hour       text primary key check (hour ~ '^[0-9]{8}T[0-9]{2}$'), -- YYYYMMDDTHH, UTC
  synced_at  timestamptz not null default now(),
  events     int not null,
  users      int not null
);

alter table public.amplitude_export_sync enable row level security;
revoke all on public.amplitude_export_sync from anon, authenticated;
grant select, insert, update, delete on public.amplitude_export_sync to service_role;
