-- 139: Draft meals (docs/ENGAGEMENT_115_SPEC.md §14.6). Tables, columns, indexes, RLS only.
-- No stored procedures, functions or triggers. All logic lives in the TypeScript services
-- (lib/services/meal-draft-service.ts, lib/meal-drafts/*).
--
-- Apply ALONE (never `db push --include-all`), with founder approval at release:
--   npx -y supabase@latest db query --linked -f supabase/migrations/139_meal_drafts.sql
--   then insert the supabase_migrations.schema_migrations history row, refresh the DB contract
--   snapshot (node scripts/db-contract/refresh-snapshot.mjs), drop the 139 entries from
--   PENDING_RELATIONS in apps/web/__tests__/unit/db-contract.test.ts, and only THEN set
--   MEAL_DRAFTS_ENABLED=true in Vercel (the code never touches these columns while it is off).
--
-- Every existing row and every row written by old clients is 'confirmed' (column default), so
-- nothing changes until drafts are switched on.

-- A food-log entry is either a normal (confirmed) entry or a Draft meal: an AI result the user
-- left unsaved for 30 minutes. Drafts never count anywhere until confirmed.
-- (Constant default: no table rewrite. The inline check is created with the column.)
alter table public.food_log_entries
  add column if not exists entry_status text not null default 'confirmed'
  check (entry_status in ('confirmed', 'draft'));
alter table public.food_log_entries add column if not exists draft_created_at timestamptz;
-- photo | voice | text: the analysis method the draft came from.
alter table public.food_log_entries add column if not exists draft_method text;
alter table public.food_log_entries add column if not exists draft_analysis_id uuid;

-- Drafts per user (lists, Home card count) and the 14-day cleanup.
create index if not exists food_log_entries_drafts_idx
  on public.food_log_entries (user_id, draft_created_at)
  where entry_status = 'draft';
create index if not exists food_log_entries_draft_cleanup_idx
  on public.food_log_entries (draft_created_at)
  where entry_status = 'draft';

-- One row per successful AI meal analysis made by a 1.1.5+ client (X-Client-Features:
-- meal_drafts) while drafts are on. Holds the result the client was shown (and the photo path)
-- until the user saves it, discards it, or it becomes a Draft meal after 30 minutes.
create table if not exists public.meal_analysis_results (
  id           uuid primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  method       text not null check (method in ('photo', 'voice', 'text')),
  parse_hash   text,
  job_id       text,
  -- The draft DTO returned to the client (items, totals, confidence, model).
  draft        jsonb not null,
  -- Raw photo(s) in the private `food-logs` bucket under pending/<user>/<id>/ (photo only).
  image_paths  text[] not null default '{}',
  meal_type    text,
  timezone     text,
  captured_at  timestamptz not null default now(),
  status       text not null default 'pending'
               check (status in ('pending', 'saved', 'discarded', 'drafted', 'superseded', 'expired')),
  entry_id     uuid,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- Promotion cron: pending rows by age.
create index if not exists meal_analysis_results_pending_idx
  on public.meal_analysis_results (created_at)
  where status = 'pending';
-- Per-user lookups (supersede check, resolve on save / discard).
create index if not exists meal_analysis_results_user_idx
  on public.meal_analysis_results (user_id, created_at desc);
-- Cleanup of resolved rows.
create index if not exists meal_analysis_results_resolved_idx
  on public.meal_analysis_results (resolved_at)
  where status <> 'pending';
alter table public.meal_analysis_results enable row level security;
revoke all on public.meal_analysis_results from anon, authenticated;
