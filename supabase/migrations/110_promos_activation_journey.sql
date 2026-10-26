-- ============================================================================
-- 110: promos + activation journey (docs/PROMO_CARD_SPEC.md §5,
--      docs/ACTIVATION_JOURNEY_SPEC.md §3, §5, §6).
--
-- Tables, columns, indexes and the four system promo rows only. Eligibility,
-- caps, creative bucketing, action resolution, conversions, the journey state
-- and meal reminders all live in TypeScript (apps/web/app/lib/promos/*,
-- lib/journey/*, lib/services/promo-service.ts, journey-service.ts,
-- meal-reminder-service.ts). No functions, no triggers (updated_at is set by
-- the services). Idempotent. RLS on, no anon/authenticated policies: the
-- service role goes through the API routes.
--
-- Everything here is additive and safe to apply before any code that reads it:
-- the feed treats a missing table as "unknown" (no promos), and every write is
-- best-effort.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- promos — one row per promo. v1 promos are CODE-DEFINED system promos
-- (lib/promos/system-promos.ts); their rows exist so promo_user_state can
-- reference them and so the admin portal promo editor (later) has its table.
-- For system promos `creatives` stays '[]' (the creatives are in code) and
-- ops pause them with PROMOS_DISABLED_KEYS / PROMOS_ENABLED.
-- ----------------------------------------------------------------------------
create table if not exists public.promos (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key ~ '^[a-z0-9_]{3,60}$'),
  name             text not null,
  -- true = defined in code (lib/promos/system-promos.ts); the admin editor must not edit creatives.
  system           boolean not null default false,
  campaign_id      uuid references public.campaigns(id) on delete set null,
  status           text not null default 'draft'
                     check (status in ('draft', 'scheduled', 'live', 'paused', 'ended', 'archived')),
  placement        text not null default 'home_feed',
  starts_at        timestamptz,
  ends_at          timestamptz,
  phases           text[] not null default '{teaser,live}',
  priority         integer not null default 0,
  audience         jsonb not null default '{}'::jsonb,
  platforms        text[],
  min_app_version  text,
  max_app_version  text,
  -- { perDay?, perWeek?, total?, cooldownHoursAfterDismiss?, hideAfterConversion? }
  caps             jsonb not null default '{}'::jsonb,
  -- [{ id, weight, layout, …PROMO_CARD_SPEC §3 fields… }] (1–4); '[]' for system promos.
  creatives        jsonb not null default '[]'::jsonb,
  experiment_key   text,
  created_by       uuid references public.profiles(id) on delete set null,
  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists promos_live_idx on public.promos (placement, status) where status in ('live', 'scheduled');
create index if not exists promos_campaign_idx on public.promos (campaign_id) where campaign_id is not null;

-- ----------------------------------------------------------------------------
-- promo_user_state — one row per (user, promo). Written after the response
-- from the home-feed events batch (impression / tap / cta / dismiss) and from
-- conversion hooks (first meal logged, subscription started, Fitzy opened).
-- Keyed by promo KEY (not uuid) so code-defined promos need no id lookup;
-- on update cascade keeps it consistent if a key is ever renamed.
--
--   impressions_day / day      → perDay cap (day = the viewer's local date)
--   seen_days                  → perWeek cap = distinct local days with an
--                                impression in the last 7 days (newest first,
--                                at most 14 kept)
--   impressions_total          → total cap
--   dismissed_at               → cooldownHoursAfterDismiss
--   tapped_at                  → conversion window start (7 days)
--   converted_at               → hideAfterConversion + Promo Converted
-- ----------------------------------------------------------------------------
create table if not exists public.promo_user_state (
  user_id            uuid not null references public.profiles(id) on delete cascade,
  promo_key          text not null references public.promos(key) on update cascade on delete cascade,
  creative_id        text,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  impressions_total  integer not null default 0,
  impressions_day    integer not null default 0,
  day                date,
  seen_days          date[] not null default '{}',
  dismissed_at       timestamptz,
  tapped_at          timestamptz,
  tapped_button      text check (tapped_button is null or tapped_button in ('primary', 'secondary')),
  converted_at       timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (user_id, promo_key)
);
-- Results per creative (admin, later).
create index if not exists promo_user_state_promo_creative_idx on public.promo_user_state (promo_key, creative_id);

alter table public.promos           enable row level security;
alter table public.promo_user_state enable row level security;

comment on table public.promos is
  'Server-driven promo cards (docs/PROMO_CARD_SPEC.md). system=true rows are code-defined (lib/promos/system-promos.ts).';
comment on table public.promo_user_state is
  'Per-user promo caps/dismissal/conversion state, written by PromoService after the response.';

-- The four v1 system promos (ACTIVATION_JOURNEY_SPEC §3). Copy, audience and
-- caps live in code; these rows only anchor promo_user_state.
insert into public.promos (key, name, system, status, priority)
values
  ('first_meal',   'System: snap your first meal',       true, 'live', 0),
  ('log_meal_now', 'System: log the current meal slot',  true, 'live', 0),
  ('pro_value',    'System: Pro value proposition',      true, 'live', 0),
  ('meet_fitzy',   'System: meet Fitzy',                 true, 'live', 0)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- home_feed_events: promo fields (PROMO_CARD_SPEC §6.3). Optional on every
-- event; set by clients that render promo@1 cards.
-- ----------------------------------------------------------------------------
alter table public.home_feed_events add column if not exists promo_key   text;
alter table public.home_feed_events add column if not exists creative_id text;
alter table public.home_feed_events add column if not exists button      text;
create index if not exists home_feed_events_promo_idx
  on public.home_feed_events (promo_key, creative_id, event) where promo_key is not null;

-- ----------------------------------------------------------------------------
-- profiles: activation journey state (ACTIVATION_JOURNEY_SPEC §5, §6).
--   fitzy_opened_at       first time the user opened Fitzy (any entry point)
--   fitzy_intro_seen_at   the post-first-meal "Meet Fitzy" sheet was shown
--   paywall_auto_last_at  last AUTOMATICALLY presented paywall (72 h spacing)
--   paywall_aha_shown_at  the once-only post-first-meal soft paywall was shown
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists fitzy_opened_at      timestamptz;
alter table public.profiles add column if not exists fitzy_intro_seen_at  timestamptz;
alter table public.profiles add column if not exists paywall_auto_last_at timestamptz;
alter table public.profiles add column if not exists paywall_aha_shown_at timestamptz;

-- Backfill: anyone who has already chatted with Fitzy has met Fitzy (so the
-- meet_fitzy promo and the fitzy_intro push skip them). One-off data update.
update public.profiles p
set fitzy_opened_at = c.first_at
from (
  select user_id, min(created_at) as first_at
  from public.fitzy_conversations
  group by user_id
) c
where c.user_id = p.id
  and p.fitzy_opened_at is null;

-- Meal reminders (lib/services/meal-reminder-service.ts) look up "a meal in
-- the last 7 days" and today's entries per user; idx_food_log_entries_user_date
-- (user_id, entry_date desc) already covers both. The journey endpoint's
-- "meals ever / first meal" read uses idx_food_log_entries_user_type.
