# FitCircle Pro — Manual Launch Checklist

Everything code-side is built, tested, and **dark**. This file lists every manual step to take FitCircle Pro from "in the codebase" to "live", in order. Companion docs: `SUBSCRIPTION-PLAN.md` (full plan + test program), `SUBSCRIPTION-MODEL-CALCULATOR.html` / `SUBSCRIPTION-MODEL.xlsx` (revenue model).

## The three switches (know these first)

| Switch | What it controls | Where |
|---|---|---|
| **1. Feature flag `subscriptions`** (OFF today) | Whole subscription *surface* on iOS/Android/Web: paywalls, upgrade CTAs, web checkout. Off = app looks pre-subscription. | `feature_flags` table row — SQL below, no deploy/release |
| **2. RevenueCat API keys** (absent today) | Whether the mobile SDKs talk to RevenueCat at all. Absent = billing code inert. | iOS `Config.revenueCatAPIKey` / Android `REVENUECAT_API_KEY` build property |
| **3. Migration 082** (formerly 077; NOT applied today) | Free-tier *quotas* (5 AI parses, 5 Fitzy msgs, 14-day history, 2 circles, ads gating). Until applied, behavior is byte-identical to today. | `supabase/pending/082_enable_pro_gates.sql` |

Launch order is always **1 → (verify) → 3**. Turning on the flag before 082 means people can buy Pro while free users lose nothing — a safe soft-launch. 082 is the moment free limits begin.

### How to turn the feature ON

Run against Supabase (SQL editor, service role). Takes effect within ~5 minutes (client entitlement cache), no deploy, no app release:

```sql
-- Stage 1: just you / test accounts (get profile ids from the profiles table)
UPDATE feature_flags SET is_enabled = true,
  allowed_user_ids = ARRAY['<your-profile-uuid>']::uuid[]
WHERE name = 'subscriptions';

-- Stage 2: percentage rollout
UPDATE feature_flags SET is_enabled = true, rollout_percentage = 10 WHERE name = 'subscriptions';

-- Stage 3: everyone
UPDATE feature_flags SET is_enabled = true, rollout_percentage = 100 WHERE name = 'subscriptions';

-- KILL SWITCH (any time)
UPDATE feature_flags SET is_enabled = false WHERE name = 'subscriptions';
```

---

## Phase A — Database (do now, zero user impact)

- [ ] Apply `supabase/migrations/075_subscription_infrastructure.sql` (subscription_events, fitzy_message_log, profile columns, dark gates)
- [ ] Apply `supabase/migrations/076_subscriptions_feature_flag.sql` (the flag row, `is_enabled=false`)
- [ ] Verify migration 066 is applied in prod (`payments` client writes revoked) — it predates this work but is a security prerequisite
- [ ] Do **NOT** apply 082 yet

## Phase B — Stripe (web billing)

- [ ] Create Products/Prices: Pro Monthly $9.99/mo, Pro Annual $59.99/yr, Pro Lifetime $149.99 one-time
- [ ] Create the launch coupon (e.g. **$20 off, duration "once"** → first year $39.99) — optional until you run the promo
- [ ] Enable the Customer Portal (cancel + payment-method update)
- [ ] Add webhook endpoint `https://<your-domain>/api/webhooks/stripe`, subscribe to `checkout.session.completed` and `invoice.payment_failed`; copy the signing secret
- [ ] Set Vercel env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_PRO_LIFETIME`, optionally `STRIPE_COUPON_LAUNCH` + `NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL=39.99`, `NEXT_PUBLIC_LIFETIME_OFFER=true` when the lifetime window opens

## Phase C — App Store Connect (iOS)

- [ ] Sign the **Paid Applications Agreement** (Agreements, Tax, Banking) — blocks everything else; do first
- [ ] Subscription group "FitCircle Pro" with:
  - `com.inov8rlabs.fitcircle.pro.monthly` — $9.99/mo, **7-day free introductory offer**
  - `com.inov8rlabs.fitcircle.pro.annual` — $59.99/yr, **7-day free introductory offer** (same rank level as monthly)
  - For the launch promo: add a pay-up-front intro offer at $39.99 first year on the annual (replaces the free-trial intro while active — decide which intro you run at launch; you cannot stack both)
- [ ] Non-consumable `com.inov8rlabs.fitcircle.pro.lifetime` — $149.99
- [ ] Localized names/descriptions + a paywall screenshot per product (review requirement)
- [ ] App Store Server Notifications **V2** URL (Production + Sandbox) → the RevenueCat-provided URL (RC dashboard → your iOS app → Apple Server Notifications)
- [ ] Generate an In-App Purchase API key and upload to RevenueCat
- [ ] Privacy nutrition label: add "Purchases" data type
- [ ] Sandbox tester account created; review notes mention where the paywall lives (Settings → FitCircle Pro)

## Phase D — Google Play Console (Android)

Pre-existing blockers that also gate this:
- [ ] **Release signing**: create the keystore, fill `keystore.properties` (see `keystore.properties.example`) — unsigned builds can't reach any Play track
- [ ] **Real AdMob app id** replacing the sample id in `AndroidManifest.xml` + real ad unit ids in `AdConfiguration.kt`
- [ ] Play Console app record + **merchant account** (required for paid products)

Then:
- [ ] Subscription `pro` with base plans `pro-monthly` ($9.99, P1M) and `pro-annual` ($59.99, P1Y)
- [ ] Offer on `pro-annual`: `pro-annual-free-trial` — 7-day free phase, eligibility "never had this subscription"
- [ ] For the launch promo: a time-boxed offer with a discounted first-year phase ($39.99)
- [ ] One-time in-app product `pro_lifetime` ($149.99)
- [ ] **Real-time developer notifications (RTDN)**: create the Pub/Sub topic Google Cloud side, paste into Play Console → Monetization setup, connect in RevenueCat (without RTDN, refunds/grace/hold lag by hours)
- [ ] License testers added (Settings → License testing) for accelerated-renewal test purchases
- [ ] Data safety form: declare purchase history collection

## Phase E — RevenueCat (the hub)

- [ ] Create project "FitCircle" with three apps: iOS (`com.inov8rlabs.FitCircle`), Android (`com.fitcircle.app`), Stripe
- [ ] Upload credentials: App Store Connect IAP key, Play service-account JSON (Pub/Sub + Android Publisher roles), connect the Stripe account
- [ ] Entitlement **`pro`** attached to ALL products (both subs + lifetime on every store)
- [ ] Offerings: `default` (monthly/annual/lifetime packages, annual first) and `launch` (the discounted packages). Optional `metadata` keys `paywall_headline` / `paywall_promo` for remote copy. **Switching the current offering `default`↔`launch` starts/ends a promo with no app release.**
- [ ] Webhook → `https://<your-domain>/api/webhooks/revenuecat` with a custom **Authorization header** value you generate (long random string)
- [ ] Set Vercel env vars: `REVENUECAT_WEBHOOK_AUTH_TOKEN` (that header value), `REVENUECAT_SECRET_API_KEY` (REST API secret key)
- [ ] Copy the **public** SDK keys into the apps:
  - iOS: `appl_...` → `Core/Utilities/Config.swift` (`revenueCatAPIKey` fallback) or `REVENUECAT_API_KEY` env in the scheme
  - Android: `goog_...` → `-PrevenueCatApiKey=` Gradle property or `REVENUECAT_API_KEY` env in CI

## Phase F — Verification before any public rollout

- [ ] Backend: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, complete test checkouts (monthly-trial, annual-trial, annual-with-coupon, lifetime) → confirm profile flips premium and `payments` rows appear once
- [ ] RC dashboard "send test event" → 200; replay the same event → `already_processed`
- [ ] Enable the flag **for your account only** (Stage 1 SQL above)
- [ ] iOS sandbox: purchase both plans, trial→paid (accelerated), cancel-during-trial, restore on reinstall, lifetime hides sub UI, ads disappear instantly on purchase
- [ ] Android internal track + license tester: same matrix + grace period (declined card), account hold, resubscribe
- [ ] **Cross-platform acceptance** (the core promise): subscribe on one platform → all three show Pro within webhook latency; cancel → access to period end everywhere; refund → immediate downgrade everywhere
- [ ] TestFlight / internal-track builds pass App Review pre-flight: Restore button visible, terms/privacy links resolve, auto-renew disclosure present

## Phase G — Launch sequence

1. [ ] Flag → staged rollout (10% → 50% → 100%) while watching: trial starts, trial→paid, webhook error logs, reconcile-cron corrected count (should stay ~0)
2. [ ] When conversion loop is proven end-to-end: apply **migration 082** (free-tier quotas begin; ads gate on entitlement; watch the guardrail metrics — K-factor ≥ 0.4, D1/D7/D30 ≥ 40/20/10, week-1 circle-join ≥ 35%; if they drop, loosen free limits before touching the paywall)
3. [ ] Launch promo: switch RC current offering to `launch`, set `STRIPE_COUPON_LAUNCH` + `NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL`, enable the Play/App Store intro offers; time-box and reverse the same way
4. [ ] Lifetime window: `NEXT_PUBLIC_LIFETIME_OFFER=true` (web) + include the lifetime package in the current RC offering; retire after the window
5. [ ] Post-launch: RevenueCat Experiments on price/trial/copy; weekly review vs the calculator's Base scenario (`SUBSCRIPTION-MODEL-CALCULATOR.html`); recalibrate monthly

## Quick reference — all new env vars (Vercel)

```
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_ANNUAL / STRIPE_PRICE_PRO_LIFETIME
STRIPE_COUPON_LAUNCH                    (optional, promo window only)
NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL=39.99   (optional, promo display)
NEXT_PUBLIC_LIFETIME_OFFER=true         (optional, lifetime window)
REVENUECAT_WEBHOOK_AUTH_TOKEN           (must match RC webhook config header)
REVENUECAT_SECRET_API_KEY               (RC REST — reconcile cron + transfers)
```
