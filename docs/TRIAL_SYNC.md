# Trial sync: one control for the free-trial length

Admin Tools → FitCircle → Remote config → **Free trial** changes the Pro free-trial length on the App Store, on Google Play and in remote config `trial_days` (server copy, the Stripe web trial and the trial reminder timing). It always changes them in that order.

Code: `apps/web/app/lib/stores/{asc-offers,play-offers,trial-durations}.ts`, `apps/web/app/lib/services/trial-sync.ts`, routes `apps/web/app/api/admin/trial-sync/**`.

## 1. Why one control

The iOS and Android apps read the trial length and price from the store offer at runtime, so their paywall copy follows the store automatically. Everything the server writes uses `trial_days`, for example push copy, promo cards, Fitzy and food-AI upsells, the web paywall and the Stripe trial. If the two values differ, users see a promise the store does not keep. Trial sync makes the stores the source of truth: it changes them, reads them back, and only then changes `trial_days`.

## 2. Supported lengths: 3, 7 and 14 days

| | App Store (`SubscriptionOfferDuration`) | Google Play (phase `duration`) |
|---|---|---|
| 3 days | `THREE_DAYS` | `P3D` |
| 7 days | `ONE_WEEK` | `P7D` (Play may echo `P1W`) |
| 14 days | `TWO_WEEKS` | `P14D` |

Apple's free-trial durations are a fixed list: 3 days, 1 or 2 weeks, 1, 2, 3 or 6 months, and 1 year. Play allows any free trial from 3 days to 3 years. Month-based lengths are left out on purpose: "1 month" is 28 to 31 days, so copy can't promise it as N days.

## 3. Store operations

### 3.1 App Store (`asc-offers.ts`)

- **Read:** `GET /v1/apps/{app}/subscriptionGroups?include=subscriptions`, then `GET /v1/subscriptions/{id}/introductoryOffers?include=territory` for each subscription.
- **Trial territories:** the territories that have a current `FREE_TRIAL` on any subscription. Today these are CAN, GBR, IND, SGP and USA on Pro monthly and Pro annual.
- **Change:** introductory offers can't be edited. The update request accepts only `endDate`. For each subscription × territory, trial sync sends `DELETE /v1/subscriptionIntroductoryOffers/{id}` and then `POST /v1/subscriptionIntroductoryOffers` with no `startDate`, so the new offer starts immediately. It keeps `targetSubscriptionPlanType` (`UPFRONT`). A queued future offer in that territory is deleted too.
- **If the POST fails:**
  1. Trial sync first re-reads the territory, because ASC can answer 5xx and still create the offer.
  2. If the offer was not created, it re-creates the previous offer.
  3. The run then stops.
- **Credentials:** the existing `ASC_*` key (App Manager role).

### 3.2 Google Play (`play-offers.ts`)

- **Read:**
  - `GET /applications/{pkg}/subscriptions`
  - `GET /applications/{pkg}/subscriptions/-/basePlans/-/offers`
- **Which offer is the trial:** the first phase whose every regional config is `free`.
- **Change:** trial sync never edits an ACTIVE offer. Each length gets its own offer, `<basePlanId>-trial<N>d` (the shipped offers are `monthly-trial3d` and `annual-trial3d`). For each active auto-renewing base plan that sells a trial, it runs these calls in order:
  1. `POST …/basePlans/{bp}/offers?offerId=…&regionsVersion.version=2022/02`. The body is a copy of the current offer's phases (free phase set to `PnD`), targeting, regions and tags. If an inactive offer of that length with the same regions already exists, this step is skipped and that offer is re-activated instead. Activated offer ids can't be reused.
  2. `POST …/offers/{new}:activate`.
  3. `POST …/offers/{old}:deactivate`. Deactivating stops new purchases only; existing subscribers keep the offer.
- **Credentials:**
  - Writes use `GOOGLE_PLAY_MONETIZATION_SA_KEY`.
  - Reads use that key when it is set, otherwise the read-only `GOOGLE_PLAY_SA_KEY`.
- **How the app picks the offer:** the app buys the RevenueCat `Package`, and RevenueCat's default option is the eligible offer with the longest free trial, skipping offers tagged `rc-ignore-offer`. No offer id or tag is hard-coded in the app, so a new offer id is picked up automatically. A template offer tagged `rc-ignore-offer` makes the plan invalid.

### 3.3 Remote config

After both stores read back correctly, trial sync makes two changes:

1. It sets the `trial_days` default to N, using `RemoteConfigService.setDefault`, which writes its own audit row.
2. It deletes every enabled platform-only (or empty-audience) `trial_days` rule. The prod rule "Web (Stripe) trial: 7 days" is one of these. Once the stores and the default agree, such a rule is either redundant or contradicts the stores.

Rules with other conditions, such as an experiment, country or version, are reported as warnings and left alone.

## 4. Admin API

All three routes use the same auth as `/api/admin/remote-config`: `ADMIN_API_SECRET` bearer plus `X-Admin-Actor`, or an `is_admin` session. Responses use the `{ success, data, error }` envelope and `no-store`.

| Route | Body | Writes |
|---|---|---|
| `GET /api/admin/trial-sync` | | none (store GETs) |
| `POST /api/admin/trial-sync/plan` | `{ days }` | none (dry run) |
| `POST /api/admin/trial-sync/apply` | `{ days, planHash }` | stores + remote config; actor required |

- **`status`** returns:
  - `appStore` and `googlePlay`: `{ configured, error, days, consistent, … }`. Google Play also has `canWrite`, App Store has `territories`, and each lists its offers per plan and territory.
  - `remoteConfig { codeDefault, default, rules[], effective: {ios, android, web}, webTrialEnabled }`.
  - `inSync`, `issues[]` and `warnings[]`.
- **`plan`** returns `{ days, planHash, valid, errors[], warnings[], steps[{id, store, action, description, request}], noop, status }`. An unsupported length returns 200 with `valid: false`. A malformed body returns 400 `VALIDATION_ERROR`.
- **`apply`** re-reads everything and recomputes the plan. It refuses in two cases, without writing anything:
  - 409 `PLAN_STALE` (with the fresh plan in `error.details.plan`) when the hash differs.
  - 422 `PLAN_INVALID` when the plan has errors.

  Otherwise it returns `{ runId, ok, steps[] (status done|failed|skipped, error), changed[], remoteConfigChanged, message, status }`.

## 5. Safety

- **Order:** store writes, then a read-back verify, then remote config. Any store or verify failure stops the run before remote config, so copy never promises more days than a store gives.
- **Audit:**
  - Every store step, the verify and a summary row go to `remote_config_changes` with `config_key = 'trial_sync'`, `target = 'default'` and the actor. `before` holds `{ runId, days, step, store, op, description, previous }` and `after` holds `{ status, error, detail }`.
  - The remote-config writes are audited under `trial_days` as usual.
  - No migration is needed.
- **Idempotent:** each step comes from the live state, so a re-run after a partial failure plans only what is missing. A run at the current length is a no-op.

## 6. Eligibility and review

- **No second trial:** people who already used a trial are not eligible again. Apple allows one introductory offer per subscription group. The Play offers target `acquisitionRule.scope.anySubscriptionInApp` ("never had any subscription in this app").
- **Running trials** keep their length.
- **No App Review:** introductory offers on an approved subscription have no review state in the API. Play offer changes need no review.
- **Propagation:** Apple says API changes to product metadata can take up to an hour to appear in sandbox.

## 7. Play write credential

**Done 2026-11-09.** The Play write credential is service account `play-subscriptions-admin@fitcircle-fitness-app.iam.gserviceaccount.com`. It has no GCP roles. In Play Console it has these permissions, on the FitCircle app only:

- **View app information** (read-only)
- **Manage store presence** ("Edit pricing, in-app products, and pricing templates")
- **Manage policy declarations** (Play added it automatically)

The key is in Vercel `GOOGLE_PLAY_MONETIZATION_SA_KEY` (production and preview, sensitive), stored as base64 of the key JSON. The parser also accepts raw JSON, the same as `GOOGLE_PLAY_SA_KEY`. A read-only snapshot with this key works. Writes stay unverified until the first real apply.

To recreate the credential:

1. Create a service account and a JSON key. It needs no GCP roles.
2. Invite it in Play Console under Users and permissions, with the FitCircle app permission **Manage store presence**.
3. Put the key in Vercel as a sensitive `GOOGLE_PLAY_MONETIZATION_SA_KEY`.
