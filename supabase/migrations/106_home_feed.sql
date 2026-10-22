-- ============================================================================
-- 106: home_feed — server-driven home feed (docs/HOME_FEED_SPEC.md §5).
--
-- Schema + one DISABLED example rule only. Ranking, rules evaluation,
-- guardrails and bucketing live in apps/web/app/lib/home-feed/*; reads and
-- writes go through apps/web/app/lib/services/home-feed-service.ts with the
-- service role. No functions, no triggers (updated_at is set by the service).
-- Idempotent.
--
-- Retention: home_feed_decisions / home_feed_events are kept 90 days. Until a
-- cleanup cron exists, purge manually:
--   delete from public.home_feed_events    where created_at < now() - interval '90 days';
--   delete from public.home_feed_decisions where created_at < now() - interval '90 days';
-- ============================================================================

create table if not exists public.home_feed_rules (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  enabled     boolean not null default false,
  priority    integer not null default 0,
  -- Everything else of the rule JSON (platforms, versions, audience, actions,
  -- experiment). Validated by the zod schema in lib/home-feed/rules.ts.
  definition  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
create index if not exists home_feed_rules_enabled_idx on public.home_feed_rules (enabled, priority);

-- One row per served layout; id = the response's decision_id.
create table if not exists public.home_feed_decisions (
  id              uuid primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  layout_key      text not null,
  experiment_key  text,
  experiment_arm  text,
  cards           jsonb not null default '[]'::jsonb,
  applied_rules   text[] not null default '{}',
  -- Coarse context snapshot (booleans/bands, no health values) for analysis
  -- and future model training.
  context         jsonb,
  platform        text,
  app_version     text,
  created_at      timestamptz not null default now()
);
create index if not exists home_feed_decisions_user_created_idx on public.home_feed_decisions (user_id, created_at desc);
create index if not exists home_feed_decisions_created_idx on public.home_feed_decisions (created_at);
create index if not exists home_feed_decisions_experiment_idx on public.home_feed_decisions (experiment_key, experiment_arm) where experiment_key is not null;

-- Card impressions / taps / dismissals / CTAs. No FK to decisions: a decision
-- insert is best-effort and must never cause event loss.
create table if not exists public.home_feed_events (
  id           bigserial primary key,
  decision_id  uuid not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  card_id      text not null,
  card_type    text not null,
  position     integer not null,
  event        text not null check (event in ('impression', 'tap', 'dismiss', 'cta')),
  -- Client-reported time (`at`), when present and plausible.
  occurred_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists home_feed_events_decision_idx on public.home_feed_events (decision_id);
create index if not exists home_feed_events_user_created_idx on public.home_feed_events (user_id, created_at desc);
create index if not exists home_feed_events_created_idx on public.home_feed_events (created_at);

alter table public.home_feed_rules     enable row level security;
alter table public.home_feed_decisions enable row level security;
alter table public.home_feed_events    enable row level security;
-- Service role only; no anon/authenticated policies (clients go through the API).

comment on table public.home_feed_rules is
  'Home feed ranking rules (docs/HOME_FEED_SPEC.md). Evaluated in lib/home-feed/rules.ts; edit via /api/admin/home-feed/rules.';
comment on table public.home_feed_decisions is
  'Every served home feed layout (decision_id). 90-day retention.';
comment on table public.home_feed_events is
  'Home feed card events from POST /api/mobile/home-feed/events. 90-day retention.';

-- ----------------------------------------------------------------------------
-- Example (DISABLED): "water_first" 50/50 — treatment moves hydration directly
-- under the header for iOS/Android 1.0.8+. The referral card moves with it
-- (guardrail G4 keeps hydration directly above referral, so moving hydration
-- alone would be pulled back to the referral card). Enable via PATCH
-- /api/admin/home-feed/rules { "key": "water_first", "enabled": true }.
-- ----------------------------------------------------------------------------
insert into public.home_feed_rules (key, enabled, priority, definition)
values (
  'water_first',
  false,
  100,
  $json${
    "description": "50/50: hydration card directly under the header vs default order.",
    "platforms": ["ios", "android"],
    "minAppVersion": "1.0.8",
    "experiment": {
      "key": "water_first",
      "arms": [
        { "name": "treatment", "percent": 50, "actions": [
            { "op": "move", "card": "hydration", "after": "header" },
            { "op": "move", "card": "referral", "after": "hydration" }
        ] },
        { "name": "control",   "percent": 50, "actions": [] }
      ]
    }
  }$json$::jsonb
)
on conflict (key) do nothing;
