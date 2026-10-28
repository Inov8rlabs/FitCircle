-- ============================================================================
-- 112: free trials + internal experimentation + onboarding v2
-- (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §3.2, §5.5, §6.2, R2).
--
-- Tables, columns, indexes, constraints and one seed only. No functions, no
-- triggers: assignment, eligibility, gates, trial bookkeeping and the results
-- maths live in apps/web/app/lib/experiments/* and the services, and write
-- with the service role. The experiment tables have RLS enabled with NO
-- policies, so clients can never read allowlists, salts or assignments
-- (fixes the feature_flags mistake). updated_at is set by the application.
--
-- Apply ALONE (db query + schema_migrations insert), like 106-111:
-- 104 is still unapplied, so never `db push --include-all`.
-- Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Experiments
-- ---------------------------------------------------------------------------
create table if not exists public.experiments (
  key            text primary key check (key ~ '^[a-z0-9][a-z0-9_]{0,63}$'),
  name           text not null,
  description    text,
  status         text not null default 'draft'
                 check (status in ('draft', 'running', 'paused', 'concluded')),
  -- Random at creation, never reused, never editable (changing it reshuffles users).
  salt           text not null,
  -- [{key, weight, payload}] — weights are integer percents summing to 100
  -- (validated by lib/experiments/model.ts).
  arms           jsonb not null,
  -- % of eligible users enrolled at all (the rest get fallback_arm, sticky).
  traffic_pct    int  not null default 100 check (traffic_pct between 0 and 100),
  -- {platforms?, minAppVersion?, maxAppVersion?, newUsersOnly?, countries?, excludeUserIds?}
  audience       jsonb not null default '{}'::jsonb,
  fallback_arm   text not null,
  winner_arm     text,
  started_at     timestamptz,
  ended_at       timestamptz,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One row per (experiment, user): the sticky decision.
-- user_id deliberately has NO foreign key to profiles: an account deletion must
-- not erase the row, or the "account deletions D7" guardrail (§6.6) could never
-- be measured. AccountDeletionService stamps user_deleted_at before it deletes
-- the profile; the row then holds only an opaque id, an arm and coarse context.
create table if not exists public.experiment_assignments (
  experiment_key    text not null references public.experiments(key) on delete cascade,
  user_id           uuid not null,
  arm               text not null,
  assigned_at       timestamptz not null default now(),
  first_exposed_at  timestamptz,
  exposure_surface  text,
  platform          text,
  app_version       text,
  country           text,
  -- bucket   = randomised (the only rows the analysis uses)
  -- override = QA / reviewer / team (experiment_overrides)
  -- fallback = experiment not running, or outside traffic_pct (sticky, not analysed)
  -- winner   = experiment concluded before this user arrived
  reason            text not null check (reason in ('bucket', 'override', 'fallback', 'winner')),
  user_deleted_at   timestamptz,
  primary key (experiment_key, user_id)
);
create index if not exists experiment_assignments_user_idx on public.experiment_assignments (user_id);
create index if not exists experiment_assignments_key_arm_idx on public.experiment_assignments (experiment_key, arm, reason);

-- QA / reviewer / employees: force an arm. user_id has no FK for the same
-- reason as above (overrides are cleaned up by the admin, not by cascade).
create table if not exists public.experiment_overrides (
  experiment_key text not null references public.experiments(key) on delete cascade,
  user_id        uuid not null,
  arm            text not null,
  note           text,
  created_by     text,
  created_at     timestamptz not null default now(),
  primary key (experiment_key, user_id)
);

-- Append-only audit of every admin change (actor = X-Admin-Actor email).
create table if not exists public.experiment_audit_log (
  id             uuid primary key default gen_random_uuid(),
  experiment_key text not null,
  actor          text,
  -- create | update | status | override_set | override_removed | release_gate
  action         text not null,
  before         jsonb,
  after          jsonb,
  at             timestamptz not null default now()
);
create index if not exists experiment_audit_log_key_at_idx on public.experiment_audit_log (experiment_key, at desc);

alter table public.experiments            enable row level security;
alter table public.experiment_assignments enable row level security;
alter table public.experiment_overrides   enable row level security;
alter table public.experiment_audit_log   enable row level security;
-- Intentionally no policies: service role only.

-- ---------------------------------------------------------------------------
-- Profiles: trial bookkeeping (§3.2), onboarding flow + hard gate (§5.5)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists trial_started_at        timestamptz;
alter table public.profiles add column if not exists trial_ends_at           timestamptz;
alter table public.profiles add column if not exists trial_converted_at      timestamptz;
alter table public.profiles add column if not exists trial_reminder_sent_at  timestamptz;
alter table public.profiles add column if not exists onboarding_flow         text;
alter table public.profiles add column if not exists onboarding_gate         text not null default 'none';
-- First time the user reached the onboarding paywall (any arm; POST /onboarding/gate).
alter table public.profiles add column if not exists onboarding_paywall_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_onboarding_gate_check') then
    alter table public.profiles
      add constraint profiles_onboarding_gate_check check (onboarding_gate in ('none', 'subscription_required'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_onboarding_flow_check') then
    alter table public.profiles
      add constraint profiles_onboarding_flow_check check (onboarding_flow is null or onboarding_flow in ('v1', 'v2'));
  end if;
end $$;

-- Trial reminder cron: trialing users whose trial ends soon and who were not reminded.
create index if not exists profiles_trial_reminder_due_idx
  on public.profiles (trial_ends_at)
  where trial_reminder_sent_at is null and trial_ends_at is not null;
-- Release-gate + locked-screen lookups.
create index if not exists profiles_onboarding_gate_idx
  on public.profiles (onboarding_gate)
  where onboarding_gate <> 'none';

-- ---------------------------------------------------------------------------
-- onboarding_progress (exists since baseline, unique user_id): resume state (R2)
-- ---------------------------------------------------------------------------
alter table public.onboarding_progress add column if not exists flow text;
alter table public.onboarding_progress add column if not exists step text;
alter table public.onboarding_progress add column if not exists data jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'onboarding_progress_flow_check') then
    alter table public.onboarding_progress
      add constraint onboarding_progress_flow_check check (flow is null or flow in ('v1', 'v2'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: onboarding_v2 (draft — started from Admin Tools, never by migration)
-- ---------------------------------------------------------------------------
insert into public.experiments (key, name, description, status, salt, arms, traffic_pct, audience, fallback_arm, created_by)
values (
  'onboarding_v2',
  'Onboarding v2: tour + paywall',
  'v1 onboarding vs the v2 tour with a hard (no close) or soft ("I''ll do it later") paywall. docs/ONBOARDING_V2_EXPERIMENT_SPEC.md',
  'draft',
  -- 128 random bits (gen_random_uuid is core Postgres; no pgcrypto schema needed).
  replace(gen_random_uuid()::text, '-', ''),
  '[
     {"key": "control",   "weight": 20, "payload": {"flow": "v1", "paywall": "none"}},
     {"key": "tour_hard", "weight": 40, "payload": {"flow": "v2", "paywall": "hard"}},
     {"key": "tour_soft", "weight": 40, "payload": {"flow": "v2", "paywall": "soft"}}
   ]'::jsonb,
  20,
  '{
     "platforms": ["ios", "android"],
     "minAppVersion": "1.2.0",
     "newUsersOnly": true,
     "excludeUserIds": ["47476150-a984-4431-a89a-7cc8085adfe6"]
   }'::jsonb,
  'control',
  'migration:112'
)
on conflict (key) do nothing;

-- App Review demo account (fitcircle.user@gmail.com, scripts/demo-account) is
-- always control (§8). Looked up by email so the seed is right in every env.
insert into public.experiment_overrides (experiment_key, user_id, arm, note, created_by)
select 'onboarding_v2', p.id, 'control', 'App Review demo account', 'migration:112'
from public.profiles p
where lower(p.email) = 'fitcircle.user@gmail.com'
on conflict (experiment_key, user_id) do nothing;
