-- ============================================================================
-- 108: ads console — spend, ROAS and bid control (docs/ADS_CONSOLE_SPEC.md §3).
--
-- Tables, indexes and constraints only. No functions, no triggers: sync,
-- metrics, guardrails and attribution live in apps/web/app/lib/ads/* and are
-- written with the service role. RLS is enabled with NO policies, so only the
-- service role (admin API / cron) can read or write these tables.
--
-- Revenue is not copied here: it is read from subscription_events
-- (environment = 'PRODUCTION') at query time.
-- Idempotent.
-- ============================================================================

-- One row per remote ad-network object (campaign / ad group / keyword / ad).
create table if not exists public.ad_entities (
  id                    uuid primary key default gen_random_uuid(),
  channel               text not null check (channel in ('apple_ads', 'meta', 'google_ads')),
  platform              text not null default 'all' check (platform in ('ios', 'android', 'web', 'all')),
  level                 text not null check (level in ('campaign', 'ad_group', 'keyword', 'ad', 'creative')),
  external_id           text not null,
  parent_external_id    text,
  campaign_external_id  text,
  name                  text,
  status                text,
  serving_status        text,
  bid_strategy          text,
  bid_amount            numeric(12, 2),
  bid_currency          text,
  daily_budget          numeric(12, 2),
  total_budget          numeric(12, 2),
  match_type            text,
  countries             text[],
  start_at              timestamptz,
  end_at                timestamptz,
  -- e.g. {productPageId, productPageName, thumbnailUrl, headline, body}
  creative              jsonb,
  raw                   jsonb,
  synced_at             timestamptz not null default now(),
  constraint ad_entities_channel_level_external_key unique (channel, level, external_id)
);
create index if not exists ad_entities_campaign_idx on public.ad_entities (channel, campaign_external_id, level);
create index if not exists ad_entities_parent_idx on public.ad_entities (channel, parent_external_id);

-- Daily delivery per entity. Upserted; the last 3 days are re-pulled each sync.
create table if not exists public.ad_metrics_daily (
  channel               text not null,
  level                 text not null check (level in ('campaign', 'ad_group', 'keyword', 'ad', 'creative')),
  external_id           text not null,
  campaign_external_id  text,
  date                  date not null,
  spend                 numeric(12, 2) not null default 0,
  currency              text not null default 'USD',
  impressions           integer not null default 0,
  taps                  integer not null default 0,
  installs              integer not null default 0,
  new_downloads         integer not null default 0,
  redownloads           integer not null default 0,
  synced_at             timestamptz not null default now(),
  primary key (channel, level, external_id, date)
);
create index if not exists ad_metrics_daily_date_idx on public.ad_metrics_daily (date, level);
create index if not exists ad_metrics_daily_campaign_idx on public.ad_metrics_daily (channel, campaign_external_id, date);

-- One row per user: first touch wins (only an 'unknown' row may be upgraded).
create table if not exists public.user_attribution (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  channel               text not null check (channel in ('apple_ads', 'meta', 'google_ads', 'organic', 'unknown')),
  platform              text check (platform in ('ios', 'android', 'web')),
  source                text not null,
  campaign_external_id  text,
  ad_group_external_id  text,
  keyword_external_id   text,
  ad_external_id        text,
  click_at              timestamptz,
  country               text,
  -- Apple's mock AdServices payload (campaign 1234567890) — excluded from metrics.
  is_test               boolean not null default false,
  raw                   jsonb,
  reported_at           timestamptz not null default now()
);
create index if not exists user_attribution_channel_campaign_idx on public.user_attribution (channel, campaign_external_id);

-- Audit of every bid / budget / status change attempt (incl. rejected + dry-run).
create table if not exists public.ad_change_log (
  id                uuid primary key default gen_random_uuid(),
  -- Null when the call came through ADMIN_API_SECRET (then actor_email is set).
  actor_user_id     uuid references public.profiles(id) on delete set null,
  -- X-Admin-Actor from the separate admin app (server-to-server), or the admin's email.
  actor_email       text,
  channel           text not null,
  level             text not null,
  external_id       text not null,
  campaign_external_id text,
  entity_name       text,
  field             text not null check (field in ('bid', 'daily_budget', 'status')),
  old_value         text,
  new_value         text,
  requested_value   text,
  outcome           text not null check (outcome in ('applied', 'rejected', 'failed', 'dry_run')),
  forced            boolean not null default false,
  error             text,
  checks            jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists ad_change_log_created_idx on public.ad_change_log (created_at desc);
create index if not exists ad_change_log_entity_idx on public.ad_change_log (channel, level, external_id, created_at desc);

-- One row per connector sync attempt.
create table if not exists public.ad_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null,
  trigger         text not null default 'cron' check (trigger in ('cron', 'manual', 'backfill')),
  range_start     date,
  range_end       date,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  ok              boolean,
  rows_entities   integer not null default 0,
  rows_metrics    integer not null default 0,
  error           text
);
create index if not exists ad_sync_runs_channel_started_idx on public.ad_sync_runs (channel, started_at desc);

-- Cohort reads: users by sign-up time.
create index if not exists idx_profiles_created_at on public.profiles (created_at);

alter table public.ad_entities      enable row level security;
alter table public.ad_metrics_daily enable row level security;
alter table public.user_attribution enable row level security;
alter table public.ad_change_log    enable row level security;
alter table public.ad_sync_runs     enable row level security;
-- Intentionally no policies: service role only.
