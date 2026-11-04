-- ============================================================================
-- 126: ad revenue (AdMob) for the Ads Console (docs/ADS_METRICS_METHODOLOGY.md §9).
--
-- ad_revenue_daily: the AdMob Network Report (admob.googleapis.com v1
-- accounts.networkReport:generate) per day, app, ad unit and country, written
-- by the hourly ads sync (lib/ads/services/ad-revenue-sync-service.ts). Only
-- additive counts are stored; match rate, show rate, CTR and eCPM are derived
-- on read so they stay correct for any grouping.
--
-- Earnings are AdMob's ESTIMATED_EARNINGS (the API exposes no finalised
-- figure; finalised payments appear in AdMob → Payments). Days are AdMob report
-- days: the API accepts only America/Los_Angeles as the report time zone.
--
-- Sync runs are logged in ad_sync_runs with channel = 'admob' (no schema change).
--
-- Tables and indexes only. No functions, no triggers. RLS on with no policies
-- (service role only), like 108 / 117. Idempotent.
-- ============================================================================

create table if not exists public.ad_revenue_daily (
  -- Ad revenue network; only 'admob' today.
  source              text not null default 'admob' check (source in ('admob')),
  -- AdMob report day (America/Los_Angeles).
  date                date not null,
  -- AdMob app id (ca-app-pub-…~…) and ad unit id (ca-app-pub-…/…).
  app_id              text not null,
  app_name            text,
  platform            text not null default 'unknown' check (platform in ('ios', 'android', 'unknown')),
  ad_unit_id          text not null,
  ad_unit_name        text,
  -- NATIVE, BANNER, INTERSTITIAL, REWARDED, …
  format              text,
  -- ISO 3166-1 alpha-2; 'ZZ' when AdMob reports no country.
  country             text not null default 'ZZ',
  currency            text not null default 'USD',
  estimated_earnings  numeric(14, 6) not null default 0,
  ad_requests         integer not null default 0,
  matched_requests    integer not null default 0,
  impressions         integer not null default 0,
  clicks              integer not null default 0,
  synced_at           timestamptz not null default now(),
  primary key (source, date, ad_unit_id, country)
);
create index if not exists ad_revenue_daily_date_idx on public.ad_revenue_daily (date, platform);

alter table public.ad_revenue_daily enable row level security;
-- Intentionally no policies: service role only.
