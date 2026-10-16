-- ============================================================================
-- 101: referral v2 — invite by email / text, nudges, guaranteed reward
-- delivery (docs/REFERRALS_SPEC.md §9). Schema only; logic lives in
-- apps/web/app/lib/services/referral-invite-service.ts / referral-service.ts.
-- ============================================================================

-- Email-matched signups are a new attribution source.
alter table public.referrals drop constraint if exists referrals_source_check;
alter table public.referrals add constraint referrals_source_check check (source in
  ('universal_link','app_link','play_referrer','paste','typed','web','circle_join','email_invite'));

-- Nudges to joined-but-not-yet-active friends + push delivery bookkeeping.
alter table public.referrals
  add column if not exists nudge_count         integer not null default 0,
  add column if not exists last_nudged_at      timestamptz,
  add column if not exists inviter_notified_at timestamptz;

-- Reward push/email delivery bookkeeping (the hourly cron retries until sent or 48h old).
alter table public.referral_rewards
  add column if not exists notified_at timestamptz,
  add column if not exists emailed_at  timestamptz;

-- Friends invited by email (server-sent) or text (sent from the member's own
-- phone via the native composer; recorded only). Phones are never stored in
-- plaintext: contact_hash + a masked display. Emails are kept for reminders
-- and cleared once the friend joins or after 45 days.
create table if not exists public.referral_invites (
  id              uuid primary key default gen_random_uuid(),
  inviter_id      uuid not null references public.profiles(id) on delete cascade,
  channel         text not null check (channel in ('email','sms')),
  contact_hash    text not null,
  email           text,
  contact_display text not null,
  name            text check (name is null or char_length(name) <= 60),
  circle_id       uuid references public.fitcircles(id) on delete set null,
  status          text not null default 'invited' check (status in ('invited','joined','qualified','failed')),
  referral_id     uuid references public.referrals(id) on delete set null,
  nudge_count     integer not null default 0,
  last_nudged_at  timestamptz,
  sent_at         timestamptz not null default now(),
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (inviter_id, contact_hash),
  check (channel <> 'sms' or email is null)
);
create index if not exists referral_invites_contact_idx on public.referral_invites (contact_hash);
create index if not exists referral_invites_inviter_sent_idx on public.referral_invites (inviter_id, sent_at desc);

-- One-click unsubscribe from invite emails (CAN-SPAM). Keyed by email hash.
create table if not exists public.referral_email_optouts (
  email_hash  text primary key,
  created_at  timestamptz not null default now()
);

alter table public.referral_invites      enable row level security;
alter table public.referral_email_optouts enable row level security;
-- Service role only; no client policies.

comment on table public.referral_invites is
  'Friends a member invited by email (server-sent via Resend) or text (native composer). status invited → joined → qualified.';
