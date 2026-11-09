-- 128: remote config — free-tier limits editable from Admin Tools without a deploy
-- (docs/TRIAL_FIRST_SPEC.md §6 "Remote config").
--
-- Keys, types and bounds live in code (apps/web/app/lib/remote-config/registry.ts):
-- adding a key needs a deploy, changing its value does not. Resolution per user:
--   1. the enabled rule for the key whose audience matches, highest priority (ties → oldest),
--   2. else the admin default (remote_config_defaults),
--   3. else the code default.
-- Values are validated against the registry bounds on write AND on read.
--
-- Written only by the backend with the service role (RemoteConfigService); every
-- create / update / delete also writes a remote_config_changes audit row from
-- TypeScript. No stored procedures, functions or triggers.
--
-- Tables + indexes + RLS only. Apply ALONE (do not `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/129_remote_config.sql
-- then record it in supabase_migrations.schema_migrations like the other
-- single-applied migrations. Until it is applied the backend serves the code
-- defaults (reads fail soft).

create table if not exists public.remote_config_defaults (
  config_key  text primary key,
  value       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.remote_config_rules (
  id          uuid primary key default gen_random_uuid(),
  config_key  text not null,
  name        text not null,
  enabled     boolean not null default false,
  priority    integer not null default 0,
  -- All specified conditions AND (zod-validated in RemoteConfigService; see registry/audience.ts).
  audience    jsonb not null default '{}'::jsonb,
  value       jsonb not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create index if not exists remote_config_rules_key_idx on public.remote_config_rules (config_key, enabled, priority desc, created_at);

create table if not exists public.remote_config_changes (
  id          uuid primary key default gen_random_uuid(),
  config_key  text not null,
  -- 'default' (remote_config_defaults) or 'rule' (remote_config_rules)
  target      text not null check (target in ('default', 'rule')),
  rule_id     uuid,
  action      text not null check (action in ('create', 'update', 'delete')),
  actor       text,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

create index if not exists remote_config_changes_key_idx on public.remote_config_changes (config_key, at desc);
create index if not exists remote_config_changes_at_idx on public.remote_config_changes (at desc);

-- Service role only: RLS on with no policies, and no grants to the API roles.
alter table public.remote_config_defaults enable row level security;
alter table public.remote_config_rules enable row level security;
alter table public.remote_config_changes enable row level security;
revoke all on public.remote_config_defaults from anon, authenticated;
revoke all on public.remote_config_rules from anon, authenticated;
revoke all on public.remote_config_changes from anon, authenticated;

comment on table public.remote_config_defaults is
  'Remote config: admin override of a registry key''s code default. Written by RemoteConfigService only.';
comment on table public.remote_config_rules is
  'Remote config: segment rules (audience → value) per registry key; highest-priority enabled match wins. Written by RemoteConfigService only.';
comment on table public.remote_config_changes is
  'Remote config audit log: one row per create/update/delete of a default or rule (actor, before, after).';
