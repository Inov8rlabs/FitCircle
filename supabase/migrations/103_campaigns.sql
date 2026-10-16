-- ============================================================================
-- 103: campaigns — admin-built marketing campaigns rendered natively in the
-- apps (docs/CAMPAIGNS_SPEC.md). Replaces the code-configured seasons of
-- REFERRALS_SPEC §10.4 (GET /api/mobile/seasonal is now built from campaigns
-- with a legacy_season_key; lib/seasonal/seasons.ts stays as the fallback).
--
-- Schema + seed only. Visibility, phases, door states, delivery targeting and
-- App Store sync live in apps/web/app/lib/services/campaign-*.ts and
-- apps/web/app/lib/campaigns/*. No functions, no triggers (updated_at and
-- version are maintained by the service). Idempotent.
-- ============================================================================

-- Admin flag (gates /api/admin/campaigns and the /admin portal).
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Owner account.
update public.profiles
   set is_admin = true
 where id in (select id from auth.users where lower(email) = 'aniruddh@bajirao.me')
   and is_admin = false;

create table if not exists public.campaigns (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9_]{3,40}$'),
  template           text not null check (template in ('seasonal_circle','daily_calendar','spotlight')),
  published          boolean not null default false,
  published_at       timestamptz,
  archived_at        timestamptz,
  -- copy
  title              text not null check (char_length(title) between 1 and 40),
  emoji              text not null default '' check (char_length(emoji) <= 8),
  tagline            text not null default '' check (char_length(tagline) <= 80),
  description        text not null default '' check (char_length(description) <= 280),
  cta_label          text check (cta_label is null or char_length(cta_label) <= 24),
  -- look
  accent             text not null default '#8b5cf6' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  palette            jsonb not null default '["#6366f1","#8b5cf6","#ec4899"]'::jsonb,
  glyph              text not null default 'star' check (glyph in
                       ('snowflake','gift','year','sun','moon','flame','leaf','heart','star','bolt')),
  -- dates (calendar days, viewer-local)
  featured_from      date not null,
  starts_at          date not null,
  ends_at            date not null,
  priority           integer not null default 0,
  -- template content
  cta                jsonb not null default '{"action":"start_circle"}'::jsonb,
  circle_template    jsonb,
  calendar           jsonb,
  marks              jsonb not null default '[]'::jsonb,
  art                jsonb not null default '{}'::jsonb,
  -- delivery plan
  notifications      jsonb not null default '[]'::jsonb,
  emails             jsonb not null default '[]'::jsonb,
  app_store          jsonb not null default '{}'::jsonb,
  play               jsonb not null default '{}'::jsonb,
  legacy_season_key  text check (legacy_season_key is null or legacy_season_key in ('hold_the_line','new_year_reset','ramadan')),
  preview_user_ids   uuid[] not null default '{}',
  -- bookkeeping
  created_by         uuid references public.profiles(id) on delete set null,
  updated_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  check (featured_from <= starts_at and starts_at <= ends_at)
);

create index if not exists campaigns_window_idx on public.campaigns (ends_at) where archived_at is null;

create table if not exists public.campaign_participants (
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  reminders    boolean not null default false,
  primary key (campaign_id, user_id)
);
create index if not exists campaign_participants_user_idx on public.campaign_participants (user_id);

-- Push/email dedupe ledger: one row per (campaign, user, delivery_key).
create table if not exists public.campaign_deliveries (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  delivery_key  text not null,
  channel       text not null check (channel in ('push','email')),
  sent_at       timestamptz not null default now(),
  unique (campaign_id, user_id, delivery_key)
);
create index if not exists campaign_deliveries_key_idx on public.campaign_deliveries (campaign_id, delivery_key);

alter table public.campaigns             enable row level security;
alter table public.campaign_participants enable row level security;
alter table public.campaign_deliveries   enable row level security;
-- Service role only; no anon/authenticated policies.

-- Campaign artwork (public read; writes only via the service role).
insert into storage.buckets (id, name, public)
values ('campaign-art', 'campaign-art', true)
on conflict (id) do nothing;

comment on table public.campaigns is
  'Admin-authored marketing campaigns (docs/CAMPAIGNS_SPEC.md). Phase/status computed in campaign-service.ts.';
comment on table public.campaign_participants is
  'Users who joined a campaign ("I''m in" / "Remind me each morning").';
comment on table public.campaign_deliveries is
  'Dedupe ledger for campaign push (push:{key}:{localDate}) and email (email:{key}) deliveries.';

-- ----------------------------------------------------------------------------
-- Seed: the four launch campaigns (published). on conflict (slug) do nothing.
-- ----------------------------------------------------------------------------

insert into public.campaigns (
  slug, template, published, published_at, title, emoji, tagline, description, cta_label,
  accent, palette, glyph, featured_from, starts_at, ends_at, priority, cta, circle_template,
  calendar, marks, notifications, emails, app_store, play, legacy_season_key
) values
(
  'hold_the_line', 'seasonal_circle', true, now(),
  'Hold the Line', '❄️',
  $t$Maintain, don't gain — together.$t$,
  'From Nov 15 to Dec 15, your circle checks in daily and heads into the holidays strong. No diets, no guilt: just showing up.',
  null,
  '#38bdf8', '["#0ea5e9","#6366f1","#a5f3fc"]'::jsonb, 'snowflake',
  '2026-10-20', '2026-11-15', '2026-12-15', 0,
  '{"action":"start_circle"}'::jsonb,
  $j${"name":"Hold the Line Crew","description":"Pre-holiday push. We check in every day and keep each other on track through Dec 15. Maintain, don't gain.","type":"custom","startDate":"2026-11-15","endDate":"2026-12-15"}$j$::jsonb,
  null,
  $j$[{"date":"2026-11-26","emoji":"🦃","label":"Thanksgiving"},{"date":"2026-12-15","emoji":"🏁","label":"Finish"}]$j$::jsonb,
  $j$[{"key":"launch","kind":"launch","sendOn":null,"localHour":8,"title":"Hold the Line starts today ❄️","body":"Check in with your crew and head into the holidays strong.","audience":"all","enabled":true}]$j$::jsonb,
  '[]'::jsonb,
  $j${"name":"Hold the Line","shortDescription":"Maintain, don't gain, with your crew.","longDescription":"Start a circle with friends, check in every day and head into the holidays strong.","badge":"CHALLENGE","purpose":"APPROPRIATE_FOR_ALL_USERS","priority":"NORMAL","eventId":null,"state":null,"lastSyncedAt":null,"lastError":null}$j$::jsonb,
  $j${"title":"Hold the Line","description":"Start a circle with friends, check in every day and head into the holidays strong. Maintain, don't gain, together."}$j$::jsonb,
  'hold_the_line'
),
(
  'advent_2026', 'daily_calendar', true, now(),
  'Advent Circle', '🎁',
  'A small healthy win behind every door.',
  'Open one door a day from Dec 1 to 24: a quick, kind challenge you and your circle do together. Check in each day to open it.',
  null,
  '#f59e0b', '["#ef4444","#f59e0b","#22c55e"]'::jsonb, 'gift',
  '2026-11-17', '2026-12-01', '2026-12-24', 20,
  '{"action":"open_calendar"}'::jsonb,
  $j${"name":"Advent Circle","description":"24 days, 24 small wins. We check in every day from Dec 1 to Dec 24 and open the doors together.","type":"custom","startDate":"2026-12-01","endDate":"2026-12-24"}$j$::jsonb,
  $j${"doors":[
    {"day":1,"emoji":"🚶","title":"First steps","task":"A 10-minute walk, any pace."},
    {"day":2,"emoji":"💧","title":"Water first","task":"A glass of water before your first coffee or tea."},
    {"day":3,"emoji":"🧘","title":"Unclench","task":"5 minutes of stretching: neck, shoulders, hips."},
    {"day":4,"emoji":"🥦","title":"Add a colour","task":"Add one vegetable or fruit to a meal."},
    {"day":5,"emoji":"📵","title":"Screen-free bite","task":"Eat one meal without your phone."},
    {"day":6,"emoji":"🎅","title":"St Nicholas steps","task":"6,000 steps today."},
    {"day":7,"emoji":"😴","title":"Wind down","task":"Lights out 20 minutes earlier tonight."},
    {"day":8,"emoji":"🙌","title":"Cheer someone","task":"React to a friend's post in your circle."},
    {"day":9,"emoji":"🪜","title":"Take the stairs","task":"Pick stairs over the lift or escalator today."},
    {"day":10,"emoji":"🍲","title":"Cook it","task":"Make one meal at home."},
    {"day":11,"emoji":"🌬️","title":"Breathe","task":"2 minutes of slow breathing (4 in, 6 out)."},
    {"day":12,"emoji":"🏃","title":"Move 20","task":"20 minutes of any movement you enjoy."},
    {"day":13,"emoji":"🍎","title":"Smart snack","task":"Swap one snack for fruit or nuts."},
    {"day":14,"emoji":"🧊","title":"Hydrate","task":"8 glasses of water today."},
    {"day":15,"emoji":"🏁","title":"Halfway hero","task":"Log every meal today."},
    {"day":16,"emoji":"☀️","title":"Daylight","task":"10 minutes outside in daylight."},
    {"day":17,"emoji":"💪","title":"Mini workout","task":"10 squats, 10 push-ups (any version), 20-second plank."},
    {"day":18,"emoji":"🫶","title":"Bring a friend","task":"Invite one friend to join your circle."},
    {"day":19,"emoji":"🍵","title":"Slow sip","task":"Swap one sugary drink for water or tea."},
    {"day":20,"emoji":"🎶","title":"Dance break","task":"One song, full volume, dance it out."},
    {"day":21,"emoji":"🌙","title":"Longest night","task":"A cosy evening walk under the lights."},
    {"day":22,"emoji":"🥗","title":"Plate check","task":"Half your plate vegetables at one meal."},
    {"day":23,"emoji":"🎁","title":"Gift of steps","task":"Walk with someone you love."},
    {"day":24,"emoji":"🎄","title":"You made it","task":"Check in and share one win from this month."}
  ]}$j$::jsonb,
  $j$[{"date":"2026-12-06","emoji":"🎅","label":"St Nicholas"},{"date":"2026-12-24","emoji":"🎄","label":"Christmas Eve"}]$j$::jsonb,
  $j$[
    {"key":"launch","kind":"launch","sendOn":null,"localHour":8,"title":"The Advent Circle is open 🎁","body":"Door 1 is waiting. Check in today to open it.","audience":"all","enabled":true},
    {"key":"daily","kind":"daily","sendOn":null,"localHour":8,"title":"Door {{day}} is open {{door_emoji}}","body":"{{door_title}}: check in today to open it.","audience":"reminders","enabled":true}
  ]$j$::jsonb,
  '[]'::jsonb,
  $j${"name":"Advent Circle","shortDescription":"A small healthy win behind every door.","longDescription":"Open one door a day from Dec 1 to 24: a quick healthy challenge you and your circle do together.","badge":"SPECIAL_EVENT","purpose":"APPROPRIATE_FOR_ALL_USERS","priority":"HIGH","eventId":null,"state":null,"lastSyncedAt":null,"lastError":null}$j$::jsonb,
  $j${"title":"Advent Circle","description":"Open one door a day from Dec 1 to 24: a quick healthy challenge you and your circle do together."}$j$::jsonb,
  null
),
(
  'new_year_reset', 'seasonal_circle', true, now(),
  'Fresh Start 2027', '🌅',
  'New year, healthier you. Start it together.',
  'Start 2027 with your people: check in every day for 31 days and build healthy habits that last all year.',
  null,
  '#a78bfa', '["#a78bfa","#f472b6","#fbbf24"]'::jsonb, 'year',
  '2026-12-16', '2027-01-01', '2027-01-31', 0,
  '{"action":"start_circle"}'::jsonb,
  $j${"name":"Fresh Start 2027","description":"A fresh year, a fresh start. We check in every day through January and build healthy habits together.","type":"custom","startDate":"2027-01-01","endDate":"2027-01-31"}$j$::jsonb,
  null,
  $j$[{"date":"2027-01-01","emoji":"🎉","label":"New Year's Day"}]$j$::jsonb,
  $j$[{"key":"launch","kind":"launch","sendOn":null,"localHour":9,"title":"Fresh Start 2027 begins 🌅","body":"New year, healthier you. Start it with your circle today.","audience":"all","enabled":true}]$j$::jsonb,
  '[]'::jsonb,
  $j${"name":"Fresh Start 2027","shortDescription":"New year, healthier you. Start it together.","longDescription":"Kick off 2027 with friends: check in every day for 31 days and build healthy habits that last all year.","badge":"CHALLENGE","purpose":"APPROPRIATE_FOR_ALL_USERS","priority":"NORMAL","eventId":null,"state":null,"lastSyncedAt":null,"lastError":null}$j$::jsonb,
  $j${"title":"Fresh Start 2027","description":"Kick off 2027 with friends: check in every day for 31 days and build healthy habits that last all year."}$j$::jsonb,
  'new_year_reset'
),
(
  'ramadan_2027', 'seasonal_circle', true, now(),
  'Ramadan Circle', '🌙',
  'Suhoor, iftar and a gentle walk, together.',
  'Around Feb 8 to Mar 9, 2027 (dates follow the moon sighting). Log suhoor and iftar, stay hydrated, and take an evening walk with your circle.',
  null,
  '#34d399', '["#34d399","#0ea5e9","#312e81"]'::jsonb, 'moon',
  '2027-01-25', '2027-02-08', '2027-03-09', 0,
  '{"action":"start_circle"}'::jsonb,
  $j${"name":"Ramadan Circle","description":"Suhoor, iftar, water and an evening walk. We keep each other gentle and consistent through Ramadan.","type":"custom","startDate":"2027-02-08","endDate":"2027-03-09"}$j$::jsonb,
  null,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  $j${"name":"Ramadan Circle","shortDescription":"Suhoor, iftar and a gentle walk, together.","longDescription":"Log suhoor and iftar, stay hydrated and take an evening walk with your circle all through Ramadan.","badge":"CHALLENGE","purpose":"APPROPRIATE_FOR_ALL_USERS","priority":"NORMAL","eventId":null,"state":null,"lastSyncedAt":null,"lastError":null}$j$::jsonb,
  '{}'::jsonb,
  'ramadan'
)
on conflict (slug) do nothing;
