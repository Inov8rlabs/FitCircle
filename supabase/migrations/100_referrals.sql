-- ============================================================================
-- 100: referral program ("Better Together") — docs/REFERRALS_SPEC.md.
-- Schema only. Attribution, qualification, fraud checks and reward application
-- live in apps/web/app/lib/services/referral-*.ts (no stored procs, no triggers).
-- Rewards are materialized as complimentary_grants rows (granted_by
-- 'referral-program' / 'referral-lifetime'), so every existing entitlement path
-- (webhooks, reconcile, holdIfGranted) already honours them.
-- ============================================================================

-- One personal invite code per user.
create table if not exists public.referral_codes (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  code        text not null unique check (code ~ '^[A-Z0-9]{4,12}$' and code !~ '^FIT'),
  created_at  timestamptz not null default now()
);

-- One row per attributed invitee (a user is attributed at most once).
create table if not exists public.referrals (
  id                  uuid primary key default gen_random_uuid(),
  invitee_id          uuid not null unique references public.profiles(id) on delete cascade,
  inviter_id          uuid references public.profiles(id) on delete set null,
  code                text not null,
  circle_id           uuid references public.fitcircles(id) on delete set null,
  source              text not null check (source in
                        ('universal_link','app_link','play_referrer','paste','typed','web','circle_join')),
  status              text not null default 'pending' check (status in
                        ('pending','qualified','review','rejected','revoked')),
  status_reason       text,
  invitee_device_hash text,
  attributed_at       timestamptz not null default now(),
  qualified_at        timestamptz,
  reviewed_by         text,
  created_at          timestamptz not null default now(),
  check (inviter_id is null or inviter_id <> invitee_id)
);

create index if not exists referrals_inviter_status_idx on public.referrals (inviter_id, status);
create index if not exists referrals_pending_idx on public.referrals (attributed_at) where status = 'pending';

-- Reward ledger. 'banked' = earned, not yet turned into grant time (e.g. the
-- user is paying through a store); 'applied' = folded into a complimentary grant.
create table if not exists public.referral_rewards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  referral_id  uuid references public.referrals(id) on delete set null,
  kind         text not null check (kind in ('inviter_week','invitee_welcome','lifetime')),
  days         integer check (days is null or days > 0),
  status       text not null default 'banked' check (status in ('banked','applied','revoked')),
  applied_at   timestamptz,
  seen_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- Idempotency: a referral pays each reward kind once; a user earns lifetime once.
create unique index if not exists referral_rewards_referral_kind_uidx
  on public.referral_rewards (referral_id, kind) where referral_id is not null;
create unique index if not exists referral_rewards_lifetime_uidx
  on public.referral_rewards (user_id) where kind = 'lifetime';
create index if not exists referral_rewards_user_status_idx on public.referral_rewards (user_id, status);

-- Hashed install identifiers (IDFV / ANDROID_ID + server salt) seen per account,
-- used only for referral fraud checks ("same phone, new account").
create table if not exists public.referral_devices (
  device_hash   text not null,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (device_hash, user_id)
);
create index if not exists referral_devices_user_idx on public.referral_devices (user_id);

alter table public.referral_codes   enable row level security;
alter table public.referrals        enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.referral_devices enable row level security;
-- Service role only; no client policies.

-- Program switch (fail-closed in FeatureFlagService). Enabled for everyone.
insert into public.feature_flags (name, description, is_enabled, rollout_percentage, allowed_tiers)
select 'referrals', 'Better Together invite rewards (docs/REFERRALS_SPEC.md)', true, 100,
       array['free','premium','enterprise']
where not exists (select 1 from public.feature_flags where name = 'referrals');

comment on table public.referrals is
  'Referral attribution: invitee → inviter. pending until the invitee logs a first activity; then qualified (rewarded) or review/rejected.';
comment on table public.referral_rewards is
  'Referral reward ledger. banked → applied when folded into a referral complimentary grant.';
