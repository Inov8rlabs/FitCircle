-- ============================================================================
-- 111: releases tracker — every iOS / Android / backend release, its status
-- history, store notes and internal notes (docs/RELEASES_TRACKER_SPEC.md).
--
-- Tables, indexes and constraints only. No functions, no triggers: the store
-- sync, status-change detection and admin edits live in
-- apps/web/app/lib/releases/* and write with the service role. RLS is enabled
-- with NO policies, so only the service role (admin API / cron) can read or
-- write these tables. updated_at is set by the application.
-- Idempotent.
-- ============================================================================

-- One row per (platform, track, version/build): an App Store version, a
-- TestFlight build, a Google Play track release, a backend production deploy.
create table if not exists public.releases (
  id                  uuid primary key default gen_random_uuid(),
  -- Stable identity used for idempotent upserts, e.g. 'ios:app_store:1.0.9',
  -- 'ios:testflight:1.1.0(72)', 'android:play_production:36', 'backend:production:517d8e1'.
  release_key         text not null,
  platform            text not null check (platform in ('ios', 'android', 'backend', 'web')),
  -- app_store / testflight / play_production / play_internal / play_alpha /
  -- play_beta / firebase_dev / production / preview ...
  track               text not null,
  version             text not null,
  -- iOS build number, Android versionCode, backend short SHA.
  build               text,
  -- Normalized status (lib/releases/status.ts): draft, processing, in_testing,
  -- waiting_for_review, in_review, pending_release, rejected, developer_rejected,
  -- rolling_out, live, halted, superseded, expired, removed.
  status              text not null,
  -- The store's own state string (e.g. READY_FOR_DISTRIBUTION, inProgress).
  store_status        text,
  release_type        text check (release_type in ('manual', 'auto', 'scheduled')),
  rollout_fraction    numeric(6, 5) check (rollout_fraction is null or (rollout_fraction >= 0 and rollout_fraction <= 1)),
  countries           text[],
  whats_new           text,
  -- Markdown, edited in Admin Tools. Never written by the store sync.
  internal_notes      text,
  known_issues        text,
  -- [{sha, subject, repo?, date?}]
  commits             jsonb not null default '[]'::jsonb,
  migrations          text[] not null default '{}',
  -- {label: url}
  links               jsonb not null default '{}'::jsonb,
  -- Where the row came from (the sync never deletes rows).
  source              text not null check (source in ('app_store_connect', 'google_play', 'git', 'manual', 'backfill')),
  source_id           text,
  store_created_at    timestamptz,
  uploaded_at         timestamptz,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  released_at         timestamptz,
  superseded_at       timestamptz,
  raw                 jsonb,
  synced_at           timestamptz,
  notes_updated_by    text,
  notes_updated_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint releases_release_key_key unique (release_key)
);
create index if not exists releases_platform_track_idx on public.releases (platform, track, released_at desc nulls last);
create index if not exists releases_status_idx on public.releases (status);
create index if not exists releases_created_idx on public.releases (coalesce(released_at, submitted_at, uploaded_at, created_at) desc);

-- Append-only status history. A row is written only when the status changes.
create table if not exists public.release_events (
  id            uuid primary key default gen_random_uuid(),
  release_id    uuid not null references public.releases(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  store_status  text,
  occurred_at   timestamptz not null,
  source        text not null check (source in ('sync', 'backfill', 'manual')),
  actor         text,
  note          text,
  created_at    timestamptz not null default now(),
  constraint release_events_release_status_at_key unique (release_id, to_status, occurred_at)
);
create index if not exists release_events_release_idx on public.release_events (release_id, occurred_at desc);
create index if not exists release_events_occurred_idx on public.release_events (occurred_at desc);

-- One row per store sync attempt (like ad_sync_runs).
create table if not exists public.release_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('app_store_connect', 'google_play')),
  trigger         text not null default 'cron' check (trigger in ('cron', 'manual', 'backfill')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  ok              boolean,
  rows_releases   integer not null default 0,
  rows_events     integer not null default 0,
  error           text
);
create index if not exists release_sync_runs_source_started_idx on public.release_sync_runs (source, started_at desc);

alter table public.releases          enable row level security;
alter table public.release_events    enable row level security;
alter table public.release_sync_runs enable row level security;
-- Intentionally no policies: service role only.
