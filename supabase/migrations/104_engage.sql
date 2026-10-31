-- ============================================================================
-- 104: FitCircle Engage — assets, segments, messages, events, deliveries,
-- dismissals, exposures (docs/ENGAGE_SPEC.md §14) + campaigns.platforms (§15)
-- + the public `engage-assets` bucket.
--
-- Schema only. Targeting, variant assignment, delivery, capping and analytics
-- live in apps/web/app/lib/engage/* and apps/web/app/lib/services/engage-*.ts.
-- No functions, no triggers. Idempotent.
-- ============================================================================

-- Campaigns get platform targeting (empty = all).
alter table public.campaigns
  add column if not exists platforms text[] not null default '{}';

-- ---------------------------------------------------------------- assets
create table if not exists public.engage_assets (
  id              uuid primary key default gen_random_uuid(),
  sha256          text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  name            text not null,
  mime            text not null check (mime in ('image/png','image/jpeg','image/webp','image/gif')),
  width           integer not null check (width > 0),
  height          integer not null check (height > 0),
  bytes           integer not null check (bytes > 0),
  url             text not null,
  variants        jsonb not null default '[]'::jsonb,
  dominant_color  text not null default '#1f2937',
  tags            text[] not null default '{}',
  alt             text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index if not exists engage_assets_created_idx on public.engage_assets (created_at desc) where archived_at is null;

-- ---------------------------------------------------------------- segments
create table if not exists public.engage_segments (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text not null default '',
  filters          jsonb not null default '[]'::jsonb,
  estimated_count  integer,
  estimated_at     timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);

-- ---------------------------------------------------------------- messages
create table if not exists public.engage_messages (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  campaign_id               uuid references public.campaigns(id) on delete set null,
  channel                   text not null check (channel in ('content_card','in_app','push','email')),
  placement                 text check (placement is null or placement in ('home_hero','home_feed','circles_top','profile_top','post_checkin')),
  layout                    text check (layout is null or layout in ('hero','card','banner','captioned_image','image_only','modal','slideup','fullscreen')),
  published                 boolean not null default false,
  published_at              timestamptz,
  paused_at                 timestamptz,
  archived_at               timestamptz,
  variants                  jsonb not null default '[]'::jsonb,
  control_weight            integer not null default 0 check (control_weight between 0 and 50),
  segment_id                uuid references public.engage_segments(id) on delete set null,
  audience_filters          jsonb not null default '[]'::jsonb,
  platforms                 text[] not null default '{}',
  starts_at                 timestamptz not null default now(),
  ends_at                   timestamptz,
  send_mode                 text check (send_mode is null or send_mode in ('immediate','scheduled','local_time')),
  send_at                   timestamptz,
  local_hour                integer check (local_hour is null or local_hour between 0 and 23),
  send_completed_at         timestamptz,
  trigger                   jsonb,
  max_impressions_per_user  integer check (max_impressions_per_user is null or max_impressions_per_user > 0),
  min_hours_between         integer check (min_hours_between is null or min_hours_between >= 0),
  priority                  integer not null default 0,
  respect_global_cap        boolean not null default true,
  conversion                jsonb,
  preview_user_ids          uuid[] not null default '{}',
  created_by                uuid references public.profiles(id) on delete set null,
  updated_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  version                   integer not null default 1,
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists engage_messages_channel_idx on public.engage_messages (channel) where archived_at is null;
create index if not exists engage_messages_campaign_idx on public.engage_messages (campaign_id) where campaign_id is not null;

-- ---------------------------------------------------------------- events
create table if not exists public.engage_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  message_id   uuid references public.engage_messages(id) on delete cascade,
  variant_id   text,
  type         text not null check (type in ('impression','click','dismiss','push_open','app_event')),
  name         text,
  props        jsonb not null default '{}'::jsonb,
  platform     text check (platform is null or platform in ('ios','android','web')),
  at           timestamptz not null,
  received_at  timestamptz not null default now()
);
create index if not exists engage_events_message_type_at_idx on public.engage_events (message_id, type, at) where message_id is not null;
create index if not exists engage_events_user_name_at_idx on public.engage_events (user_id, name, at);
create index if not exists engage_events_user_type_at_idx on public.engage_events (user_id, type, at);

-- Who was assigned what (variant or 'control') the first time they were
-- eligible — the denominator for conversion rate and lift.
create table if not exists public.engage_exposures (
  message_id   uuid not null references public.engage_messages(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  variant_id   text not null,
  platform     text check (platform is null or platform in ('ios','android','web')),
  first_at     timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists engage_exposures_message_idx on public.engage_exposures (message_id, variant_id);

-- Push/email send ledger: one row per (message, user, platform); email uses platform 'email'.
create table if not exists public.engage_deliveries (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.engage_messages(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  variant_id   text not null,
  channel      text not null check (channel in ('push','email')),
  platform     text not null check (platform in ('ios','android','web','email')),
  sent_at      timestamptz not null default now(),
  unique (message_id, user_id, platform)
);
create index if not exists engage_deliveries_message_idx on public.engage_deliveries (message_id, variant_id);

-- Content card dismissals are permanent per user.
create table if not exists public.engage_dismissals (
  message_id  uuid not null references public.engage_messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  at          timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists engage_dismissals_user_idx on public.engage_dismissals (user_id);

alter table public.engage_assets      enable row level security;
alter table public.engage_segments    enable row level security;
alter table public.engage_messages    enable row level security;
alter table public.engage_events      enable row level security;
alter table public.engage_exposures   enable row level security;
alter table public.engage_deliveries  enable row level security;
alter table public.engage_dismissals  enable row level security;
-- Service role only; no anon/authenticated policies.

-- Content-addressed, immutable asset files (a/{sha256}.{ext}, a/{sha256}@{w}.webp).
insert into storage.buckets (id, name, public)
values ('engage-assets', 'engage-assets', true)
on conflict (id) do nothing;

comment on table public.engage_messages is 'Engage messages (docs/ENGAGE_SPEC.md §5). Status computed in engage-message-service.ts.';
comment on table public.engage_exposures is 'First eligible assignment per user per message (variant or control) — denominator for lift.';
