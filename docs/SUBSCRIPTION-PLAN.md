# FitCircle Subscriptions — Business Case + Cross-Platform Execution Plan

## Context

FitCircle (privacy-first social fitness circles; iOS/Android/Web) is pre-revenue and pre-launch. Payments are wired **nowhere** — Stripe keys are placeholders, no webhook routes, no StoreKit/Play Billing/RevenueCat code. But the codebase is deliberately pre-seamed for billing:

- **Server entitlement backbone is live**: `feature_gates` table (migration 071) + `EntitlementService` (`FitCircle/apps/web/app/lib/services/entitlement-service.ts`) with `requireFeature()` → 403 `PREMIUM_REQUIRED`; mobile consumes `GET /api/mobile/entitlements`. Body Composition is already gated end-to-end (incl. iOS/Android `PremiumLockCard` UI).
- **`profiles`** already has `stripe_customer_id`, `subscription_tier` (free/premium/enterprise), `subscription_status`, `subscription_expires_at`; a `payments` table exists with client writes already revoked (migration 066: "written only by the service role").
- **Ads seam**: both mobile apps gate ads on `EntitlementsProvider.isPremium` — currently a hardcoded-false stub explicitly waiting for billing (`Core/Ads/EntitlementsProvider.swift`, `core/ads/EntitlementsProvider.kt` + `AdsModule.kt`).
- **AI metering**: food photo/voice/item AI has a 25/day combined soft cap; **Fitzy coach chat (claude-sonnet-4.6) has NO cap** — the largest uncapped cost and the prime paywall trigger.

User decisions confirmed: **US-first pricing** with store regional tiers; **pre-launch** (model is scenario-driven); **RevenueCat** as cross-platform backbone; **ads stay on the free tier**, Pro removes them; **$9.99/mo + $59.99/yr** with **limited-time first-period discounts** on top (e.g. launch ~~$59.99~~ $39.99/yr); **Lifetime $149.99 time-boxed launch offer: yes**; **7-day free trial** on both plans.

Goal: users can subscribe on iOS (StoreKit 2 IAP), Android (Play Billing), or Web (Stripe — no store cut), with one entitlement everywhere.

## Research base (deep-research run, 103 agents, claims adversarially verified 3-0 unless noted)

- **Health & Fitness converts best of any category**: median 2.9% download→paid at D35; download→trial 6.9% median (top quartile >23%); trial→paid median 37.7–39.9% (top quartile >51%). [RevenueCat SOSA 2025/2026]
- **Annual-first is the category playbook**: 67–68% of subscriptions sold are annual; H&F is the only App Store category where annual share is still growing (51%→61%, 2023–25). Median category prices $9.99/mo, $39.94/yr (indie-skewed floor). [RevenueCat + Adapty]
- **Don't underprice**: higher-priced annual plans yield ~4–4.5× per-user LTV ($70 vs $17); H&F has the highest per-install LTV of any category ($1.21 global, ~2× in North America). Free trials *increase* LTV in H&F (unlike some categories). [Adapty]
- **Trials**: near-universal (only 18.3% of H&F apps ship none); 82% of trial starts happen Day 0 (onboarding paywall); longer trials convert better (42.5% for 17–32-day vs 25.5% for ≤4-day; 37.4% for 5–9 days). Onboarding paywall + trial = highest-converting placement. [RevenueCat/Adapty]
- **Strava is the closest analog**: annual-first with monthly-equivalent anchor, 30-day trial, paywalls analytics/insights/goals/segment-leaderboards while keeping recording + community free, and sells a **4-person Family plan** (US$139.99/yr) — a group-packaging model that maps directly onto circles.
- **iOS compliance (US)**: post Ninth Circuit ruling (Dec 2025, Epic v. Apple), apps may link out to web/Stripe checkout without Apple blocking; zero-commission on linked-out purchases is under remand + SCOTUS cert (June 2026) — treat web-checkout steering as favorable-but-unstable; native IAP must remain the primary iOS path.
- Refuted/unverified (do not use): Adapty's 9.5% install→trial / 42.2% trial→paid H&F figures and its renewal-decay curve (refuted 0-3). Store-fee/RevenueCat-pricing specifics were gap-filled by a follow-up pass (see Fee inputs).

## The Offering (recommendation)

**Two tiers: Free + FitCircle Pro.** One subscription group, no mid-tier — complexity kills conversion at this scale. (Teams/Coach B2B and a circle-level "Family plan" analog are explicit later expansions once Pro is proven; the calculator models the Family option.)

### Pricing
| Plan | Price | Rationale |
|---|---|---|
| Pro Monthly | **$9.99/mo** | Category anchor price; median H&F monthly is $9.99. Exists mostly to anchor annual. |
| Pro Annual | **$59.99/yr** ($5/mo equivalent, 50% off) — **hero plan, pre-selected** | Annual-first: 67–68% of category volume, growing share, 4–4.5× LTV vs cheap plans. $59.99 sits above the indie median ($39.94) but below Strava ($79.99 US) — right for a social+AI app without Strava's brand. |
| Pro Lifetime | **$149.99 one-time, launch-window only** | Early-adopter cash + evangelists; time-boxed so it doesn't cannibalize annual. |

**Limited-time discount capability (user-confirmed requirement)** — list prices stay $9.99/$59.99; promos discount the *first period* and renew at full price, displayed as "~~$59.99~~ $39.99 for your first year":
- iOS: App Store **introductory offers** on the subscription products (e.g., $39.99 pay-up-front first year); store-native, per-user once.
- Android: Play **offers** on the base plans (time-boxed discount phase, eligibility rules) — designed for exactly this.
- Web: discounted Stripe Price/coupon on Checkout (`allow_promotion_codes` already planned) with strikethrough display.
- Orchestration: **RevenueCat Offerings** — a `launch` offering carrying the discounted packages; switching the default offering remotely starts/ends a promo with **no app release**. Paywalls must render whatever the current offering serves (anchor price + discount from package/`Offering.metadata`), never hardcode prices. Win-back promotional offers (lapsed users) use the same machinery later.

Competitor annuals (US, verified): MyFitnessPal Premium $79.99 (Premium+ $99.99), MacroFactor $71.99, Fitbod $95.99, Lose It! $39.99, Hevy Pro ~$24–40, Strava $79.99 — **$59.99 is mid-pack**: premium enough for 4×-LTV economics, cheap enough to be the "whole circle upgrades" impulse price.

US-first; use App Store/Play automated regional price tiers + Stripe Adaptive Pricing equivalents from day 1. Revisit PPP-tuning for India/SEA/LATAM post-launch.

### Trial
**7-day free trial on both plans, presented at the end of Day-0 onboarding** (82% of category trial starts are Day 0), **plus contextual re-presentation** at value moments. Rationale for 7 over 17–32 days despite higher per-trial conversion of long trials: pre-launch we need fast learning cycles and January-campaign compression; 7 days spans one full circle week (the aha loop). A/B trial length via RevenueCat Experiments once volume exists — pricing/trial is the single highest-leverage test.
**Circle-linked trial twist** (differentiator): joining your first circle grants the 7-day Pro trial if not yet used — ties the trial to the social aha moment instead of a cold paywall.

### Free vs Pro gating
Rule: **if gating it would reduce invites or circle formation, it stays free. Gate depth, status, and marginal-cost AI.** (Strava-validated: community free, analytics/insights paid.)

**Free forever (the growth engine):** join circles (unlimited), create up to 2 active circles, leaderboards & progress-%, circle chat, high-fives, reactions, group meals, share cards (default themes), invites/deep links, daily check-ins, streaks + XP-earned shields, momentum, daily challenge, manual food/exercise/beverage logging, barcode scan, health sync, basic stats (last 14 days), **5 AI food parses/day** (photo+voice+item combined), **5 Fitzy coach messages/day** — free users must taste the AI wow.

**Pro ($ moments):**
| Category | Free | Pro |
|---|---|---|
| AI food logging | 5 parses/day | Unlimited (high abuse cap ~100/day) |
| Fitzy AI coach | 5 messages/day | Unlimited + weekly AI insight cards |
| Body composition | logging only | photo scan, trends, segmental, coach (already gated!) |
| History & analytics | 14 days | Unlimited history, trends, cross-signal insights, export |
| Circles | create 2 active | Unlimited + custom challenge templates + circle branding |
| Streaks | shields via XP | Bonus shields / streak insurance |
| Ads | shown | **Ad-free** |
| Status | — | Pro badge, custom share-card themes, profile flair |

Paywall style: **soft/freemium with metered AI** (hard paywalls convert installs better but kill the social K-factor this app's GTM depends on). Contextual triggers: AI limit hit (primary), Fitzy limit, >14-day history scroll, 3rd circle creation, "remove ads" tap, body-comp locked features, milestone celebrations. Annual pre-selected, "$5/mo billed yearly" framing, restore + manage links everywhere required.

### Platform mechanics
- **iOS**: StoreKit 2 via RevenueCat. Primary path = native IAP. (External-link steering legally available in US but unstable — revisit post-SCOTUS; do not build the model on it.)
- **Android**: Play Billing via RevenueCat (base plan + 7-day free-trial offer).
- **Web**: Stripe Checkout (no store cut — push acquisition traffic here per GTM) unified into RevenueCat entitlements.
- **Cross-platform honor**: purchases from any platform unlock everywhere (Apple guideline 3.1.3(b) multiplatform services allows honoring web purchases in-app as long as iOS also offers IAP). RevenueCat `app_user_id` = our backend user id; backend webhook → `profiles.subscription_tier` → existing `EntitlementService` → all clients.

### Why RevenueCat (build-vs-buy)
One entitlement API + receipt validation + App Store Server Notifications V2 / Play RTDN handling + Stripe web support + paywall A/B Experiments; free until $2.5k MTR then ~1% — at our scale that's cheaper than the eng-months (and security risk) of hand-rolling three billing stacks + reconciliation. Escape hatch: entitlements land in OUR `profiles` table via webhook, so swapping RevenueCat out later doesn't touch clients.

## Business model calculator

Deliverable: **interactive single-file HTML tool** (published as an Artifact; works offline, no deps) + the same model as a downloadable **.xlsx** with formulas for investor/spreadsheet use.

Inputs (all adjustable sliders/fields, pre-filled with research-verified defaults):
- **Growth**: monthly installs (organic + paid), K-factor (0.4→0.7), MAU retention curve (D1 40% / D7 20% / D30 10% gates from GTM plan), DAU/MAU ratio.
- **Funnel**: install→trial (2–6.9%), trial→paid (37.7%), direct free→paid drip, monthly/annual mix (32/68), platform mix (iOS/Android/Web).
- **Pricing**: monthly $9.99, annual $59.99, lifetime take-rate; regional ARPU haircut; **promo modeling** — first-period discount price (e.g. $39.99 launch), % of cohort buying at promo, renewal at full price.
- **Churn**: monthly-plan churn %, annual renewal rate, trial-cancel timing.
- **Costs/fees** (verified Aug 2026 defaults): Apple 15% (Small Business Program, <$1M net; else 30% yr-1 → 15% after); Google Play post-June-2026 US/UK/EEA structure — subscriptions 10% service fee + 5% Play-billing fee ≈ **15% effective** (external checkout: 10% + processor); Stripe 2.9% + 30¢ + 0.5% Billing (+0.5% Stripe Tax opt.); RevenueCat free to $2.5k MTR then **1% of MTR**; AI cost per free/Pro user (parses/day × model cost); ads eCPM + impressions/DAU for free-tier ad revenue.
- Outputs: MRR/ARR over 24 months, subscribers by plan/platform, blended ARPU, LTV (per plan), LTV:CAC given CPI inputs, payback months, AI gross-margin check, scenario presets (Conservative / Base / GTM-target "10K users, $50K MRR in 90 days" feasibility check).

## Platform execution plans

### A. Backend + Web (`FitCircle/`) — ~2 weeks, ships first (everything depends on it)

**Architecture**: RevenueCat (RC) is the subscription source of truth; **our DB is the entitlement cache**; exactly one writer of subscription state: the RC webhook handler. Web billing = **direct Stripe Checkout + RC's Stripe integration** (not RC Web Billing) — our Stripe webhook forwards the subscription id to RC (`POST /v1/receipts`, `X-Platform: stripe`), then RC tracks the Stripe lifecycle and emits the same events as the stores. RC `app_user_id` = `profiles.id` always. RC entitlement `pro` → `profiles.subscription_tier='premium'` (existing `normalizeTier` already collapses this — no client contract change).

**Phase 0 (0.5–1d, dashboards)**: RC project (entitlement `pro`; products `pro_monthly_999` / `pro_annual_5999` / `pro_lifetime_149` across App Store/Play/Stripe, 7-day trials; `default` + `launch` offerings — the latter carrying first-period-discount packages for time-boxed promos, switched remotely); Stripe products incl. discounted launch Price + Customer Portal; env vars (`STRIPE_*` already placeholdered in `.env.example`, add `STRIPE_PRICE_*`, `REVENUECAT_WEBHOOK_AUTH_TOKEN`, `REVENUECAT_SECRET_API_KEY`); `npm install stripe`.

**Phase 1 (2–3d)**: Migration `075_subscription_infrastructure.sql` — add `profiles.subscription_platform/product_id/will_renew/synced_at`; `subscription_events` table (webhook idempotency + audit, service-role only); `fitzy_message_log` (mirrors proven `nutrition_parse_log` insert-then-count pattern — CLAUDE.md bans stored procs, so no upsert counter); seed 8 new `feature_gates` rows **dark** (`required_tier='free'`): `food_ai_unlimited, fitzy_unlimited, history_extended, circles_unlimited, ads_removed, data_export, share_themes_custom, streak_shields_bonus`. New `lib/services/subscription-service.ts` with the full RC event mapping (INITIAL_PURCHASE/RENEWAL/CANCELLATION/UNCANCELLATION/EXPIRATION/BILLING_ISSUE→past_due grace/PRODUCT_CHANGE/NON_RENEWING_PURCHASE lifetime/TRANSFER), stale-event guard via `subscription_synced_at`. New route `api/webhooks/revenuecat/route.ts` (timing-safe auth header check, 500-on-missing-secret, sandbox filtering).

**Phase 2 (1.5–2d)**: `api/billing/checkout/route.ts` (Stripe Checkout session, `trial_period_days: 7`, `metadata.app_user_id`); `api/webhooks/stripe/route.ts` (signature-verified; only saves `stripe_customer_id` + forwards receipt to RC — no entitlement writes); `api/billing/portal/route.ts` (Stripe portal, or "manage in App Store/Play" for store subscribers); `api/entitlements/route.ts` (web-session twin of `/api/mobile/entitlements`); fix `/api/subscriptions/check-on-login` to accept `trialing/past_due`; daily reconcile cron (`api/cron/subscriptions/reconcile`) re-syncing stale premium profiles from RC REST — the missed-webhook safety net.

**Phase 3 (2–3d)**: `lib/config/tier-limits.ts` (free: 5 AI parses/day, 5 Fitzy msgs/day, 2 body-comp scans, 2 created circles, 14-day history; premium: abuse ceilings 100/200/10/∞/∞). New `usage-service.ts` (`checkQuota`/`recordUse`, throws `UPGRADE_REQUIRED` ≠ `RateLimited`). Wire: 3 cap call-sites in `nutrition-intelligence-service.ts`; Fitzy `chat()` metering (insert-before-model-call closes the race); circle-creation cap in circles routes; history **clamp** (never 403 — return `meta.clamped`) in stats/insights routes; parse routes return 402/429 with `code: 'UPGRADE_REQUIRED', details: {used, limit, feature}` so clients render contextual paywalls. Extend `EntitlementService.getEntitlements` payload additively with `limits` + `subscription {status, platform, expiresAt, willRenew}`. GDPR takeout stays free (legal); only convenience export is gated.

**Phase 4 (2–3d)**: Web UX — `/upgrade` (pricing page, annual pre-selected), `/upgrade/success` (poll entitlements until premium), `/settings/billing`, `components/billing/*` (`PricingCards`, `ProBadge`, reusable `UpgradePrompt` rendered on any `UPGRADE_REQUIRED` response), `hooks/useEntitlements.ts`. Client state is cosmetic; server enforces.

**Phase 5 (1–2d)**: Vitest unit tests for event mapping/quotas; `stripe listen` E2E; RC sandbox purchases + test-event replay (idempotency assert); edge cases: cancel-during-trial, refund, grace recovery, monthly→annual, cross-platform (iOS purchase → web shows premium; web purchase → iOS sees it), TRANSFER. **Launch switch = migration `077_enable_pro_gates.sql`** flipping the 8 gates to `premium` — ships last; until then behavior is byte-identical to today (regression guard).

Risks: RC one-time-purchase support via Stripe integration (verify Phase 0); webhook ordering (mitigated: synced_at guard + reconcile cron).

### B. iOS (`FitCircle-iOS/`) — ~2.5–3 weeks, runs parallel to backend

Supersedes the stale `FitCircle-iOS/docs/SUBSCRIPTIONS_IMPLEMENTATION.md` (wrong tiers, wrong bundle id — actual is `com.inov8rlabs.FitCircle` — and a client-side `EntitlementChecker` that contradicts the server-driven contract; do not build it). Two-plane model: **RevenueCat `CustomerInfo` = purchase truth (ads, paywall UI, instant/offline); server `/api/mobile/entitlements` = feature-gate truth** (unchanged fail-open contract).

- **P0 (1d, parallel)**: App Store Connect — Paid Apps Agreement first; subscription group with `com.inov8rlabs.fitcircle.pro.monthly/.annual` (7-day intro trials, same rank), `.pro.lifetime` as non-consumable; Family Sharing OFF; App Store Server Notifications V2 → RevenueCat URL; IAP API key to RC; privacy labels + review screenshot + notes.
- **P1 (2d)**: purchases-ios 5.x via SPM (RevenueCat lib only, not RevenueCatUI). `Config.revenueCatAPIKey` (sentryDSN pattern). **`Purchases.configure` in `AppDelegate` BEFORE `initializeAds()`** (AdsEligibility lazily resolves the entitlements dependency). Identity: `logIn/logOut` at the 5 auth transitions in `AppFeature.swift` (login/signup/onboarding auto-login/cold-start restore/logout). New `Core/Services/PurchasesClient.swift` — struct-of-closures TCA dependency mirroring `APIClient`, domain models in `Core/Models/Subscription.swift` (`PlanOption`, `ProStatus`, `PaywallContext`). Local `FitCircle.storekit` config file.
- **P2 (4d)**: **native SwiftUI paywall** (not RevenueCatUI — glass design system; Experiments still work since they operate at the offering level and we render `offerings().current` + `Offering.metadata` copy). `Features/Paywall/PaywallFeature.swift` (TCA, annual pre-selected, cancel-is-silent), `PaywallView` (Restore button = App Review 3.1.1, offer-code redemption, auto-renew disclosure + terms/privacy links = 3.1.2 — **pages must exist on the web, launch blocker**), `ManageSubscriptionFeature` (grace-period banner → `managementURL`, crossgrade "changes at next renewal" copy), Settings row via the existing `@Presents` pattern; global presentation via `AppFeature.showPaywall(context)` + a `PaywallPresenter` subject for non-TCA views.
- **P3 (2d)**: `RevenueCatEntitlementsProvider` (bridges `customerInfoStream`) replaces `FreeTierEntitlements` via the one-line `liveValue` swap in `Core/Ads/EntitlementsProvider.swift:40` — ads flip off mid-session with zero other changes. Post-purchase: optimistic ads flip + poll `EntitlementsService.refresh(force:)` (2s/5s/10s) to absorb webhook latency. `PremiumLockCard` gets an "Upgrade to Pro" button (replaces "Coming to your plan soon"); wire paywall CTAs into the 4 existing `PREMIUM_REQUIRED` handlers in body-comp features.
- **P4 (2–3d)**: contextual triggers — AI-limit 429 in `MealAnalysisFeature`/`VoiceLogFeature`/`BodyCompScanFeature` → `.aiLimit` paywall; >14-day history in `HistoricalDataFeature`/`StreakHistoryFeature`/`BodyCompTrendsFeature`; 3rd-circle in `CirclesListFeature.showCreateCircle`; "Remove ads" chip on banner/native ad views; milestone celebration upsell (once per milestone value, UserDefaults-capped).
- **P5 (3d + review)**: TestStore unit tests; StoreKit-config Transaction Manager tests (refund, billing retry/grace, expiry → ads return); sandbox (trial conversion, restore on reinstall, crossgrade, lifetime hides sub UI, identity handoff no-bleed, airplane-mode pro keeps ad-free); TestFlight E2E through RC webhooks → server tier flip.

### C. Android (`FitCircle-Android/`) — ~2.5–3.5 weeks

Supersedes stale `FitCircle-Android/docs/SUBSCRIPTIONS_IMPLEMENTATION.md` (wrong tiers; no `libs.versions.toml` exists — add deps directly in `app/build.gradle.kts`; RC SDK 8.x not 7.x; configure in `FitCircleApplication.onCreate()`, not a Hilt `@Provides`).

**Found bug to fix while wiring**: `core/ads/EntitlementsProvider.kt` exposes `isPremium` as a **static Boolean** — if premium flips mid-session, ads never stop until restart. Interface becomes `StateFlow<Boolean>`; `AdsEligibility` combines three flows.

- **P0 (~1d + ops) — Android launch blockers that also gate billing QA**: release signing (`keystore.properties` — unsigned release builds today; Play license testing needs a signed AAB on a track), replace sample AdMob app id in `AndroidManifest.xml:149` + sample ad-unit ids in `AdConfiguration.kt`, Play Console app record + merchant account.
- **P1 (2–3d)**: `com.revenuecat.purchases:purchases:8.x` (bundles Billing Library 7); `REVENUECAT_API_KEY` BuildConfig field (inert-when-blank, mirrors `Monitoring.start`). New `core/billing/BillingRepository.kt` (`customerInfo`/`isPro` StateFlows, offerings, purchase with sealed errors incl. `PaymentPending`, restore, logIn/logOut) + `BillingModule.kt` Hilt. Configure in `FitCircleApplication.onCreate()` with `appUserID = tokenManager.getUserId()`; `logIn` from the two auth call sites (`LoginViewModel`/`RegistrationViewModel`), `logOut` at both `SessionManager` choke points (where `entitlementsRepository.clear()` already runs).
- **P2 (1–2d)**: reactive `EntitlementsProvider` + `RevenueCatEntitlementsProvider`; swap the Hilt `@Binds` in `AdsModule.kt` (the module comment says this was the intent). Optimistic unlock on purchase + `entitlementsRepository.refresh()` (immediate + ~10s retry for webhook latency). Feature gates stay 100% server-driven.
- **P3 (3–5d)**: **custom Compose paywall** (matches glass design system; RC Offerings as package source, not hardcoded ids). `features/paywall/` — `PaywallViewModel` (MVI, mirrors `CirclesListViewModel` shape), `PaywallScreen` (annual pre-selected, trial badge from `subscriptionOptions` free phase, Restore, Play-required disclosures: prices/periods, trial→paid conversion, cancel-anytime, ToS+Privacy links). New `Route.Paywall` in `NavGraph.kt` + registration in `MainScreen.kt`; Settings ACCOUNT row → paywall or `CustomerInfo.managementURL`.
- **P4 (2–3d)**: triggers — plumb the currently-dropped `rateLimited` flag through `MealAnalysisManager`/`NutritionConfirmViewModel` so the 429 saved-unparsed banner adds "Upgrade for unlimited AI logging"; history footers via upgraded `PremiumLockCard(onUpgradeClick)`; 3rd-circle intercept in `CirclesListViewModel`; "Remove ads" affordance under dashboard native-ad slot; milestone upsell frequency-capped via the `AdFrequencyManager` DataStore pattern.
- **P5 (1–2d)**: Play Console — subscription `pro` with base plans `pro-monthly`/`pro-annual` + `pro-annual-free-trial` offer (7-day, never-had eligibility); `pro_lifetime` INAPP; **RTDN via Pub/Sub → RevenueCat (required, not optional** — without it grace/hold/refund lag hours); license testers; data safety form (purchase history).
- **P6 (3–5d)**: unit tests (mockk/turbine: `isPro` mapping incl. lifetime, mid-session ads flip regression, paywall MVI paths, rateLimited plumbing); device matrix on internal track (pending purchases, grace, account hold + "fix payment" deep link, resubscribe, monthly↔annual proration — `IMMEDIATE_WITH_TIME_PRORATION` up / `DEFERRED` down, cross-platform iOS→Android entitlement, logout/login no-bleed, offline subscriber).

### Rollout sequencing (cross-platform)

1. **Week 1–2**: Backend Phases 0–3 + both mobile P0/P1 in parallel (store/dashboard setup has external latency — start day 1).
2. **Week 2–4**: Mobile paywalls + triggers; backend web UX; continuous sandbox E2E against staging webhook.
3. **Week 4–5**: QA matrices; TestFlight/internal-track soft launch; **flip migration 077** (gates → premium) only when trial→paid loop is verified end-to-end on all three platforms.
4. **Post-launch**: RevenueCat Experiments on price/trial-length/copy; time-boxed lifetime offer; win-back offers; then evaluate circle-level "Family plan" and Teams/Coach B2B.
5. **Business calculator** (can ship immediately, independent of code): interactive HTML artifact + .xlsx as specced above.

## Verification: detailed test & eval plan

### 1. Backend unit tests (Vitest, colocated `__tests__`, run in CI on every PR)

**`subscription-service` — RC event mapping table-driven suite** (one test per row of the event-mapping table, asserting exact `profiles` mutations + `payments` rows):
- `INITIAL_PURCHASE` trial → `tier=premium, status=trialing, will_renew=true`, $0 payments row; non-trial → `active` + priced row.
- `INITIAL_PURCHASE` with **intro/launch discount price** → payments row records the discounted amount, not list price.
- `RENEWAL` after intro period → payments row at **full price** (promo renewal correctness).
- `CANCELLATION(UNSUBSCRIBE)` → tier stays premium, only `will_renew=false` (access-to-period-end).
- `CANCELLATION(CUSTOMER_SUPPORT/refund)` → immediate `free/cancelled` + refund row.
- `UNCANCELLATION`, `EXPIRATION` → free, `BILLING_ISSUE` → `past_due` with grace expiry, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` (lifetime → `expires_at=NULL`), `TRANSFER` (from→free, to→recompute).
- **Idempotency**: same event id twice → second is a no-op (`already_processed`), exactly one payments row.
- **Out-of-order**: `RENEWAL(t2)` then `CANCELLATION(t1)` → stale t1 event skipped via `subscription_synced_at`.
- **Hostile inputs**: unknown `app_user_id` (non-UUID / no matching profile) → logged skip, 200, no writes; `SANDBOX` event in prod → recorded but not applied; missing auth header → 401; wrong token → 401 (timing-safe); env secret unset → 500 (fail closed).

**`usage-service` quota boundaries**:
- Free user: parses 1–5 allowed, 6th → `UPGRADE_REQUIRED` with `{used:5, limit:5, feature:'food_ai_unlimited'}`; Fitzy msg 6 same; resets at midnight UTC boundary (test day rollover).
- Premium: 100th parse allowed, 101st → `RateLimited` (abuse ceiling ≠ upgrade prompt — assert the two error types never cross).
- Gates dark (`required_tier='free'`) → everyone gets premium limits (pre-077 behavior byte-identical to today: regression guard test pinning current 25/day behavior).
- Race: two concurrent parse requests at count=4 → at most one over-limit grant (document accepted tolerance of insert-then-count).

**`entitlement-service` extension**: payload additivity snapshot test — existing consumers' fields unchanged; new `limits`/`subscription` fields present; `normalizeTier('enterprise') → premium`; fail-open when a feature key has no gate row.

**Stripe webhook route**: signature verification rejects tampered body; `checkout.session.completed` forwards correct `fetch_token` (subscription id vs session id for lifetime) to RC; RC-forward failure → 500 (Stripe retries); duplicate Stripe event id → no double-forward.

### 2. Backend integration / E2E (staging + Stripe test mode + RC sandbox)

- `stripe listen --forward-to localhost:3000/api/webhooks/stripe`; complete real test Checkouts: monthly-with-trial, annual-with-trial, **annual at launch-discount price**, lifetime one-time. Assert: RC dashboard shows the purchase → RC webhook fires → profile flips → `/api/entitlements` and `/api/mobile/entitlements` both show `premium` with correct `limits`.
- RC "send test event" against a preview deployment; replay the same delivered event → idempotent no-op.
- Reconcile cron: manually corrupt a profile (`premium` with `expires_at` 2 days past) → cron restores truth from RC REST; log line counts corrected users.
- Stripe Customer Portal round-trip: cancel → RC `CANCELLATION` → `will_renew=false`; resubscribe → `UNCANCELLATION`.

### 3. iOS test matrix

**Unit (TestStore + stub `PurchasesClient`)**: paywall load/select/purchase-success/user-cancel-silent/failure/restore-empty/restore-success; reconciliation polling stops early on `tier!=free`; `ManageSubscription` grace-banner state; `AdsEligibilityTests` extended with a flipping `isPremiumPublisher` fake (ads die mid-session on purchase — regression for the seam).
**StoreKit config (local, Xcode Transaction Manager)**: buy monthly/annual; trial applies once per Apple ID; **intro-offer price shows on annual and renews at list**; refund → entitlement drops; billing-retry/grace → Manage screen banner; expiry → ads return.
**Sandbox (accelerated renewals)**: trial→paid conversion; cancel-during-trial → access till day 7 → free; restore after reinstall + on second device; monthly→annual crossgrade (assert "changes at next renewal" copy matches actual behavior); offer-code redemption sheet; lifetime purchase hides subscription plans; logout/login → no entitlement bleed across accounts; airplane mode → cached CustomerInfo keeps Pro ad-free.
**TestFlight E2E**: purchase → App Store Server Notification → RC → backend webhook → `profiles` flip → foreground refresh unlocks server gates. Time the webhook-latency window; assert optimistic ads-off happens instantly regardless.
**App Review pre-flight checklist as tests**: Restore button reachable from paywall; terms/privacy links resolve (HTTP 200); auto-renew disclosure text present; paywall screenshot uploaded.

### 4. Android test matrix

**Unit (mockk/turbine)**: `BillingRepository` CustomerInfo→`isPro` (incl. lifetime INAPP); reactive `EntitlementsProvider` mid-session flip kills ads (regression for the static-snapshot bug); `PaywallViewModel` purchase/cancel/**pending**/restore; `rateLimited` flag plumbing through `MealAnalysisManager`/`NutritionConfirmViewModel` (was previously dropped — pin it).
**Device, license testers, internal track (5-min renewals)**: trial start → cancel → expiry; **launch offer**: discounted first phase → renews at base-plan price; pending/slow-card purchase shows "pending", grants only on entitlement-active; grace period (declined card) → Pro retained + warning; **account hold** → revoked + "fix payment" deep link → resubscribe restores; monthly↔annual proration (`IMMEDIATE_WITH_TIME_PRORATION` up, `DEFERRED` down); restore on second device; logout/login no-bleed; offline subscriber keeps Pro (RC disk cache), offline free user still gated by consent/flag.
**RTDN verification**: kill the app, refund from Play Console → backend flips within minutes (proves Pub/Sub→RC→webhook path, not client-driven).

### 5. Cross-platform acceptance suite (the core promise — run before 077 flip, all must pass)

For each origin platform {iOS, Android, Web} × each observer platform: subscribe on origin → within webhook latency all observers show Pro (ads off, AI unlimited, >14-day history, 3rd circle allowed, Pro badge); cancel on origin → `will_renew=false` everywhere, access to period end, then free everywhere; refund → immediate downgrade everywhere. Plus: platform-switch guard — already-Pro user opening a paywall sees "you're already Pro" (and web checkout 409s); `TRANSFER` (same store account, second app account) resolves to exactly one Pro profile.

### 6. Security tests

- Client-write attempts as `authenticated` role against `payments`, `subscription_events`, `fitzy_message_log` → all rejected (RLS/REVOKE verified in staging, not just migration text).
- Forged RC webhook (no/wrong auth), forged Stripe signature, replayed old event, sandbox-in-prod event → no state change; all four logged.
- Tampered client: call gated endpoints (`body-comp/photo-parse`, 6th food parse, Fitzy msg 6, 3rd-circle create) with a free-tier JWT → 403/402 server-side regardless of any client state.
- Entitlement never derived from client input: grep-level CI check that no route reads tier from request body/headers.

### 7. Analytics & business evals (instrumentation shipped with the feature, reviewed weekly post-launch)

Events (Amplitude, one per RC webhook type + client paywall events): `paywall_viewed(source, offering)`, `trial_started(plan, platform, offering)`, `trial_converted/cancelled`, `subscription_renewed/cancelled/expired`, `upgrade_required_hit(feature, used, limit)`, `promo_purchase(promo_id, discount_price)`.
Funnel dashboards + targets (from GTM/monetization docs + verified benchmarks): install→trial ≥ 2% (gate for paid UA; category median 6.9%); trial→paid ≥ 35–40% (category median 37.7%); annual share of new subs ≥ 60%; monthly churn < 7%; per-source paywall conversion (aiLimit expected highest); AI gross margin per user (model cost vs quota) — alert if free-tier AI cost/user/day exceeds modeled input; ad revenue per free DAU. Weekly eval vs the calculator's Base scenario; recalibrate calculator inputs with observed cohort data monthly.
Guardrail metrics (detect over-gating damage): K-factor ≥ 0.4, % new users joining/creating a circle in week 1 ≥ 35%, D1/D7/D30 ≥ 40/20/10% — if these drop post-077, loosen free-tier limits before touching paywall placement.

### 8. Calculator validation

Unit-check the model in-page (assertions rendered in a debug panel): revenue identity (MRR = Σ plan×subs×(1−fees)); LTV closed-form vs 36-month simulation within 1%; fee toggles reproduce known cases (e.g. $59.99 annual via Apple SBP → $50.99 net; via Stripe → ~$57.94 − Billing/Tax fees); promo cohort: first-year at $39.99 then renewals at $59.99 flows through LTV correctly; GTM-target feasibility check ("10K users/$50K MRR in 90 days") flags the implied conversion rates it requires vs benchmarks.
