-- 137_circle_leaderboard_snapshots.sql
-- Daily circle leaderboard snapshots for the "someone moved past you" push
-- (docs/PUSH_NOTIFICATIONS.md §8.6; lib/services/leaderboard-overtake-service.ts).
--
--   circle_leaderboard_snapshots   one row per (circle, circle-local date, metric, member):
--               the member's value on the circle's own leaderboard metric, taken once a day
--               in the circle's 18:00 hour by /api/cron/leaderboard-overtakes, and its
--               competition rank. Today's snapshot is diffed against yesterday's to find
--               genuine passes. Metrics: 'total_steps' (steps circles) | 'goal_progress'
--               (every other circle; members with a goal only). Members who hide their
--               progress are never written.
--
-- Numbering: 136 is reserved by another branch; this is 137.
-- Schema only: no functions, no triggers. Service-role only (RLS on, no policies).
-- Volume: live private circles × members per day (tens of rows/day today). Rows older
-- than a few days are not read again; safe to prune.
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/137_circle_leaderboard_snapshots.sql
--   then insert '137' into supabase_migrations.schema_migrations,
--   then refresh the DB contract snapshot (node scripts/db-contract/refresh-snapshot.mjs).
-- Until it is applied the cron fails soft: snapshot reads/writes error, so no pass is
-- ever detected and nothing is sent.

create table if not exists public.circle_leaderboard_snapshots (
  circle_id      uuid not null references public.fitcircles(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  snapshot_date  date not null,
  metric         text not null check (metric in ('total_steps', 'goal_progress')),
  value          numeric not null,
  rank           integer,
  created_at     timestamptz not null default now(),
  primary key (circle_id, snapshot_date, metric, user_id)
);

create index if not exists circle_leaderboard_snapshots_date_idx on public.circle_leaderboard_snapshots (snapshot_date);

alter table public.circle_leaderboard_snapshots enable row level security;
