# Google Ads (Android) attribution via GA4 / Firebase

Status: code on branches `feat/ads-attribution-coverage` (FitCircleBE, inov8r-admin) and `feat/ga4-attribution`
(Fitcircle-Android), 2026-10-30. Needs migration 117 and the console steps in §5 before it does anything.

## 1. Why

The Ads Console counts a sign-up as paid only when `user_attribution.channel` is a paid channel. On Android that row
comes from the Play install referrer (`POST /api/mobile/attribution`).

Verified against prod on 2026-10-30, for 2026-10-24 … 10-30:

- Google Ads reported **73 installs** (`ad_metrics_daily`, `google_ads`). Google's own per-day installs were
  4 / 15 / 25 / 29 (Oct 27–30).
- Only **3 users** are `google_ads`. All 3 had a gclid/gbraid in the referrer.
- **19 Android users** are `google-play` / `utm_medium=organic` with no click id. That is Play's default label.
  Their daily counts rose with Google's installs (Oct 28–30: 1 / 5 / 6).

Google App campaigns serve on Play search, YouTube, Discover and the Display network, and they count view-through
installs. Those installs usually arrive with an **organic Play referrer**. Google attributes them by
**advertising-id matching** inside Firebase / GA4, and our install-referrer path cannot see that match. So a large
share of Google-driven users shows as *Organic* in the console. Apple Ads coverage is fine (14 of 37).

There are two fixes:

| | What | Where |
|---|---|---|
| Fix 2 (interim) | Show Google's own conversion counts next to our attributed users, and show per-channel **attribution coverage** | `ad_conversions_daily`, Ads Console |
| Fix 1 (durable) | Tie Google's per-instance attribution to our users via the GA4 BigQuery export, and upgrade organic / unknown rows to `google_ads` | Android `setUserId` + `appInstanceId`; `/api/cron/ads/ga4-attribution` |

## 2. Data flow

```
Android app (release build, analytics consent permitted)
  ├─ FirebaseAnalytics.setUserId(profile UUID) on identify / null on logout
  ├─ logs first_open (automatic), sign_up, activated, trial_start, purchase  ──►  GA4 property 553928425
  └─ POST /api/mobile/attribution { …referrer…, appInstanceId }                       │ (Firebase project
        └─► user_attribution.app_instance_id   (= user_pseudo_id in BigQuery)         │  fitcircle-fitness-app)
                                                                                      ▼
                                      GA4 → BigQuery daily export: <project>.analytics_553928425.events_YYYYMMDD
                                                                                      │
  /api/cron/ads/ga4-attribution (daily 09:50 UTC, GA4_ATTRIBUTION_SYNC_ENABLED)  ◄────┘
     reads, per user_pseudo_id (Android, app_info.id = com.inov8rlabs.apps.fitcircle):
       user_id, traffic_source.{source,medium,name} (first-user acquisition),
       session_traffic_source_last_click.google_ads_campaign.{campaign_id, ad_group_id, …},
       collected_traffic_source.{manual_source, manual_medium} and whether a gclid was seen
     Google Ads signal = google_ads_campaign id, OR gclid, OR first-user google / cpc
     joins: GA4 user_id = profiles.id, else user_attribution.app_instance_id = user_pseudo_id
     upgrades organic / unknown (or inserts a missing row) → channel google_ads, source google_ads_ga4,
       campaign id (export id, else campaign name → ad_entities), raw = { ga4: evidence, previous: old row }
     never touches a paid row (apple_ads / meta / google_ads): the update is guarded on channel IN (organic, unknown)

Google Ads API (hourly ads sync)
  googleAds:search  segments.conversion_action* × metrics.(all_)conversions by campaign/day
     └─► ad_conversions_daily (kind: install / sign_up / activation / trial / purchase / other)
            └─► overview: networkSignUps, networkTrials, attributionCoverage per row + totals;
                dataHealth.attribution.byChannel
```

Notes:

- **Re-runs are no-ops.** Rows the sync wrote are `google_ads` / `google_ads_ga4`, so a re-run skips them
  (`already_ga4`). The default window is the last 7 full export days (`GA4_ATTRIBUTION_LOOKBACK_DAYS`, max 60).
- **Users who install before the setUserId release can still match.** A user who installed before this release but
  signs in on it gets `user_id` on their `session_start` events. `traffic_source` is user-scoped, so their first-user
  acquisition is still on those rows.
- **Consent gating.** `setUserId` and `appInstanceId` follow the same gating as the conversions. Both are only sent
  in the release build (`AD_ATTRIBUTION_ENABLED`), with analytics not opted out and UMP consent permitting collection
  (outside the EEA/UK: on; in the EEA/UK: TCF purpose 1). Otherwise no id is set or sent.
- **iOS is unchanged.** Apple Ads attribution via AdServices already works.
- **Migration order.** The backend tolerates being deployed before migration 117:
  - The report treats a missing `ad_conversions_daily` as "no network conversions".
  - The sync logs `conversionsError` without failing.
  - `POST /api/mobile/attribution` stores the row without `app_instance_id`.

  The GA4 sync itself needs 117. Apply 117 before turning the sync on.

## 3. What was already true on 2026-10-30

These were checked read-only with the `google-ads-reporting` service-account key.

| Check | Result |
|---|---|
| Google Ads conversion actions (770-813-7566) | Only one is ENABLED: `FitCircle: Fitness & Nutrition (Android) installs …` (GOOGLE_PLAY_DOWNLOAD, primary). The Firebase actions (first_open, purchase, in-app purchase, app_store_subscription_*, …) for the prod, .qa and .dev apps exist but are all **HIDDEN**. There is **no `sign_up`, `activated` or `trial_start` action**, so `networkSignUps` is `null` today and Google coverage falls back to ÷ installs. |
| Google per-action conversions Oct 27–30 | installs action 4 / 15 / 25 / 29 (campaign 24397202136). This matches `ad_metrics_daily`. |
| BigQuery datasets in `fitcircle-fitness-app` | `datasets.list` returned 200 with **no datasets** for `google-ads-reporting` and for `firebase-adminsdk-fbsvc`. `jobs.list` → 403 (`google-ads-reporting` has no BigQuery role). Most likely **no `analytics_553928425` export exists yet**. A dataset hidden by permissions can't be fully ruled out. |
| GA4 → BigQuery link | **Could not check.** The Analytics Admin API is disabled in the service accounts' project (114851102115). It was not enabled, because that is a console change. Check in GA4 Admin (step 1 below). |
| GA4 events | Per the 2026-10-29 note, GA4 had only `first_open` / `session_start`. `sign_up` was not reaching Firebase, and the fix was going out in Android release/1.2.0. |

## 4. Env vars (Vercel, FitCircleBE production)

| Var | Value | Required |
|---|---|---|
| `GA4_ATTRIBUTION_SYNC_ENABLED` | `true` to run the cron (default off → `{ skipped: 'disabled' }`) | yes, last |
| `GA4_BIGQUERY_PROJECT_ID` | `fitcircle-fitness-app` (the project the export lands in; it also runs the query jobs) | yes |
| `GA4_BIGQUERY_DATASET` | `analytics_553928425` | yes |
| `GA4_BIGQUERY_SA_KEY` | Optional. Key JSON (raw or base64) of a separate SA. If unset, the sync uses `GOOGLE_ADS_SA_KEY` (`google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com`). | no |
| `GA4_BIGQUERY_LOCATION` | Dataset location if not `US` (e.g. `EU`) | no |
| `GA4_ANDROID_APP_ID` | Defaults to `com.inov8rlabs.apps.fitcircle` (excludes .qa / .dev) | no |
| `GA4_ATTRIBUTION_LOOKBACK_DAYS` | Defaults to 7 (max 60) | no |

If the project, dataset or key is missing or malformed, the cron returns `{ skipped: 'not_configured' }`.

## 5. Human console steps

Do these in order. Steps 1–2 are urgent: **the BigQuery export is not retroactive**. Events from before the link
are never exported, so every day of delay is a day of Google-driven installs that can never be attributed per user.

1. **Link GA4 to BigQuery.** In GA4 (analytics account a399165271, property *553928425*), go to Admin → Product links →
   **BigQuery links** → Link.
   - Project: **fitcircle-fitness-app** (the Firebase project; the BigQuery API is already enabled there).
   - Data location: US (or set `GA4_BIGQUERY_LOCATION`).
   - Data streams: the **Android** stream 16035791419 (iOS is optional).
   - Frequency: **Daily**. Streaming is optional and not used by the sync.
   - The dataset `analytics_553928425` appears within about 24 h. The first `events_YYYYMMDD` table lands the day
     after.
2. **Sandbox vs billing.** Without billing on `fitcircle-fitness-app`, BigQuery runs in **sandbox** mode: tables
   expire after **60 days**, and daily export is limited (no streaming). The 7-day window still works, so sandbox is
   fine to start. Enable billing to keep history beyond 60 days. Volume is tiny (pennies a month), and the first 1 TB
   of queries per month is free.
3. **Grant the service account read access.** In Cloud Console → IAM for project `fitcircle-fitness-app`, grant
   `google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com`:
   - **BigQuery Job User** (`roles/bigquery.jobUser`) on the project (to run queries);
   - **BigQuery Data Viewer** (`roles/bigquery.dataViewer`), either on dataset `analytics_553928425` (preferred,
     after step 1 creates it) or on the project.
4. **Apply migration 117** (`supabase/migrations/117_ads_attribution_coverage.sql`). Apply it alone, as with 106–111:
   use `db query --linked` with the file, then insert into the migration history. Do **not** run
   `db push --include-all`, because 104 and 077 are unapplied on purpose.
5. **Deploy the backend.** Merge `feat/ads-attribution-coverage` and confirm the Vercel prod deployment is READY.
   Admin Tools needs its branch merged too, to show the new columns.
6. **Ship Android** `feat/ga4-attribution`. It sends `setUserId` and `appInstanceId`. It can ride with the next
   release; no version bump is on the branch.
7. **Import GA4 conversions in Google Ads** (optional for the sync, needed for `networkSignUps`). In GA4 Admin →
   Events, mark `sign_up`, `activated` and `trial_start` as **key events** once they appear. Then in Google Ads →
   Goals → Conversions → New → Import → Google Analytics 4 (app), select them. Keep them **secondary** unless you
   want to bid on them. The console reads `all_conversions`, so secondary actions count.
8. **Set env vars and turn the sync on.** Set `GA4_BIGQUERY_PROJECT_ID` and `GA4_BIGQUERY_DATASET`. When the first
   `events_*` table exists, set `GA4_ATTRIBUTION_SYNC_ENABLED=true` and redeploy.

## 6. Verify

- **Dataset exists:** `bq ls --project_id fitcircle-fitness-app` shows `analytics_553928425`, and
  `bq ls fitcircle-fitness-app:analytics_553928425` shows `events_2026MMDD` tables.
- **Dry run:** `curl -H "Authorization: Bearer $CRON_SECRET" "https://www.fitcircle.ai/api/cron/ads/ga4-attribution?dryRun=1"`.
  Read `data.instances`, `googleInstances`, `matched`, `upgraded`, `inserted` and `outcomes` (`unmatched` = Google
  instances we can't tie to a user yet).
- **Errors:** a 500 with `HTTP 403 [accessDenied]` means step 3 is missing. `HTTP 404 [notFound]` means a wrong
  dataset, project or location.
- **Rows:** after a real run,
  `select source, channel, count(*) from user_attribution where source = 'google_ads_ga4' group by 1, 2;`
  and inspect `raw->'ga4'` (signals, matchedBy, campaign ids) and `raw->'previous'` (the replaced row).
- **Ads Console:** the Google Ads row shows Google-reported sign-ups / trials (after step 7) and **Attribution
  coverage**. *Data health → Attribution coverage* lists one line per channel. Coverage should rise as the sync
  upgrades users.
- **Backfill** (admin secret): `GET /api/cron/ads/ga4-attribution?start=2026-11-01&end=2026-11-07` with
  `Authorization: Bearer $ADMIN_API_SECRET`.

## 7. Limits

- Google's matching is probabilistic and includes view-through. `networkSignUps` is an upper bound, and coverage
  near 100% is not expected.
- A user who never signs in on an app version with `setUserId`, and whose `appInstanceId` never reached us (consent
  off, older app), cannot be matched.
- The export is daily, so upgrades lag by about 1–2 days.
- Only Android. iOS Google Ads (none running) would need the iOS app to set the GA4 user id.
