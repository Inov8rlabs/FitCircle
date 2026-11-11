-- 134_ai_costs.sql
-- FitCircle Finance: AI model costs (Vercel AI Gateway) + P&L inputs (2026-11-10).
--
--   ai_usage_events     per-call ledger written by app code after every model call
--                       (lib/ai/usage.ts, off the request path). Attribution: user, feature,
--                       environment, model. cost_usd = what the gateway billed for the call
--                       (providerMetadata.gateway.gatewayCost = inference + gateway fees such
--                       as reporting-tag writes); market_cost_usd = inference at list price.
--   ai_cost_daily       the gateway's billed numbers (Custom Reporting API /v1/report), synced
--                       daily by GET /api/cron/ai-costs/sync (AiCostSyncService). Gateway
--                       days are UTC. dimension = total (key ''), user (gateway `user`, '' =
--                       untagged), tag ('' = untagged), model. ACCOUNT-WIDE (whole Vercel team).
--   ai_gateway_credits  /v1/credits snapshots (prepaid balance, lifetime used) per sync.
--
-- Schema only: no functions, no triggers. Service-role only (RLS on, no policies).
-- Volume: ledger ≈ model calls (hundreds/day today); daily ≈ (1 + users + tags + models)/day.
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/134_ai_costs.sql
--   then insert '134' into supabase_migrations.schema_migrations,
--   then refresh the DB contract snapshot (node scripts/db-contract/refresh-snapshot.mjs).
-- Until it is applied the app fails soft: ledger inserts are skipped (logged once per
-- instance per 10 min), the sync cron returns an error, and the finance reports read
-- the tables as empty (with a note).

create table if not exists public.ai_usage_events (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  user_id             uuid null,
  feature             text not null,
  model               text not null,
  provider            text,
  environment         text not null,
  input_tokens        integer,
  output_tokens       integer,
  cached_input_tokens integer,
  reasoning_tokens    integer,
  cost_usd            numeric(14, 8),
  market_cost_usd     numeric(14, 8),
  generation_id       text,
  ok                  boolean not null default true,
  duration_ms         integer
);

create index if not exists ai_usage_events_created_at_idx on public.ai_usage_events (created_at);
create index if not exists ai_usage_events_user_created_idx on public.ai_usage_events (user_id, created_at);
create index if not exists ai_usage_events_feature_created_idx on public.ai_usage_events (feature, created_at);

create table if not exists public.ai_cost_daily (
  day                 date not null,
  dimension           text not null check (dimension in ('total', 'user', 'tag', 'model')),
  key                 text not null default '',
  total_cost          numeric(14, 8) not null default 0,
  market_cost         numeric(14, 8),
  input_tokens        bigint,
  output_tokens       bigint,
  cached_input_tokens bigint,
  reasoning_tokens    bigint,
  request_count       integer,
  synced_at           timestamptz not null default now(),
  primary key (day, dimension, key)
);

create table if not exists public.ai_gateway_credits (
  captured_at  timestamptz primary key default now(),
  balance      numeric(14, 6) not null,
  total_used   numeric(14, 6) not null
);

alter table public.ai_usage_events enable row level security;
alter table public.ai_cost_daily enable row level security;
alter table public.ai_gateway_credits enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;
revoke all on public.ai_cost_daily from anon, authenticated;
revoke all on public.ai_gateway_credits from anon, authenticated;
grant select, insert, update, delete on public.ai_usage_events to service_role;
grant select, insert, update, delete on public.ai_cost_daily to service_role;
grant select, insert, update, delete on public.ai_gateway_credits to service_role;
