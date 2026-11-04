-- ============================================================================
-- 119: engagement_sends — the send ledger for lifecycle messaging
--      (docs/ENGAGEMENT_MESSAGING.md §5).
--
-- APPLY ALONE (`npx -y supabase@latest db query --linked -f supabase/migrations/119_engagement_sends.sql`
-- then insert '119' into supabase_migrations.schema_migrations). Never `db push --include-all`:
-- 104 is still unapplied on purpose and 118 is reserved for Engage.
--
-- One row per (user, message, period, channel): the welcome email, the
-- onboarding / re-engagement steps and the weekly report. The unique key is
-- the idempotency guard — a sender claims its row (status 'pending') before
-- calling Resend / NotificationOrchestrator, so a cron that runs twice, or two
-- overlapping runs, can never send the same message twice. Resend webhooks
-- (delivered / opened / clicked / bounced / complained) and the unsubscribe
-- endpoint stamp the timestamps; the lifecycle cron stamps converted_at when
-- the message's goal happened inside its attribution window. Holdout (control)
-- users get a row with status 'holdout' and no send, so lift is measurable.
--
--   * ADDITIVE: one new table + indexes. Nothing dropped, renamed or backfilled.
--   * Idempotent (`if not exists`).
--   * No functions, procedures or triggers (CLAUDE.md); all logic lives in
--     apps/web/app/lib/engagement/*.
--   * RLS on, no anon/authenticated policies: only the service role (API routes,
--     crons, webhook) reads or writes it.
--
-- Email consent needs NO migration: engagement email consent reuses the
-- existing profiles.preferences jsonb (marketingEmails, the master switch the
-- campaign emails already honour, plus engagementEmails.{weekly_report,tips}
-- for the per-stream unsubscribe). The code works before this migration is
-- applied: every ledger call fails soft and the crons refuse to send without a
-- ledger (they report `ledger_unavailable`).
-- ============================================================================

create table if not exists public.engagement_sends (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  -- Stable message key, e.g. 'welcome', 'weekly_report', 'onboarding_first_meal'.
  message_key      text not null check (message_key ~ '^[a-z0-9_]{3,64}$'),
  -- Occurrence of the message: 'once', an ISO week ('2026-W44'), a date, a streak run …
  period_key       text not null check (char_length(period_key) between 1 and 64),
  channel          text not null check (channel in ('email', 'push')),
  -- pending  = claimed, provider call in flight
  -- sent     = accepted by Resend / delivered to ≥1 device by the orchestrator
  -- failed   = provider rejected (claim kept so the period isn't retried forever; see meta.error)
  -- suppressed = the orchestrator declined (quiet hours, cap, category off …; meta.reason)
  -- skipped  = terminal skip decided before sending (consent, no email …; meta.reason)
  -- holdout  = deterministic control group: intentionally not sent (lift measurement)
  status           text not null default 'pending'
                     check (status in ('pending', 'sent', 'failed', 'suppressed', 'skipped', 'holdout')),
  -- Variant ids (subject / hero / growth slot …) — what the stats group by.
  variant          text,
  template_version text,
  -- Resend email id (email) — how webhooks find the row.
  provider_id      text,
  -- Goal used for attribution (meal_logged, circle_joined, invite_sent, active, …).
  goal_key         text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  delivered_at     timestamptz,
  opened_at        timestamptz,
  clicked_at       timestamptz,
  bounced_at       timestamptz,
  complained_at    timestamptz,
  unsubscribed_at  timestamptz,
  converted_at     timestamptz,
  -- Non-sensitive context: growth_slot, week_type, reason, error, click link id …
  -- Never health values, email addresses or free text.
  meta             jsonb not null default '{}'::jsonb,
  unique (user_id, message_key, period_key, channel)
);

create index if not exists engagement_sends_provider_idx
  on public.engagement_sends (provider_id) where provider_id is not null;
create index if not exists engagement_sends_user_recent_idx
  on public.engagement_sends (user_id, created_at desc);
create index if not exists engagement_sends_message_recent_idx
  on public.engagement_sends (message_key, created_at desc);
-- The attribution pass scans recent rows that have a goal and no conversion yet.
create index if not exists engagement_sends_attribution_idx
  on public.engagement_sends (created_at) where converted_at is null and goal_key is not null;

alter table public.engagement_sends enable row level security;

comment on table public.engagement_sends is
  'Lifecycle messaging send ledger (docs/ENGAGEMENT_MESSAGING.md). Service role only. Unique (user, message, period, channel) is the idempotency key.';
