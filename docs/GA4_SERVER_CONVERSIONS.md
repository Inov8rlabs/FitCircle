# Server-side subscription conversions → GA4 / Google Ads

Status: code on branch `feat/ga4-server-conversions` (FitCircleBE), 2026-11-11. Off by default. Needs migration 135,
three env vars and the one-time console steps in §6.

## 1. Why

Google Ads (Android App campaign, account 770-813-7566) optimises on events it imports from GA4 property 553928425
(Firebase project `fitcircle-fitness-app`, Android stream 16035791419). The Android app logs `trial_start` and
`purchase` itself, but only at the moment of purchase on the device. It never sees a trial converting to paid, a
renewal or a refund, and with trial-first almost every Play purchase is a trial (value 0). So Google Ads has no real
revenue to bid on.

RevenueCat already tells the backend about every charge (`POST /api/webhooks/revenuecat` → `subscription_events`).
This sends those charges to GA4 with the Measurement Protocol (MP), with real revenue, on the user's Firebase app
instance.

## 2. Events

| RevenueCat event | GA4 event | value / currency | Client twin | Notes |
|---|---|---|---|---|
| `INITIAL_PURCHASE`, period `TRIAL` | `trial_started_server` | 0 USD | `trial_start` | Same fact as the client event. Do not import both as primary. |
| `INITIAL_PURCHASE` (NORMAL / INTRO, price > 0), `NON_RENEWING_PURCHASE` | `purchase_server` | gross USD | `purchase` | Also covers web (Stripe) purchases by Android users, which the client never sees. |
| `RENEWAL` with `is_trial_conversion: true` | `trial_converted` | gross USD | none | The money event for trial-first. |
| other `RENEWAL` | `subscription_renewed` | gross USD | none | |
| `CANCELLATION` that is a refund (negative price or `CUSTOMER_SUPPORT`) | `refund` (GA4 recommended event) | gross USD (positive) | none | Needs `transaction_id`. Never import into Google Ads. |
| everything else (`EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `UNCANCELLATION`, `TRANSFER`, `REFUND_REVERSED`, `TEST`, …) | none | | | |

Never sent: non-`PRODUCTION` events, Stripe-native audit rows, family-share copies, `PROMOTIONAL` grants, zero-price
charges. These are the same exclusions as the Ads Console / Finance, because the rules are
`lib/ads/metrics.ts classifyEvent`.

Params on every event: `plan` (`monthly` / `annual` / `weekly` / `other` / `unknown`, from the product id), `store`
(`play_store`, `app_store`, `stripe`), `product_id`, `period_type`, `transaction_id` (the store transaction / Play
order id), `source = server` and `rc_event_id`. Money events add `value` and `currency`.

Request: `app_instance_id` (from `user_attribution.app_instance_id`), `user_id` (the profile UUID, the same id the
Android app sets) and `timestamp_micros` (the RevenueCat event time). There is no `consent` block, so GA4 applies the
app instance's own consent state. The device always denies `ad_personalization`.

### Value: USD gross

`value` is RevenueCat's `price`: the USD, tax-inclusive gross that the customer paid. It is the same number across
App Store / Play / Stripe, and the same base the Ads Console uses. Google Ads value bidding (tROAS) expects revenue
in any currency. GA4 converts to the property currency, so sending USD is safe. Only when RevenueCat sent no USD
price does it fall back to `price_in_purchased_currency` + `currency`. Net of store fees and tax (≈ 0.85 × gross on
Play) is a possible alternative, see §8.

### Double counting: why distinct names (no dedupe possible)

GA4 de-duplicates `purchase` events by `transaction_id`. Google's help centre says this is reliable on web streams; for
app streams it says only that the id should come from the Firebase SDK. The Android client sends `purchase` and
`trial_start` **without** a transaction id. A server `purchase` with one could therefore never be matched to the client
event, and every direct Play purchase would count twice. So the server never sends `purchase` or `trial_start`. It
uses `purchase_server` and `trial_started_server`, and you choose which one to import (§6.4).

If the Android app later logs `transaction_id` = the Play order id (`GPA.…`, what RevenueCat reports as
`transaction_id`) on its `purchase`, `purchase_server` could be renamed to `purchase` and dedupe tested then.

### Platforms: Android only

iOS has a GA4 app stream (`GoogleService-Info.plist`, `FirebaseConversions.swift`, ATT-gated, client `trial_start` /
`purchase`). But it never reports its Firebase app instance id to the backend, and MP needs an id and the iOS app's
own `firebase_app_id` + secret. iOS users are skipped as `ios_user` / `no_app_instance_id`. Supporting iOS would need
the iOS app to send `appInstanceID()` to `POST /api/mobile/attribution` (under the same ATT/consent gate) and a second
MP config.

## 3. Flow, timing, idempotency

```
RevenueCat ─► POST /api/webhooks/revenuecat
               ├─ SubscriptionService.processRevenueCatEvent (subscription_events PK insert = dedupe)
               └─ first delivery + PRODUCTION + enabled ─► runAfterResponse(Ga4ConversionService.sendForEventId)
                     load event + profile + user_attribution
                     map (classifyEvent) → skip test users (classifyTestUser) / iOS / no app_instance_id
                     claim ga4_conversion_sends row → POST https://www.google-analytics.com/mp/collect → status
GET /api/cron/ads/ga4-conversions  (sweep / backfill, dry-run by default)
```

- **Never blocks or fails the webhook.** The send runs after the response, and every error is caught and logged.
  When disabled or not configured it is a no-op, logged at most hourly.
- **Exactly once per `subscription_events.id`.** `ga4_conversion_sends` (PK = event id) is claimed before sending.
  - `sent` is never sent again: RevenueCat retries are already stopped by `subscription_events`, and the table also
    covers concurrent sweeps.
  - `failed` is retried by the sweep up to 5 attempts.
  - `skipped / no_app_instance_id` is retried when the id shows up later.
  - `skipped / test_user | ios_user` is final.
  - A crashed `sending` claim can be retried after 10 min.
  - Without migration 135 nothing is sent at all.
- **Backdating.** MP accepts `timestamp_micros` up to **72 h** back. Older events are not rejected; they are silently
  re-stamped to "72 h ago", which would book revenue on the wrong day. So events older than 71 h 45 min are never sent
  (`too_old`). Google recommends sending within **48 h** for attribution joining. Live sends happen within seconds.
- **No app instance id → not sent, never faked.** Counted as `skipped:no_app_instance_id` in the sweep response
  (`missingAppInstanceId`) and in the table. This covers iOS, web-only users, Android users whose analytics consent
  is off, and Android users who never reported the id.
- **Test users never sent.** Uses `lib/ads/test-users.ts classifyTestUser` (internal, review, Test Lab, QA domains,
  Play testers, `ADS_TEST_EMAILS`) plus `user_attribution.is_test`.

### Sweep / backfill route

`GET /api/cron/ads/ga4-conversions`, with the `CRON_SECRET` or `ADMIN_API_SECRET` bearer:

| Query | Effect |
|---|---|
| (none) | **Dry run**: scans PRODUCTION conversion events in the window and returns per-event outcome + counts. Works without GA4 config. |
| `?validate=1` | Posts each payload to `/debug/mp/collect` with `ENFORCE_RECOMMENDATIONS`. Writes nothing. Needs config. |
| `?apply=1` | Sends. Needs `GA4_SERVER_CONVERSIONS_ENABLED=true` + config. |
| `?hours=N`, `?limit=N` | Look-back (capped at 71.75 h) and max events (default 500). |

It is **not** in `vercel.json`. Optionally add an hourly
`{"path": "/api/cron/ads/ga4-conversions?apply=1", "schedule": "15 * * * *"}` to retry failures and catch users whose
app instance id arrived after their purchase.

## 4. Migration 135

`supabase/migrations/135_ga4_conversion_sends.sql`: one table `ga4_conversion_sends`. Schema only, RLS on with no
policies (service role only), no functions or triggers. Apply alone, as the header says, then refresh the DB contract
snapshot and remove `ga4_conversion_sends` from `PENDING_RELATIONS`.

## 5. Env vars (Vercel, production)

| Var | Value |
|---|---|
| `GA4_SERVER_CONVERSIONS_ENABLED` | `true` to turn on (default off) |
| `GA4_MP_FIREBASE_APP_ID` | Android Firebase app id `1:<project number>:android:<hash>` (Firebase → Project settings → Your apps → Android, or `mobilesdk_app_id` in `google-services.json`) |
| `GA4_MP_API_SECRET` | the MP secret from §6.1. **Sensitive**: pipe into `vercel env add` without printing it. |

The collect URL contains the secret, so the code never logs it.

## 6. One-time owner setup

1. **MP API secret.** GA4 → Admin → Data collection and modification → Data streams → the Android stream
   (16035791419) → Measurement Protocol API secrets → accept the terms if prompted → Create → nickname
   `fitcircle-backend` → copy the value.
2. **Migration + env + deploy.** Apply migration 135. Set the three env vars in Vercel production, with the secret
   piped in unprinted. Redeploy.
3. **Verify.**
   - `GET …/api/cron/ads/ga4-conversions` (dry run) shows what would go out.
   - `?validate=1` must return empty `validationMessages`.
   - After the first live trial / purchase, check GA4 → Reports → Realtime (events by name) or Admin → Events within
     24–48 h.
4. **Key events.** GA4 → Admin → Data display → Key events → New key event, and add:
   - `trial_converted` and `purchase_server`: these are the money events.
   - Optionally `subscription_renewed`.
   - Optionally `trial_started_server` (only to compare with the client's `trial_start`).
   - **Not** `refund`.

   Key events can be created by name before the event first arrives.
5. **Import into Google Ads.** Account 770-813-7566 → Goals → Conversions → Summary → + New conversion action →
   Import → Google Analytics 4 properties → App → pick the key events above → Import and continue. For each one:
   - set **Action optimization = Secondary**;
   - set **Value = Use the value from Google Analytics**;
   - set **Count = Every** for `trial_converted`, `purchase_server` and `subscription_renewed`, and One for
     `trial_started_server`;
   - keep the default click-through window (30 days), which covers a 3–7-day trial.

   Secondary actions are reported but not bid on, so the campaign is unchanged until you decide.
6. **Which to make primary (recommendation).**
   - Leave the client `trial_start` as the trial optimisation event. It fires on the device in the ad-click session,
     which gives the best attribution join.
   - Compare `trial_started_server` with `trial_start` for ~2 weeks to see what the client loses to consent and
     timing.
   - For value bidding, `trial_converted` (+ `purchase_server`) is the only real revenue signal. Once it has enough
     volume (Google suggests ≥ 15–30 conversions / 30 days for tROAS), make it primary and switch the client
     `purchase` to secondary, so revenue is not counted twice.

## 7. Files

- `apps/web/app/lib/ads/ga4/conversions.ts`: pure mapping, eligibility, config, payload, reclaim rules.
- `apps/web/app/lib/ads/services/ga4-conversion-service.ts`: store (Supabase), send, sweep.
- `apps/web/app/api/webhooks/revenuecat/route.ts`: after-response hook.
- `apps/web/app/api/cron/ads/ga4-conversions/route.ts`: sweep / backfill.
- `supabase/migrations/135_ga4_conversion_sends.sql`.
- Tests:
  - `apps/web/app/lib/ads/__tests__/ga4-conversions.test.ts`
  - `apps/web/app/api/cron/ads/ga4-conversions/__tests__/route.test.ts`
  - `apps/web/app/api/webhooks/revenuecat/__tests__/route.test.ts`

## 8. Open questions

- **Gross vs net value.** Gross USD is sent now. If you want ROAS on proceeds, switch `value` to
  `classifyEvent(...).net` (one line in `mapRevenueCatEvent`).
- **Firebase automatic `in_app_purchase`.** If Play is linked to Firebase, the SDK may already log
  `in_app_purchase` with revenue. Check GA4 events. If it exists, do not import it alongside `purchase` /
  `purchase_server`.
- **Android `transaction_id`.** Adding the Play order id to the client `purchase` would allow testing GA4 dedupe and
  standard-`purchase` naming later.
- **iOS.** It needs the app to report `appInstanceID()` plus a second MP config (§2).
- **Value for trials.** `trial_started_server` carries 0. A predicted value (e.g. price × historical conversion
  rate) would be a separate product decision.
