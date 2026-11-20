-- 138: Release 1.1.5 engagement (docs/ENGAGEMENT_115_SPEC.md §6). Tables, columns, indexes, RLS only.
-- No stored procedures, functions or triggers. All logic lives in the TypeScript services.
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/138_engagement_115.sql
--   then insert the supabase_migrations.schema_migrations history row, refresh the DB contract
--   snapshot (node scripts/db-contract/refresh-snapshot.mjs) and drop the 138 entries from
--   PENDING_RELATIONS in apps/web/__tests__/unit/db-contract.test.ts.
-- The code is fail-soft until this is applied (missing column / table → legacy behaviour).

-- F4: per-circle "share my meals here" memory (meal-logged success-screen toggles).
create table if not exists public.meal_share_circle_prefs (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  fitcircle_id uuid not null references public.fitcircles(id) on delete cascade,
  share        boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, fitcircle_id)
);
alter table public.meal_share_circle_prefs enable row level security;
revoke all on public.meal_share_circle_prefs from anon, authenticated;

-- F4: explicit per-meal circle list; NULL = legacy rule (every circle with tier 'full').
alter table public.food_log_entries add column if not exists share_circle_ids uuid[];

-- F3: weekly free Fitzy counting. Rows written before 138 have tier NULL and never count.
alter table public.fitzy_message_log add column if not exists tier text check (tier in ('free','pro'));
alter table public.fitzy_message_log add column if not exists context text;
create index if not exists fitzy_message_log_user_free_idx
  on public.fitzy_message_log (user_id, created_at desc) where tier = 'free';

-- F6: streak save offers (one per user per missed day).
create table if not exists public.streak_save_offers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  missed_date   date not null,
  lost_streak   integer not null,
  status        text not null default 'offered' check (status in ('offered','saved','expired')),
  method        text check (method in ('shield','pro_unlimited','after_purchase')),
  offered_at    timestamptz not null default now(),
  opened_at     timestamptz,
  saved_at      timestamptz,
  expires_at    timestamptz not null,
  unique (user_id, missed_date)
);
create index if not exists streak_save_offers_open_idx
  on public.streak_save_offers (user_id, status) where status = 'offered';
alter table public.streak_save_offers enable row level security;
revoke all on public.streak_save_offers from anon, authenticated;
