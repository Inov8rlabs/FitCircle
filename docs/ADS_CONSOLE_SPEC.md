# Ads Console — spend, ROAS and bid control across channels

Status: v1 build, 2026-10-24. Owner: growth. Lives in the existing admin area (`/admin/ads`, gated on `profiles.is_admin`).

## 1. Goal

One internal page where we can see, per channel / platform / campaign / ad group / keyword / creative:

- **Spend** and delivery (impressions, taps, installs) pulled from the ad networks.
- **Outcomes** from our own data: sign-ups, activated users, paying users, revenue.
- **Unit economics**: CPI, cost per user, cost per activated user, cost per payer, ROAS (D7, D30, to date).
- **Setup**: bid strategy, budgets, bids, status, and which creatives (Custom Product Pages / Meta ads) each campaign uses.
- **Control**: change bids and budgets where bidding is manual, with guardrails and an audit log.

Non-goals for v1: creating campaigns or ad groups, uploading creatives, automated bid rules (designed for, see §9), MMP replacement.

## 2. Channels

| Channel | Platform | Spend API | Bid writes | v1 status |
|---|---|---|---|---|
| Apple Ads (`apple_ads`) | iOS | Apple Ads Campaign Management API v5 (reports + entities) | keyword bid, ad-group default bid, campaign daily budget, status pause/enable | **live** |
| Meta (`meta`) | Android (iOS later) | Marketing API v23 insights + campaigns/adsets/ads | ad-set bid amount (when bid strategy is a cap), ad-set / campaign daily budget, status | built, **off until `META_ADS_ACCESS_TOKEN` is set** |
| Google Ads (`google_ads`) | Android | Google Ads API v26 REST `googleAds:search` (GAQL), service-account auth | **none — read-only by design** (no mutate calls; guardrails list no writable fields) | built, **off until `GOOGLE_ADS_SA_KEY` is set** (§2.1) |
| Organic (`organic`) | all | — | — | outcomes only, for comparison |

Each channel is a connector implementing one interface (`lib/ads/connectors/types.ts`):

```ts
interface AdsConnector {
  channel: AdChannel
  isConfigured(): boolean
  /** Entities (campaign, ad_group, keyword, ad/creative) with setup fields. */
  fetchEntities(): Promise<AdEntityInput[]>
  /** Daily delivery rows, one per (entity, date), for [start, end] inclusive. */
  fetchDailyMetrics(start: string, end: string): Promise<AdDailyMetricInput[]>
  /** Apply one change. Must re-read the entity afterwards and return the new value. */
  applyChange(change: AdChangeRequest): Promise<AdChangeResult>
}
```

### 2.1 Google Ads connector (`lib/ads/connectors/google-ads.ts`)

- **Auth**: Google Cloud service account `google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com`, added directly as a **Read-only** user on the client account 770-813-7566 (no user OAuth, no domain-wide delegation, no manager login). Access token minted with the OAuth 2.0 JWT-bearer grant (RS256 via node crypto, scope `https://www.googleapis.com/auth/adwords`), cached until expiry.
- **Developer token**: sunset 2026-09-09. API access levels now belong to the Google Cloud project that owns the OAuth credentials (project `fitcircle-fitness-app`, Explorer = 2,880 production ops/day), managed on the Google Ads API Overview page in Cloud Console. The `developer-token` header is optional and ignored by the API, so it is sent only when `GOOGLE_ADS_DEVELOPER_TOKEN` is set. Source: https://developers.google.com/google-ads/api/docs/api-policy/developer-token (known issue there: projects upgraded after 2026-09-09 may get `AUTHORIZATION_ERROR` on production accounts until Google's fix rolls out; workaround is a new Cloud project).
- **Queries** (each one `googleAds:search` operation; ~4 per hourly sync ≈ 96/day):
  - campaigns: `campaign.id/name/status/serving_status/primary_status/advertising_channel_type/advertising_channel_sub_type/bidding_strategy_type/start_date_time/end_date_time/app_campaign_setting.*`, `campaign.target_cpa.target_cpa_micros`, `campaign_budget.amount_micros/total_amount_micros`, `customer.currency_code/time_zone` `FROM campaign WHERE campaign.status != 'REMOVED'`
  - ad groups: `ad_group.id/name/status/primary_status/type/target_cpa_micros, campaign.id FROM ad_group` (non-removed)
  - daily metrics, once `FROM campaign` and once `FROM ad_group`: `segments.date, metrics.cost_micros, impressions, clicks, conversions, all_conversions, biddable_app_install_conversions, biddable_app_post_install_conversions WHERE segments.date BETWEEN start AND end`
- **Mapping**: micros ÷ 1,000,000 → dollars (spend, daily budget, target CPA shown as `bid_amount`); clicks → `taps`; **installs = `metrics.biddable_app_install_conversions`** (Google's "Number of app installs" column for App campaigns), rounded per row, also stored as `new_downloads`; `segments.date` is in the account time zone (America/Toronto, same offsets as the console's America/New_York). Platform from `app_campaign_setting.app_store` (GOOGLE_APP_STORE → android). `serving_status` = `campaign.serving_status` (SERVING counts as live in the email); `primary_status` stays in `raw`.
- **Window**: hourly today-3 … today like the other channels; the channel's first successful run pulls from its earliest campaign start (capped at 90 days).
- Live verification (`/api/admin/ads/verify`) stays Apple-only; the connector implements `fetchTotals` for later.

## 3. Data model (migration 108, tables only — no stored procedures, no triggers)

- `ad_entities` — one row per remote object.
  `id uuid pk`, `channel`, `platform` (ios|android|web|all), `level` (campaign|ad_group|keyword|ad|creative), `external_id`, `parent_external_id`, `campaign_external_id`, `name`, `status` (remote status string), `serving_status`, `bid_strategy` (e.g. `MANUAL_CPT`, `MAXIMIZE_CONVERSIONS`, `LOWEST_COST`, `COST_CAP`), `bid_amount numeric`, `bid_currency`, `daily_budget numeric`, `total_budget numeric`, `match_type`, `countries text[]`, `start_at`, `end_at`, `creative jsonb` (e.g. `{productPageId, productPageName, thumbnailUrl, headline}`), `raw jsonb`, `synced_at`. Unique `(channel, level, external_id)`.
- `ad_metrics_daily` — `channel`, `level`, `external_id`, `campaign_external_id`, `date` (campaign/report time zone date), `spend numeric`, `currency`, `impressions`, `taps`, `installs`, `new_downloads`, `redownloads`, `synced_at`. PK `(channel, level, external_id, date)`. Upserted; the last 3 days are re-pulled every sync (networks restate).
- `user_attribution` — one row per user (first touch wins; never overwritten except from `unknown`).
  `user_id uuid pk → profiles`, `channel`, `platform`, `source` (raw source string, e.g. `apple_search_ads`, `google-play`, `meta`), `campaign_external_id`, `ad_group_external_id`, `keyword_external_id`, `ad_external_id`, `click_at`, `country`, `is_test boolean` (Apple mock payload campaign `1234567890`), `raw jsonb`, `reported_at`.
- `ad_change_log` — audit of every change attempt: `id`, `actor_user_id`, `channel`, `level`, `external_id`, `field` (bid|daily_budget|status), `old_value`, `new_value`, `requested_value`, `outcome` (applied|rejected|failed|dry_run), `error`, `created_at`.
- `ad_sync_runs` — `id`, `channel`, `started_at`, `finished_at`, `ok`, `rows_entities`, `rows_metrics`, `error`.

Revenue is **not** copied: it is read from `subscription_events` (RevenueCat webhook, already the single writer). Only `environment = 'PRODUCTION'` rows count. Net revenue per event = `price × (1 − tax_percentage − commission_percentage)` (RevenueCat's proceeds formula; `takehome_percentage` is deprecated and only a fallback; last resort 0.85 App Store / Play, 0.97 Stripe). Refunds (`CANCELLATION` with a negative price or `cancel_reason = 'CUSTOMER_SUPPORT'`) subtract; `REFUND_REVERSED` adds back. Trials, Family Sharing copies, promotional grants and Stripe-native webhook rows are $0; a store transaction counts once. Exact rules: `docs/ADS_METRICS_METHODOLOGY.md`.

## 4. Attribution: how a user is tied to an ad

1. **Mobile apps report it** — `POST /api/mobile/attribution` (authenticated) after sign-in, idempotent, first touch wins. Body:
   `{ platform, source, campaignId?, adGroupId?, keywordId?, adId?, clickDate?, country?, raw? }`.
   - iOS sends the stored AdServices result (`AppleSearchAdsAttribution`) once per user. `source = apple_search_ads` → `channel = apple_ads`; organic → `channel = organic`; Apple's mock campaign `1234567890` → `is_test = true`.
   - Android sends the Play install referrer parse (`AcquisitionAttribution`) and, when present, Meta's deferred deep-link campaign data. `utm_source=meta|facebook|instagram` or `fbclid` → `channel = meta`; `google-play` organic → `organic`.
2. **RevenueCat fallback** — when a purchase arrives for a user with no `user_attribution` row, the webhook reads `subscriber_attributes.$mediaSource / $campaign / $adGroup / $keyword` (populated by RevenueCat's Apple Search Ads integration) and inserts a row (`source = revenuecat`).
3. Users with neither are `channel = unknown` (older app versions); shown as their own row, never folded into organic.

Install counts come from the networks (they see installs we can't); everything after install (sign-up, activation, payer, revenue) comes from our data joined on `user_attribution`.

## 5. Metrics (computed in `lib/ads/metrics.ts`, pure, unit-tested)

For any slice (channel, platform, campaign, ad group, keyword, ad) and date range (by **attribution cohort**: users whose `profiles.created_at` falls in the range). Precise definitions, windows and limitations: **`docs/ADS_METRICS_METHODOLOGY.md`** (the source of truth for every KPI).

| Metric | Definition |
|---|---|
| Spend | Σ `ad_metrics_daily.spend` in range (USD; non-USD converted at the daily rate stored on sync, v1: USD only and flag others) |
| Installs | Σ network installs |
| Users | attributed users with `profiles.created_at` in range |
| Activated | users with ≥1 `food_log_entries` row (not a Health import) or manual check-in within 7 × 24 h of sign-up |
| Payers | users with ≥1 paid PRODUCTION charge (`INITIAL_PURCHASE`, `RENEWAL` incl. trial conversion, `NON_RENEWING_PURCHASE`) not cancelled out by a refund |
| Revenue (to date) | Σ net revenue of those users' events, all time |
| Revenue D7 / D30 | same, events within 7 / 30 days of the user's sign-up |
| CPI | Spend ÷ Installs |
| Cost per user | Spend ÷ Users |
| Cost per activated | Spend ÷ Activated |
| Cost per payer (CAC) | Spend ÷ Payers |
| ROAS D7 / D30 / to date | Revenue window ÷ Spend |
| Install→user, user→activated, user→payer | rates |

Every ratio returns `null` (rendered "—") when the denominator is 0. Cohorts younger than the window (e.g. D30 ROAS for users who signed up 5 days ago) are marked **incomplete** and the UI greys them.

Targets shown as reference lines (configurable in `ads_settings` later; v1 constants): cost per payer ≤ $35, D7 ROAS ≥ 10%, D30 ≥ 30%, 12-month ≥ 100%.

## 6. Sync

- Cron `GET /api/cron/ads/sync` hourly at :20 (`CRON_SECRET` like the other crons). Per configured connector: entities, then daily metrics for `today-3 … today`. Writes an `ad_sync_runs` row; one failing channel never blocks another.
- Backfill: `?start=YYYY-MM-DD&end=YYYY-MM-DD&channel=apple_ads` (admin secret only).
- First successful run per channel (no earlier `ok` row in `ad_sync_runs`): metrics from the earliest campaign start (≤ 90 days), so a newly connected channel backfills itself.
- Rate limits: Apple Ads ~ 10 req/s — connector paginates with limit 1000 and serial requests. Meta: uses async insights only above 50 ad sets (not needed in v1). Google Ads: ~4 search ops per run (Explorer access: 2,880/day).

## 7. Admin API (all behind `requireAdmin`)

- `GET /api/admin/ads/overview?start&end&groupBy=channel|platform|campaign|ad_group|keyword|ad` → `{ rows: AdsRow[], totals: AdsRow, lastSync: {channel, finishedAt, ok}[], dataHealth, definitions }` (`dataHealth`: sync freshness, spend reconciliation, attribution coverage, revenue-data quality, currency — computed on read; `definitions`: metric key → one-line definition).
- `GET /api/admin/ads/verify?start&end&channel=apple_ads` → live Apple grand totals for the range vs stored spend / impressions / taps / installs, per-field and per-campaign diffs, org time zone check. Read-only.
- `GET /api/admin/ads/campaigns/[channel]/[externalId]?start&end` → campaign entity + ad groups + keywords + creatives, each with metrics.
- `GET /api/admin/ads/timeseries?start&end&channel?&campaign?` → daily spend / users / payers / revenue.
- `POST /api/admin/ads/changes` → body `{ channel, level, externalId, field, value, dryRun? }` → `AdChangeResult` (see §8).
- `GET /api/admin/ads/changes?limit` → audit log.
- `POST /api/admin/ads/sync` → trigger a sync now (debounced: no-op if one finished < 2 min ago).

## 8. Bid and budget control — guardrails

A change is accepted only if all of these pass (`lib/ads/guardrails.ts`, pure, unit-tested):

1. The entity exists in `ad_entities` and its channel connector is configured **with write access** (`APPLE_ADS_WRITE_ENABLED=true` / `META_ADS_WRITE_ENABLED=true`; read-only by default).
2. **Bids only where bidding is manual**: Apple `MANUAL_CPT` (keyword and ad-group default bid); Meta ad sets with `LOWEST_COST_WITH_BID_CAP` / `COST_CAP` / `LOWEST_COST_WITH_MIN_ROAS`. Automated strategies show the bid read-only with the reason.
3. Bounds: bid ≥ channel minimum ($0.10 Apple) and ≤ `ADS_MAX_BID_USD` (default $10); daily budget ≥ $1 and ≤ `ADS_MAX_DAILY_BUDGET_USD` (default $200).
4. Step limit: a single change may not move a bid or budget by more than ±50% (override flag `force` for admins, logged).
5. Freshness: the entity was synced < 15 min ago, or the connector re-reads it first; if the remote value differs from what the user saw (`expectedOldValue`), reject with `stale` so nobody overwrites a change made elsewhere.
6. Every attempt (including rejected and dry-run) writes `ad_change_log`. After a successful write the connector re-reads the entity and updates `ad_entities`; the response carries the confirmed remote value.

UI: inline edit → confirm sheet showing old → new, % change, today's spend, the guardrail result (dry-run first), then Apply.

## 9. Later (designed, not built)

- Rule engine on top of `metrics.ts` + `applyChange` (e.g. "lower keyword bid 20% if spend > $30 and 0 activated users"), proposals reviewed in the UI before applying.
- Google Ads writes (deliberately not built). Meta iOS (SKAN/AdAttributionKit postbacks) — needs postback storage.
- Currency conversion table; per-territory campaigns.
- RevenueCat → Amplitude integration for product-side charts (independent of this console).

## 10. Configuration (Vercel env)

| Var | Purpose |
|---|---|
| `APPLE_ADS_CLIENT_ID`, `APPLE_ADS_TEAM_ID`, `APPLE_ADS_KEY_ID`, `APPLE_ADS_ORG_ID` | API client ids (not secret) |
| `APPLE_ADS_PRIVATE_KEY` | EC P-256 PEM (secret) — added by the owner with `vercel env add` |
| `APPLE_ADS_WRITE_ENABLED` | `true` to allow bid/budget writes (needs the API user's role upgraded to **API Account Manager**) |
| `META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID` | system-user token with `ads_read` (+ `ads_management` for writes), `act_1141795138521735` |
| `META_ADS_WRITE_ENABLED` | as above |
| `GOOGLE_ADS_SA_KEY` | **required for Google**: the service-account key JSON (raw, or base64 of it). Missing → Google is skipped (`not_configured`), email says "not configured" |
| `GOOGLE_ADS_CUSTOMER_ID` | optional, default `7708137566` (dashes allowed) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | optional manager id (e.g. `7300585097`); only when access comes through the manager, not needed while the SA is a direct user |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | optional; sent as `developer-token` only when set (ignored by the API since 2026-09-09) |
| `ADS_MAX_BID_USD`, `ADS_MAX_DAILY_BUDGET_USD` | guardrail caps |

## 11. Testing

- Unit: metrics (zero denominators, incomplete cohorts, refunds, takehome fallback), guardrails (every rule), connector response mapping from recorded fixtures (Apple report + entities, Meta insights), attribution route (first touch wins, mock payload → `is_test`, unknown upgrade).
- Contract: admin API shapes.
- Live smoke (manual, documented): Apple Ads read with the real key; dry-run bid change on the live keyword; one real +$0.05 bid change and revert, verified in the Apple Ads UI.
