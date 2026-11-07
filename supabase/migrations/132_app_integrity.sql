-- 132_app_integrity.sql
-- App integrity + abuse controls (docs/INTEGRITY_CONTRACT.md).
--
--   integrity_nonces     replay guard: every server nonce (GET /api/mobile/integrity/nonce,
--                        HMAC-signed, 2 min) is recorded here with the request it was used for;
--                        reuse for a different request is a replay (a same-request retry is not)
--   device_attestations  a session that passed the device check (24 h), so later protected
--                        calls need no new token
--   security_events      one row per security decision (integrity pass/fail/fail-open, rate-limit
--                        hit, sign-up block, login failure, referral rejection, free-AI device
--                        limit, nonce replay). No tokens, no full IPs (/24 or /48 prefix), no
--                        emails (login failures carry sha256 of the lower-cased address).
--                        Rate-limit floods: one row per (kind, ip prefix, route, minute) with a
--                        count (dedupe_key unique; the app increments it).
--   security_alert_state last alert per signal (2 h cooldown for the security alert cron)
--   nutrition_parse_log.device_id   attested device id, so the lifetime free food-AI
--                                   allowance is also counted per device
--   profiles.email_canonical        one mailbox = one identity (+tags, Gmail dots); used by
--                                   the free food-AI allowance and referral checks
--   referrals.invitee_platform / invitee_device_attested   referral qualification input
--
-- Schema only: no functions, no triggers. New tables are service-role only (RLS on, no
-- policies). Backfill of profiles.email_canonical is a plain UPDATE (no stored logic);
-- the app computes the same form in lib/validation/email-canonical.ts for new rows.
--
-- Apply ALONE (never `db push --include-all`):
--   npx -y supabase@latest db query --linked -f supabase/migrations/132_app_integrity.sql
--   then insert '132' into supabase_migrations.schema_migrations,
--   then refresh the DB contract snapshot (node scripts/db-contract/refresh-snapshot.mjs).
-- Until it is applied the app fails open: recording a used nonce and attestation writes are
-- infrastructure errors (allowed + logged); the quota/referral extras are skipped.

-- ---------------------------------------------------------------- nonces
create table if not exists public.integrity_nonces (
  nonce         text primary key,
  device_id     text not null,
  request_path  text not null,
  body_sha256   text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index if not exists integrity_nonces_expires_idx on public.integrity_nonces (expires_at);

comment on table public.integrity_nonces is
  'Used integrity nonces (replay guard for the request hash, docs/INTEGRITY_CONTRACT.md). Rows past expires_at can be deleted. Written by lib/integrity/nonce.ts only.';

alter table public.integrity_nonces enable row level security;
revoke all on public.integrity_nonces from anon, authenticated;
grant select, insert, update, delete on public.integrity_nonces to service_role;

-- ---------------------------------------------------------------- attestations
create table if not exists public.device_attestations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  session_id   text not null,
  device_id    text not null,
  platform     text not null default 'android',
  status       text not null check (status in ('verified', 'fail_open')),
  verdict      jsonb not null default '{}'::jsonb,
  app_version  text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists device_attestations_session_idx on public.device_attestations (session_id, device_id, expires_at desc);
create index if not exists device_attestations_user_device_idx on public.device_attestations (user_id, device_id);
create index if not exists device_attestations_device_idx on public.device_attestations (device_id);

comment on table public.device_attestations is
  'Sessions whose device passed the integrity check (or were allowed on a verification outage: status fail_open). Written by lib/integrity/attestations.ts only.';

alter table public.device_attestations enable row level security;
revoke all on public.device_attestations from anon, authenticated;
grant select, insert, update, delete on public.device_attestations to service_role;

-- ---------------------------------------------------------------- security events
create table if not exists public.security_events (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in (
                     'integrity', 'rate_limit', 'signup', 'signup_block', 'login_failure',
                     'referral_rejection', 'free_ai_device_limit', 'nonce_replay')),
  route            text,
  action           text,
  result           text not null check (result in ('pass', 'attested', 'block', 'log_only', 'fail_open', 'bypass', 'rejected', 'limited')),
  reason           text,
  platform         text,
  app_version      text,
  app_build        integer,
  user_id          uuid references public.profiles(id) on delete set null,
  device_id        text,
  account_hash     text,
  ip_prefix        text,
  asn              text,
  country          text,
  integrity_error  text,
  verdict          jsonb not null default '{}'::jsonb,
  count            integer not null default 1 check (count >= 1),
  dedupe_key       text unique
);

create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_kind_idx on public.security_events (kind, result, created_at desc);
create index if not exists security_events_ip_prefix_idx on public.security_events (ip_prefix, created_at desc);
create index if not exists security_events_device_idx on public.security_events (device_id, created_at desc) where device_id is not null;
create index if not exists security_events_account_idx on public.security_events (account_hash, created_at desc) where account_hash is not null;

comment on table public.security_events is
  'Security decisions for monitoring (docs/SECURITY_TELEMETRY.md). No tokens, no full IPs, no emails. Written by lib/security/security-events.ts only.';

alter table public.security_events enable row level security;
revoke all on public.security_events from anon, authenticated;
grant select, insert, update, delete on public.security_events to service_role;

-- ---------------------------------------------------------------- alert cooldown
create table if not exists public.security_alert_state (
  signal         text primary key,
  last_sent_at   timestamptz not null,
  last_severity  text not null,
  last_value     numeric,
  updated_at     timestamptz not null default now()
);

comment on table public.security_alert_state is
  'Last alert per security signal (2 h cooldown). Written by lib/security/alerts.ts only.';

alter table public.security_alert_state enable row level security;
revoke all on public.security_alert_state from anon, authenticated;
grant select, insert, update, delete on public.security_alert_state to service_role;

-- ---------------------------------------------------------------- free food-AI allowance per device
alter table public.nutrition_parse_log add column if not exists device_id text;
create index if not exists nutrition_parse_log_device_idx on public.nutrition_parse_log (device_id) where device_id is not null;

-- ---------------------------------------------------------------- canonical email
alter table public.profiles add column if not exists email_canonical text;
create index if not exists profiles_email_canonical_idx on public.profiles (email_canonical) where email_canonical is not null;

-- Backfill: lower-case, drop +tag, Gmail/Googlemail dots removed and domain folded to gmail.com.
update public.profiles
set email_canonical = case
    when split_part(lower(trim(email)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(trim(email)), '@', 1), '+', 1) || '@' || split_part(lower(trim(email)), '@', 2)
  end
where email is not null
  and position('@' in email) > 1
  and email_canonical is null;

-- ---------------------------------------------------------------- referral qualification input
alter table public.referrals add column if not exists invitee_platform text;
-- null = claim from a client that cannot attest (legacy / iOS / web): not held for this;
-- false = an integrity_v1 Android client claimed without a live attestation; true = attested.
alter table public.referrals add column if not exists invitee_device_attested boolean;
