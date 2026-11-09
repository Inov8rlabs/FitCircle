-- 133_app_opens.sql
-- Server-side app opens (retention fix 4, 2026-11-09; lib/services/app-open-service.ts).
--
--   app_opens   one row per (user, local day, platform): the FIRST open of that day.
--               Written insert-or-ignore by AppOpenService after an authenticated
--               GET /api/mobile/entitlements, /api/mobile/targets or /api/mobile/home-feed
--               (the requests both shipped apps make on every app open / foreground,
--               never from background syncs). local_date is in the device zone
--               (X-Client-Timezone), else the profile zone, else America/New_York.
--               Read by the Day-1 morning push ("already opened this morning") and
--               GET /api/admin/retention (D1 / D7 by platform and source).
--
-- profiles.last_active_at already exists; the same writer now bumps it (at most every
-- 10 minutes), so the Day-1 skip works before this migration is applied.
--
-- Schema only: no functions, no triggers. Service-role only (RLS on, no policies).
-- Volume: ≈ daily active users × platforms per day (tens of rows/day today).
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/133_app_opens.sql
--   then insert '133' into supabase_migrations.schema_migrations,
--   then refresh the DB contract snapshot (node scripts/db-contract/refresh-snapshot.mjs).
-- Until it is applied the app fails soft: the app_opens write is skipped (logged once per
-- instance per 10 min) and the retention API reports signalSince = null.

create table if not exists public.app_opens (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  local_date     date not null,
  platform       text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  first_open_at  timestamptz not null default now(),
  timezone       text,
  app_version    text,
  -- which request recorded the first open: entitlements | targets | home_feed
  source         text not null,
  primary key (user_id, local_date, platform)
);

create index if not exists app_opens_local_date_idx on public.app_opens (local_date);
create index if not exists app_opens_first_open_at_idx on public.app_opens (first_open_at);

alter table public.app_opens enable row level security;
revoke all on public.app_opens from anon, authenticated;
grant select, insert, update, delete on public.app_opens to service_role;
