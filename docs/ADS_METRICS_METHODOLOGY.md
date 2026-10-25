# Ads Console — Metrics Methodology

Source of truth for every number the Ads Console shows (`GET /api/admin/ads/*`, admin app → Ads).
Code: `apps/web/app/lib/ads/metrics.ts` (revenue + per-user outcomes + ratios), `report.ts` (slicing, totals,
time series), `services/report-service.ts` (loading), `data-health.ts`, `definitions.ts` (tooltip one-liners —
keep in sync with this file). Golden test with hand arithmetic: `apps/web/app/api/admin/ads/__tests__/golden.test.ts`.

Last verified against: RevenueCat webhook docs (event types and fields; taxes and commissions) and Apple Ads
Campaign Management API v5 (`SpendRow`, `ReportingRequest`) on 2026-10-24.

---

## 1. Two kinds of numbers, joined on a cohort

| | Delivery (network-reported) | Outcomes (our data) |
|---|---|---|
| Metrics | spend, impressions, taps, installs | users, activated, trials, payers, revenue |
| Source | `ad_metrics_daily` (synced from Apple Ads / Meta) | `profiles`, `user_attribution`, `food_log_entries`, `daily_tracking`, `subscription_events` |
| Dated by | **report day** of the delivery (network's time zone) | the user's **sign-up day** (`profiles.created_at` in the report time zone) |

A range `start … end` therefore means: *spend delivered on those days* vs *outcomes of users who signed up on those
days*. Revenue of those users is followed forward in time (D7, D30, to date), not limited to the range.

**Report time zone**: `ADS_REPORT_TIMEZONE`, default `America/New_York`. Apple reports in the org time zone
(`timeZone: ORTZ`); the two must match or day boundaries differ — `GET /api/admin/ads/verify` checks this live.
Meta reports in the ad account time zone.

**Cohort loading**: profiles are read with `created_at` in `[start 00:00Z − 14 h, end+1 00:00Z + 14 h)` (covers every
zone from UTC−12 to UTC+14) and then kept only when their local date in the report time zone is within
`start … end` inclusive. A user who signs up at 23:59:59 local on `end` is in; 00:00:00 the next day is out.

## 2. Delivery metrics

| Key | Formula | Notes |
|---|---|---|
| `spend` | Σ `spend` of **campaign-level** rows with `date` in range | Apple `localSpend` (org currency), Meta `spend`. Summed in integer cents. No FX: non-USD spend sets `mixedCurrency` and dataHealth → red. |
| `impressions` | Σ `impressions` | |
| `taps` | Σ `taps` | Apple taps; Meta `clicks` (all clicks, not only link clicks). |
| `installs` | Σ `installs` | Apple **`totalInstalls`** = tap-through + view-through, new downloads + redownloads (Apple defines `totalAvgCPI` on this). `tapInstalls` (30-day tap window) would be lower. Meta: `mobile_app_install` action. |

Breakdowns below campaign level (ad group, keyword, ad) use that level's own rows. Delivery the network reports on no
child entity — Apple **Search Match** has no keyword; Meta has no keywords — goes to the channel's
"unattributed …" row as `campaign − Σ children` (per field, clamped at 0), so **every breakdown adds up to the
totals**. A negative gap (children > campaign) is a data error and shows up in dataHealth.

## 3. Outcome metrics (per user, then summed)

Excluded from every count: internal / review / test-lab / QA / Play pre-launch tester sign-ups and Apple's mock
AdServices payload (`lib/ads/test-users.ts`; `?includeTest=1` counts them; the overview reports how many were left
out by reason). Users are attributed by `user_attribution` (first touch wins); a mock (`is_test`) attribution counts
as no attribution.

| Key | Definition |
|---|---|
| `users` | Cohort users attributed to the slice. **Totals and the time series count only paid-channel users** (apple_ads, meta, google_ads); organic / unknown keep their own rows in the by-channel table. |
| `activated` | First activity in `[signup − 1 min, signup + 7 × 24 h)`. Activity = a `food_log_entries` row **not** imported from Apple Health / Health Connect (`input_method ≠ 'imported'`), or a `daily_tracking` row **not** created by a step auto-sync (`steps_source ∉ {healthkit, google_fit}`). Uses row `created_at`. |
| `trials` | User has a PRODUCTION `INITIAL_PURCHASE` with `period_type = TRIAL` (not a Family Sharing copy). |
| `payers` | User has ≥ 1 paid charge (§4: a charge with price > 0 or an unknown price) and more paid charges than net refunds (refunds − refund reversals). A fully refunded buyer is not a payer. To date, no window. |
| `revenueD7` | Σ net revenue of the user's events with `event_timestamp − signup < 7 × 24 h`. |
| `revenueD30` | Same, `< 30 × 24 h`. |
| `revenueToDate` | Σ net revenue of all the user's events so far. |

Windows are half-open (`<`), identical for activation and revenue. Event time = `subscription_events.event_timestamp`
(RevenueCat `event_timestamp_ms`; retries keep it). A refund is dated when it happened, so a refund on day 10 reduces
D30 and to-date but not D7.

**Incomplete flags**: with `age = today − end` (days), `activated` and `d7` are incomplete while `age < 8`, `d30` while
`age < 31` (the last cohort day's latest sign-up needs the full window). The UI greys these.

## 4. Revenue rules (one event → net USD)

Only `subscription_events` rows with `environment = 'PRODUCTION'` are loaded or counted. Per event
(`classifyEvent` in `metrics.ts`):

1. **Kind**
   - *charge*: `INITIAL_PURCHASE`, `RENEWAL` (includes trial conversions — RevenueCat sends them as `RENEWAL`),
     `NON_RENEWING_PURCHASE` (lifetime).
   - *refund*: `CANCELLATION` with a negative `price` (RevenueCat: price is negative for refunds) or
     `cancel_reason = CUSTOMER_SUPPORT`. Amount = |price|.
   - *refund reversal*: `REFUND_REVERSED` (App Store only) — adds the amount back.
   - everything else (`PRODUCT_CHANGE`, `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `TRANSFER`,
     `SUBSCRIPTION_EXTENDED`, `TEMPORARY_ENTITLEMENT_GRANT`, `TEST`, …) = $0. A product change's money arrives as its
     own `RENEWAL` / `INITIAL_PURCHASE`; counting `PRODUCT_CHANGE` too would double it.
2. **Zero-value cases**: `period_type = TRIAL` charges (even if a price is present), `is_family_share = true`
   (the organiser's purchase is the paid one), `store = PROMOTIONAL`, and Stripe-native webhook rows
   (ids `stripe:*` — RevenueCat reports the same web purchases/refunds as `store = STRIPE`).
3. **Gross USD** = `price` (RevenueCat's USD-converted, tax-inclusive price). If `price` is null and `currency = USD`,
   `price_in_purchased_currency`. Otherwise the amount is unknown → $0 and counted in dataHealth (`missingPrice`).
4. **Take-home rate** = `1 − tax_percentage − commission_percentage` (RevenueCat's proceeds formula; both are fractions
   of the gross price; App Store tax is deducted before commission, matching Apple). If those are absent, the
   deprecated `takehome_percentage`. If that is absent too, a store fallback — 0.85 (App Store Small Business /
   Play subscriptions) or 0.97 (Stripe) — which **ignores tax** and is counted in dataHealth (`fallbackRateUsed`).
5. **Net** = round(gross × rate, cents); refunds negative.
6. **Each money movement counts once**: duplicates by event id, or by `(kind, store, transaction_id)` across event
   ids and across users (re-deliveries, restores, transfers), are dropped keeping the earliest. Purchase and refund of
   one transaction share `transaction_id`, hence the kind in the key.

Examples (golden test): $9.99 monthly at 15 % commission → $8.49; $29.99 annual with 20 % tax + 15 % commission →
$19.49; $179.99 lifetime with takehome 0.85 → $152.99.

## 5. Ratios

Every ratio is `null` (shown "—") when its denominator is 0; never NaN/Infinity.

| Key | Formula |
|---|---|
| `cpt` | spend ÷ taps |
| `ttr` | taps ÷ impressions |
| `cpi` | spend ÷ installs |
| `costPerUser` | spend ÷ users |
| `costPerActivated` | spend ÷ activated |
| `costPerPayer` (CAC) | spend ÷ payers |
| `roasD7` / `roasD30` / `roasToDate` | revenueD7 / revenueD30 / revenueToDate ÷ spend |
| `installToUser` | users ÷ installs |
| `userToActivated` | activated ÷ users |
| `userToPayer` | payers ÷ users |

Rows for organic / unknown have spend 0, so their cost ratios are 0 or null — they are outcome-only rows.
Time series: spend and installs by report day; users, activated, payers and revenue (to date) by sign-up day;
`cumulativeRoas` = running Σ revenue ÷ running Σ spend. Σ points = totals (enforced by invariant tests).

## 6. Known limitations

- **Cash basis.** Revenue is counted when charged. An annual plan ($29.99) counts in full at purchase; a lifetime
  purchase ($179.99) counts once. There is no deferral, no MRR normalisation and **no LTV projection** yet — "to date"
  ROAS understates long-run value for monthly plans and front-loads annual/lifetime.
- **Attribution coverage.** Until iOS server-side attribution reporting (AdServices token → `POST /api/mobile/attribution`)
  ships in the next app release, Apple Ads users are attributed only by RevenueCat's Apple Search Ads fallback, which
  creates an attribution row when the user purchases or starts a trial. Apple Ads sign-ups who never start a trial
  appear as *Unknown*: Apple users / activated are understated, cost per user overstated, user→payer overstated.
  Payers and revenue are mostly captured. dataHealth reports coverage (`attributedPaidUsers ÷ paidInstalls`).
- **Installs ≠ sign-ups.** Network installs include redownloads and view-through installs and are dated by install;
  users are dated by sign-up. `installToUser` is not a funnel conversion in the strict sense.
- **Network restatement.** Apple and Meta restate recent days; the sync re-pulls the last 3 days each run. Older diffs
  need a backfill (`/api/cron/ads/sync?start&end`); `/verify` says which.
- **Refunds of earlier periods.** RevenueCat fires `CANCELLATION` only for the latest period's refund; refunds of older
  periods are invisible to webhooks and are not subtracted. App Store upgrade proration credits are not reported either.
- **Tax fallback.** Events without tax/commission data use a store rate on the tax-inclusive price (overstates net
  where VAT applies). Counted in dataHealth.
- **Currencies.** Spend is summed as reported; a non-USD account makes totals wrong (dataHealth red). Revenue is USD.
- **Purchases without a user.** RevenueCat events whose `app_user_id` is not a FitCircle profile (anonymous purchases)
  have `user_id = null` and are not attributed to any cohort.
- **Activation proxy.** Uses row creation time; a manual weight entered on a day whose row was created by a step
  auto-sync is not seen as activation (under-count). The onboarding first check-in counts as activation.

## 7. Data health (`overview.dataHealth`, computed on read)

| Check | Green | Amber | Red |
|---|---|---|---|
| Sync freshness (per configured channel, latest `ad_sync_runs.ok = true`) | ≤ 2 h old | > 2 h, or the latest run failed | never succeeded, or > 26 h |
| Spend reconciliation (campaign spend = Σ ad-group spend per campaign/day, ±$0.01) | all match | some mismatch | > $1 and > 1 % of spend unreconciled |
| Keyword coverage (Apple Σ keyword ÷ campaign spend) | informational — the remainder is Search Match; keyword rows are never compared for equality | | |
| Attribution coverage (attributed paid users ÷ paid installs) | ≥ 50 % | < 50 % (with the explanation above) | |
| Revenue data (cohort's PRODUCTION revenue events) | no fallbacks | events with no USD price or with the store-fallback rate | |
| Currency | all USD | | any non-USD spend |

Also reported: events lacking `takehome_percentage` (informational — tax/commission used instead), duplicates
dropped, Family Sharing copies excluded.

**Live verification**: `GET /api/admin/ads/verify?start&end&channel=apple_ads` requests Apple's campaign report for the
range without granularity (`returnRowTotals` + `returnGrandTotals`, `timeZone: ORTZ`) and compares spend
(±$0.01), impressions, taps and installs (`totalInstalls`, exact) with Σ stored campaign-level rows, per field and
per campaign, plus the org time zone (`GET /acls`) vs `ADS_REPORT_TIMEZONE`. Read-only.
