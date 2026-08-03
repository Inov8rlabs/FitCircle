-- ============================================================================
-- 075: Subscription infrastructure (MONETIZATION-PLAN.md)
-- ============================================================================
-- RevenueCat is the subscription source of truth; our DB is the entitlement
-- cache. Exactly one writer of subscription state: the RevenueCat webhook
-- handler (service role). This migration adds the columns/tables that handler
-- needs, plus the Pro feature gates seeded DARK (required_tier='free') so
-- behavior is unchanged until 077 flips them at launch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles: platform + lifecycle detail for the subscription cache
-- ----------------------------------------------------------------------------
-- subscription_tier / subscription_status / subscription_expires_at /
-- stripe_customer_id already exist from 001.
alter table profiles
  add column if not exists subscription_platform text
    check (subscription_platform in ('app_store', 'play_store', 'stripe', 'promotional')),
  add column if not exists subscription_product_id text,
  add column if not exists subscription_will_renew boolean not null default false,
  -- RevenueCat event_timestamp of the last event applied; guards against
  -- out-of-order webhook delivery (stale events are skipped).
  add column if not exists subscription_synced_at timestamptz;

comment on column profiles.subscription_platform is 'Store the active subscription was purchased on (app_store/play_store/stripe/promotional). Written only by the RevenueCat webhook handler.';
comment on column profiles.subscription_synced_at is 'event_timestamp of the last RevenueCat event applied — out-of-order webhook guard.';

-- ----------------------------------------------------------------------------
-- 2. subscription_events: webhook idempotency + audit log
-- ----------------------------------------------------------------------------
-- Every received billing event (RevenueCat or Stripe) is recorded exactly once;
-- the primary key IS the idempotency check. Service-role only.
create table subscription_events (
  id text primary key,                      -- RevenueCat event.id, or 'stripe:'||event.id
  user_id uuid references profiles(id) on delete set null,
  type text not null,
  store text,
  environment text,                          -- SANDBOX | PRODUCTION
  event_timestamp timestamptz,
  raw jsonb not null,
  processed_at timestamptz not null default now()
);

create index idx_subscription_events_user on subscription_events(user_id, processed_at desc);

alter table subscription_events enable row level security;
-- No policies: service-role only (bypasses RLS); clients get nothing.
revoke all on subscription_events from authenticated, anon;

comment on table subscription_events is 'Billing webhook idempotency + audit. One row per processed RevenueCat/Stripe event; PK conflict = duplicate delivery = no-op. Service-role only.';

-- ----------------------------------------------------------------------------
-- 3. fitzy_message_log: metering primitive for the AI coach free-tier quota
-- ----------------------------------------------------------------------------
-- Mirrors the proven nutrition_parse_log insert-then-count pattern (no stored
-- procedures per CLAUDE.md; the (user_id, created_at) index makes the daily
-- count O(log n) at quota-sized row counts).
create table fitzy_message_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_fitzy_message_log_user_day on fitzy_message_log(user_id, created_at);

alter table fitzy_message_log enable row level security;
revoke all on fitzy_message_log from authenticated, anon;

comment on table fitzy_message_log is 'One row per Fitzy/nutrition-coach message, for tier-based daily quotas (usage-service). Service-role only.';

-- ----------------------------------------------------------------------------
-- 4. Pro feature gates — seeded DARK (required_tier defaults to 'free')
-- ----------------------------------------------------------------------------
-- Behavior is byte-identical to today until 077_enable_pro_gates.sql flips
-- these to 'premium' at launch (same pattern as 071's body_comp_* keys).
insert into feature_gates (feature_key) values
  ('food_ai_unlimited'),
  ('fitzy_unlimited'),
  ('history_extended'),
  ('circles_unlimited'),
  ('ads_removed'),
  ('data_export'),
  ('share_themes_custom'),
  ('streak_shields_bonus')
on conflict (feature_key) do nothing;
