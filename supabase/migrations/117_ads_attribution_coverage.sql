-- ============================================================================
-- 117: ads attribution coverage (docs/ADS_ATTRIBUTION_GA4.md).
--
--  1. ad_conversions_daily — the ad network's own conversion counts per
--     campaign, day and conversion action (Google Ads: installs, sign_up /
--     trial_start / purchase once imported from GA4). Shown next to our
--     attributed users so the attribution gap is visible.
--  2. user_attribution.app_instance_id — the Firebase app instance id the
--     Android app reports, = user_pseudo_id in the GA4 BigQuery export. Lets the
--     GA4 attribution sync (/api/cron/ads/ga4-attribution) join Google's
--     ad-id-matched attribution to our users.
--
-- Tables, columns, indexes only. No functions, no triggers. RLS on with no
-- policies (service role only), like 108. Idempotent.
-- ============================================================================

create table if not exists public.ad_conversions_daily (
  channel                 text not null check (channel in ('apple_ads', 'meta', 'google_ads')),
  level                   text not null default 'campaign' check (level in ('campaign', 'ad_group')),
  external_id             text not null,
  campaign_external_id    text,
  -- Network report day (account time zone), like ad_metrics_daily.date.
  date                    date not null,
  conversion_action_id    text not null,
  conversion_action_name  text,
  -- Network category, e.g. Google DOWNLOAD / SIGNUP / PURCHASE / DEFAULT.
  category                text,
  -- Our bucket (lib/ads/connectors/google-ads.ts conversionKind).
  kind                    text not null check (kind in ('install', 'sign_up', 'activation', 'trial', 'purchase', 'other')),
  -- Fractional under data-driven attribution.
  conversions             numeric(14, 2) not null default 0,
  all_conversions         numeric(14, 2) not null default 0,
  synced_at               timestamptz not null default now(),
  primary key (channel, level, external_id, date, conversion_action_id)
);
create index if not exists ad_conversions_daily_date_idx on public.ad_conversions_daily (date, channel, kind);

alter table public.ad_conversions_daily enable row level security;
-- Intentionally no policies: service role only.

alter table public.user_attribution add column if not exists app_instance_id text;
create index if not exists user_attribution_app_instance_idx on public.user_attribution (app_instance_id) where app_instance_id is not null;
