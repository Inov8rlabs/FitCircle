-- ============================================================================
-- 105: Fitzy v2 — server-held conversations, memory, daily focus cache and
-- weekly plans (docs/FITZY_V2_SPEC.md §2). Schema only: routing, streaming,
-- guardrails, memory extraction and plan logic live in
-- apps/web/app/lib/fitzy/* and apps/web/app/lib/services/fitzy-*.ts.
-- No functions, no triggers. Idempotent.
-- ============================================================================

create table if not exists public.fitzy_conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index if not exists fitzy_conversations_user_updated_idx
  on public.fitzy_conversations (user_id, updated_at desc) where archived_at is null;

create table if not exists public.fitzy_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.fitzy_conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             text not null check (role in ('user','assistant')),
  content          text not null,
  suggestions      jsonb not null default '[]'::jsonb,
  actions          jsonb not null default '[]'::jsonb,
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  guard_tripped    boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists fitzy_messages_conversation_created_idx
  on public.fitzy_messages (conversation_id, created_at);
-- Cost dashboards: assistant tokens per model over time.
create index if not exists fitzy_messages_model_created_idx
  on public.fitzy_messages (model, created_at) where role = 'assistant';

-- Pro memory (≤ 25 items) + the 7-day growth-nudge stamp (all tiers).
create table if not exists public.fitzy_memory (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  items                 jsonb not null default '[]'::jsonb,
  last_growth_nudge_at  timestamptz,
  updated_at            timestamptz not null default now()
);

-- Daily focus, one per user per local day.
create table if not exists public.fitzy_daily (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, date)
);

-- Weekly plans (week_of = Monday). Free users' cached teaser is a row with is_preview = true.
create table if not exists public.fitzy_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  week_of      date not null,
  goal         text not null default '',
  commitments  jsonb not null default '[]'::jsonb,
  note         text not null default '',
  model        text,
  is_preview   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, week_of)
);

alter table public.fitzy_conversations enable row level security;
alter table public.fitzy_messages      enable row level security;
alter table public.fitzy_memory        enable row level security;
alter table public.fitzy_daily         enable row level security;
alter table public.fitzy_plans         enable row level security;
-- Service role only; no anon/authenticated policies.
