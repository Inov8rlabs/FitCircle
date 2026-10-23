-- ============================================================================
-- 107: Fitzy coaching tips as push notifications (docs/FITZY_PUSH_NOTIFICATIONS.md).
-- Schema only: eligibility, timing, caps, copy and delivery live in
-- apps/web/app/lib/fitzy/push.ts and apps/web/app/lib/services/fitzy-push-service.ts.
-- No functions, no triggers. Idempotent.
-- ============================================================================

-- "Coaching tips from Fitzy" preference toggle (category `coach`). Defaults ON,
-- like every other category; null is treated as ON in code.
alter table public.notification_preferences
  add column if not exists coach_enabled boolean default true;

-- Dedupe ledger: one row per (user, slot, local date). The primary key makes
-- concurrent or retried cron runs send at most one morning tip and one
-- contextual nudge per user per local day ("claim first, then send").
create table if not exists public.fitzy_push_deliveries (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  delivery_key  text not null,              -- '<slot>:<YYYY-MM-DD>' e.g. 'morning:2026-10-22'
  kind          text not null,              -- notification type, e.g. 'fitzy_daily_focus'
  local_date    date not null,
  status        text not null default 'claimed', -- claimed | sent | <suppression reason>
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, delivery_key)
);
create index if not exists fitzy_push_deliveries_kind_date_idx
  on public.fitzy_push_deliveries (kind, local_date);

alter table public.fitzy_push_deliveries enable row level security;
-- Service role only; no anon/authenticated policies.

comment on table public.fitzy_push_deliveries is
  'Dedupe ledger for Fitzy coaching pushes (one per user per slot per local day). See docs/FITZY_PUSH_NOTIFICATIONS.md.';
comment on column public.notification_preferences.coach_enabled is
  '"Coaching tips from Fitzy" push toggle (category coach). Null = on.';
