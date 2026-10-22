# FitCircle Test Plan

Status: v1, 2026-10-21. Owner: Ani. This is the canonical plan for **all three codebases**:

| Repo | Stack | Test entrypoint |
|---|---|---|
| `Inov8rlabs/FitCircle` (this repo, `apps/web`) | Next.js 15 on Vercel, Supabase | `scripts/ci/run-tests.sh unit\|smoke` |
| `Inov8rlabs/FitCircle-iOS` | SwiftUI + TCA, iOS 17.0+ | `scripts/ci/run-tests.sh unit\|snapshot\|maestro-smoke\|maestro-regression` |
| `Inov8rlabs/Fitcircle-Android` | Compose + Hilt, API 26–37 | `scripts/ci/run-tests.sh unit\|screenshot\|compose-ui\|maestro-smoke\|maestro-regression` |

The always-on Mac runner (`qa/ci-runner/`, §11) calls those entrypoints. Each app repo links back here from `docs/TESTING.md`.

---

## 1. Principles

1. **Test where the risk is.** Money, identity, and the daily habit loop (log, then streak) get the deepest coverage. Cosmetic screens get snapshots and an exploratory pass.
2. **Fast layers gate, slow layers sample.** Unit, snapshot, and screenshot tests run on every commit. Maestro smoke runs on every commit. The full regression runs nightly at 02:00. Real devices run pre-release.
3. **One end-to-end tool for both platforms: Maestro.** Both apps use the same accessibility identifiers. iOS uses `accessibilityIdentifier`; Android uses `testTag` with `testTagsAsResourceId`. The same flow names exist in `maestro/` in each app repo.
4. **Production is tested only with the dedicated QA account.** The App Review demo account `fitcircle.user@gmail.com` is never used by automation (§5).
5. **A flaky test is a failing test.** It gets quarantined (tag `quarantine`, excluded from gates) within one day and fixed or deleted within a week.

---

## 2. Risk-based scope

Score: **I**mpact × **L**ikelihood, each 1–3. Risk ≥ 6 is P0 (must have automated coverage on every commit plus a manual pass before store submission). 3–4 is P1 (automated nightly plus a manual pass at release). Below that is P2 (exploratory only).

| Area | What can go wrong | I | L | Risk | Unit / contract | Snapshot / screenshot | Maestro | Manual |
|---|---|---|---|---|---|---|---|---|
| **Auth** (email, Apple, Google, token refresh) | can't sign in; refresh loop logs users out; wrong user after switch | 3 | 2 | **6 P0** | LoginInputTests, TokenRefresh, BE auth route tests | Login (4 sizes and XXL text) | smoke `01_launch_sign_in`, `99_sign_out` | Apple and Google on device, expired refresh token |
| **Account switching** | previous user's cache shown (incident 2026-09-15, URLCache and max-age) | 3 | 2 | **6 P0** | BE: `no-store` on every `/api` route (prod smoke asserts this) | — | regression `account_switch` (sign out, then sign in as QA user B) | sign out, then sign in as a different user; check profile, food log, circles, Fitzy memory |
| **Food logging** text, photo, voice, barcode; **offline and online** | duplicate or lost entries; sync race on iOS's local-first outbox; AI estimate wrong or timing out | 3 | 3 | **9 P0** | FoodLogSyncContractTests, FoodTextEstimateTests, NotesToItems, BE sync contract (`FOOD_LOG_SYNC_CONTRACT.md`) | entry row, nutrition confirm | smoke `03_meal_text` | airplane mode: log 3 meals, relaunch, reconnect, verify one copy each; photo over 4.5 MB (Android) |
| **Water logging** offline and online, undo | double count; undo deletes the wrong entry; offline pending state stuck | 3 | 3 | **9 P0** | HydrationFeatureTests, FoodLogServiceWaterTests | Hydration empty / partial / goal / imperial | smoke `02_water_log_undo` | rapid taps x5 offline, then reconnect |
| **Circles** create, join by code, chat, meal posts | can't join; chat not realtime; posts from blocked users | 3 | 2 | **6 P0** | SafetyJoinByCode, ChatTimelineLayout, CircleMealPost (BE) | circle row and header | smoke `04_circle_open` | two devices: realtime chat, image post, report or block |
| **Streaks and saves** (shields, auto-claim) | streak lost across a timezone or day boundary; shield double-spend | 3 | 2 | **6 P0** | StreakShieldUpsellTests, BE streak claim policy and boundary-day tests | streak card | regression `streak_visible` | device clock across midnight in UTC−8 and UTC+5:30 |
| **Paywall and purchases** (RevenueCat, StoreKit and Play Billing sandbox, Stripe web) | can't buy; entitlement not granted; restore fails; wrong price | 3 | 2 | **6 P0** | PaywallFeatureTests, PaywallRetry, ManageSubscription, BE entitlements | paywall with plans loaded | smoke `06_paywall_open_close` | sandbox buy monthly, annual, lifetime; restore; cancel; Play license tester; Stripe test card on web |
| **Referrals** (Better Together) | invitee not credited; banked days wrong | 2 | 2 | 4 P1 | ReferralsTests, BE referrals | invite sheet | regression `referral_invite_sheet` | invite link → fresh install → first activity qualifies |
| **Campaigns** (seasonal circle, daily calendar, spotlight) | wrong dates; door opens early; unknown template crashes decoding | 2 | 2 | 4 P1 | CampaignsTests, CampaignInfoFeatureTests (tolerant decoding) | campaign home card | regression `campaign_card` | `-CampaignPreview` launch-arg matrix (§8.5) |
| **Fitzy** (AI coach, streaming, memory, plans, quota) | streaming hangs; quota not enforced; unsafe advice; consent bypass | 3 | 2 | **6 P0** | FitzyV2Tests, AIConsentGate, BE `fitzy:eval` (live model, see note) | Fitzy free quota reached | smoke `05_fitzy_open` | 10-message conversation, offline mid-stream, Pro vs free |
| **Ads and consent** (AdMob, UMP, ATT) | ads shown to Pro users; no consent in EEA; ATT before UMP | 3 | 2 | **6 P0** | AdsEligibility, AdFrequencyManager, AnalyticsPrivacy | — | — | EEA VPN fresh install: UMP shown then ATT; Pro user sees no ads |
| **Push** (APNs/FCM, quiet hours, cap of 3 per day) | no push; push during quiet hours; deep link from push wrong | 2 | 2 | 4 P1 | BE push cap and quiet-hours tests | — | — | real device: meal reminder, circle post, tap opens the right screen |
| **Deep links** (`fitcircle://dashboard, checkin, circle/<id>, leaderboard/<id>, profile, goals, streaks`, universal links `/i/<code>`) | wrong screen; crash on unknown host; cold vs warm start differ | 2 | 2 | 4 P1 | DeepLinkCoordinator tests | — | regression `deep_links` (`openLink`) | cold start from Notes and Messages, logged out → after login lands correctly |
| **Health data** (HealthKit, Health Connect) | steps double counted; weight write-back loops | 2 | 2 | 4 P1 | DailyTracking, workout-claim-policy (BE) | — | — | grant, deny, revoke; 7-day sync |
| **Apple surfaces (in progress):** widgets, Live Activities, Controls, Siri/App Intents, rich notifications, Watch | stale timeline; activity never ends; intent runs signed out; Watch out of sync | 2 | 3 | **6 P0 once shipped** | timeline provider and intent unit tests (each surface ships with them) | `WidgetPreviews.swift` snapshots for every family (small, medium, lock-screen) | — (Maestro can't drive SpringBoard reliably) | §8.11 checklist on device |
| **Account deletion, export, GDPR** | data left behind; export missing tables | 3 | 1 | 3 P1 | BE deletion tests | — | — | delete the throwaway account and verify rows are gone |
| **Onboarding** | stuck step; skip loses data | 2 | 2 | 4 P1 | OnboardingQuestionnaire, OnboardingSkip | onboarding steps | regression `onboarding_fresh_user` (throwaway signup) | fresh install, every path |
| **Web app** (apps/web) | landing or checkout broken | 2 | 1 | 2 P2 | vitest (2,100+) | — | Playwright `e2e/` (existing) | Stripe checkout once per release |

Note on LLM features: mocked-model tests have hidden real bugs before. Fitzy and food-AI changes must also pass `npm run fitzy:eval` (live model) and the nutrition eval harness before merge.

---

## 3. Test pyramid per platform

```
                 ┌──────────────┐  manual exploratory + real devices (pre-release)
                 │  Maestro E2E │  smoke 7 flows / commit, regression nightly
             ┌───┴──────────────┴───┐
             │ snapshot / screenshot│  iOS swift-snapshot-testing · Android Roborazzi
         ┌───┴──────────────────────┴───┐
         │ unit + reducer + contract    │  XCTest/TCA TestStore · JUnit/Robolectric · vitest
         └──────────────────────────────┘
```

| Layer | iOS | Android | Backend |
|---|---|---|---|
| Unit / logic | XCTest + TCA `TestStore` (`FitCircleTests`, 50 files) | JUnit4 + MockK + Turbine + Robolectric (`app/src/test`, 1,250+ tests) | vitest (2,100+ tests, `apps/web/__tests__`, `tests`) |
| Contract (client decodes server) | `ContractDecodingTests`, `FoodLogSyncContractTests` | DTO decoding tests (explicit-null cases) | route tests plus the shared `toMobileUser` serializer tests |
| Component / visual | `FitCircleTests/Snapshots` (swift-snapshot-testing 1.19.4, `.never` record mode in CI) | Roborazzi on Robolectric (JVM, no emulator) under `app/src/test/.../screenshots` | — |
| UI integration | XCUITest target (`FitCircleUITests`, launch tests only today) | Compose UI test on Robolectric (`createComposeRule`) plus instrumented `androidTest` (local QA backend) | Playwright `e2e/` |
| End-to-end | Maestro `maestro/` on "FitCircle CI iPhone" | Maestro `maestro/` on "FitCircle CI Pixel" | `scripts/smoke/prod-smoke.mjs` after each deploy |
| Real devices | TestFlight internal plus a device cloud (§12) | Play internal testing, pre-launch report, device cloud | — |

Target mix: unit 85% or more of the test count. Snapshot and screenshot 20–60 images per app, covering states, not every screen. Maestro is about 7 smoke and about 15 regression flows per app and should never grow past about 30; anything deeper belongs in a lower layer.

---

## 4. Device and OS matrix

The minimum deployment targets are iOS 17.0 and Android minSdk 26 (8.0). Targets are iOS 27 and Android targetSdk 37.

### iOS

| Tier | Device / form | OS | Where | When |
|---|---|---|---|---|
| A (gate) | iPhone 17 Pro (6.3") — **"FitCircle CI iPhone"** | iOS 27.0 | Mac runner simulator | every commit (unit, snapshot, Maestro smoke) |
| A | iPhone 17 Pro Max (6.9") | iOS 27 | simulator, snapshot `…ProMax` variants | every commit |
| A | small: iPhone SE 3 or 16e (4.7"/6.1") | iOS 18 | simulator (snapshot uses the SE layout today) | nightly |
| A | **iPhone Duo** (foldable: outer plus inner display) | iOS 27.1 | simulator ("iPhone Duo" runtime) plus `DuoScreenshotHost` | nightly and release |
| B | any iPhone on **iOS 17.x** (lowest supported) | 17.x | real device or device cloud. Xcode 27 may not offer an iOS 17 simulator runtime; install via *Xcode → Settings → Components* if listed | release |
| B | iOS 18.x mid-range (iPhone 13/14) | 18.x | real device or device cloud | release |
| C | iPad (runs the iPhone app compatibility mode) | 27 | simulator | release, exploratory |
| C | Apple Watch (FitCircleWatch, once shipped) | watchOS 26+ | paired simulator plus a real Watch | release |

### Android

| Tier | Device / form | API | Where | When |
|---|---|---|---|---|
| A (gate) | Pixel phone — **"FitCircle CI Pixel"** (AVD `FitCircle_CI_Pixel`) | 37 | Mac runner emulator | every commit (Maestro) |
| A | JVM screenshots (phone and foldable widths, Robolectric qualifiers) | 35/36 shadow | JVM | every commit |
| A | **Foldable**: Pixel 10 Pro Fold or generic foldable AVD | 36–37 | emulator (existing `Pixel_10_Pro_Fold` for manual use; add `FitCircle CI Fold` when needed) | nightly and release |
| B | minSdk floor: API 26 (8.0) and API 28 (9) | 26, 28 | device cloud (old images) | release |
| B | API 30, 33, 34 (Samsung One UI, Xiaomi, OnePlus) | 30–34 | device cloud real devices | release |
| B | API 35/36 Pixel real device | 35–36 | personal device or device cloud | release |
| C | tablet (layout sanity) | 35+ | emulator | exploratory |

Screen sizes to cover: small (360×640dp), normal (412×915dp), large or foldable inner (≥600dp), and font scale 1.0 and 2.0.

---

## 5. Test data and accounts

| Account | Purpose | Who may use it |
|---|---|---|
| **`qa.automation@fitcircle.ai`** ("QA Automation", free tier, onboarding complete) with its private, invite-only **"QA Automation Circle"** | Maestro smoke and regression, the authenticated prod smoke, manual QA on prod | automation and the team |
| `fitcircle.user@gmail.com` ("Taylor Reviewer", the App Review demo account) | App Store and Play review only, refreshed daily by `/api/cron/demo-account-refresh` | **App Review only. Never automation, never personal devices.** The seed script refuses its id and its circle |
| Throwaway signups `qa+<date>-<n>@fitcircle.ai` | onboarding and deletion tests | created and deleted inside the test |
| Local synthetic users (`Fitcircle-Android/scripts/qa`) | instrumented tests against a local Supabase in Docker | local only |
| StoreKit config `FitCircle.storekit`, App Store sandbox testers, Play license testers, Stripe test mode | purchases | manual |

**Seeding:** `scripts/qa-account/` (this repo) creates or finds the QA user with the admin API (email pre-confirmed, so no email is sent). It also resets its activity to a small deterministic baseline and ensures its private circle exists. It refuses to touch the demo account. Run it with `--dry-run` to preview, `--apply` to write, and `--delete` to remove the account. Credentials live outside every repo in `~/FitCircleCI/secrets.env` (mode 600): `QA_EMAIL` and `QA_PASSWORD`. Rotate the password by re-running `--apply`.

**Data hygiene:** smoke flows that write (water plus undo, a text meal) leave at most one meal per run on the QA account. The nightly seed `--apply` resets the baseline, so data never accumulates. Prod smoke (§6.4) is read-only.

---

## 6. Automation inventory

### 6.1 Maestro (both platforms; `maestro/` in each app repo)

| Flow | Tags | Steps |
|---|---|---|
| `01_launch_sign_in` | smoke, regression | cold launch; if `auth_email` is visible, sign in with `${QA_EMAIL}`/`${QA_PASSWORD}`; assert the dashboard |
| `02_water_log_undo` | smoke, regression | tap `water_quick_add`, assert `water_undo`, tap undo, assert it is gone |
| `03_meal_text` | smoke, regression | open the meal form, type "2 scrambled eggs and toast" into `food_text_input`, run the AI estimate (`food_text_submit`), then `food_save`; assert the entry is listed |
| `04_circle_open` | smoke, regression | FitCircles tab, tap the first `circle_row` (the QA circle), assert the detail screen |
| `05_fitzy_open` | smoke, regression | `fitzy_open`, assert `fitzy_input`, close with `fitzy_close` |
| `06_paywall_open_close` | smoke, regression | open a paywall entry point, assert `paywall_screen` or the plan list, close with `paywall_close` |
| `99_sign_out` | smoke, regression | Profile → `settings_open` → `sign_out` → confirm; assert `auth_email` |

Every flow runs `subflows/ensure_signed_in.yaml` first, so each one runs on its own. System permission prompts are handled as optional taps. Identifier contract: `auth_login_tab, auth_email, auth_password, auth_submit, water_quick_add, water_undo, food_text_input, food_text_submit, food_save, circle_row, fitzy_open, fitzy_input, fitzy_close, paywall_close, settings_open, sign_out, sign_out_confirm` (plus platform-specific extras documented in each flow). iOS tab bar items are matched by their visible labels, because SwiftUI does not forward identifiers to `UITabBar` buttons.

### 6.2 iOS snapshots

`FitCircleTests/Snapshots/KeyScreenSnapshotTests.swift` covers:

- Login at iPhone 13 Pro, Pro Max, and SE sizes, plus accessibility XXL text
- Paywall with plans loaded
- Hydration card: empty, partial, goal met, imperial (fixed dates)
- Fitzy with the free quota reached
- Campaign card for Hold the Line

References are recorded on "FitCircle CI iPhone" (iOS 27.0) and live in `__Snapshots__/`, which is excluded from the test bundle. Re-record with `SNAPSHOT_RECORD=1 scripts/ci/run-tests.sh snapshot`. Review the PNG diff in the PR. Failures write reference, failure, and difference images to `$FC_REPORT_DIR/snapshot-failures`.

### 6.3 Android screenshots and Compose

Roborazzi on Robolectric (`./gradlew verifyRoborazziDebug`; record with `recordRoborazziDebug`). Baselines are committed under `app/src/test/screenshots`. There is also a Compose UI smoke test on Robolectric (`createComposeRule`) that asserts on the shared test tags.

### 6.4 Backend

`vitest run` covers unit, route, and contract tests. `scripts/smoke/prod-smoke.mjs` is the post-deploy smoke:

- prod health check
- unauthenticated endpoints (status codes, `no-store` on `/api`, 401 rather than 500 when auth is missing)
- a read-only authenticated QA flow, when `QA_EMAIL`/`QA_PASSWORD` or `QA_ACCESS_TOKEN` are in env

It writes JUnit output to `$FC_REPORT_DIR`.

---

## 7. Release gates

### 7.1 Before TestFlight internal / Play internal testing (every build uploaded)

All of these must be green on the commit being uploaded:

1. iOS `unit` and `snapshot`, Android `unit`, `screenshot` and `compose-ui`, backend `unit`.
2. Maestro **smoke** green on both CI devices against prod with the QA account.
3. Build sanity: Release configuration builds. Android R8 release bundle builds, and `play-release.sh` preflight passes. iOS `asc-preflight.sh` passes.
4. No new Sentry issue on the previous internal build with more than 5 users affected that isn't triaged.
5. If the backend changed: prod smoke green after the Vercel deploy, and migrations applied and listed in the migration log.

### 7.2 Before store submission (App Store review / Play production)

Everything in 7.1, plus:

1. Nightly **regression** green on the two most recent nights (no quarantined P0 flows).
2. Manual exploratory checklists §8 for every P0 area touched by the release, signed off in the release notes. The full P0 set is required for a major or minor version.
3. Real-device pass (§12): iOS 17.x and the newest iOS on two iPhones; Android API 26 or 28, 34, and 36/37, including a foldable.
4. Purchases in sandbox: buy, restore, cancel on both platforms. Prices match App Store Connect and Play Console ($9.99 / $29.99 / $179.99).
5. Ads and consent: EEA fresh-install flow (UMP, then ATT) and a Pro user sees no ads.
6. Performance budgets §9 met on the reference devices; accessibility checks §10 pass.
7. Demo account (`fitcircle.user@gmail.com`) refreshed today and signed in successfully on a clean device. This is a manual check, never automated.
8. Version and build numbers bumped (iOS `MARKETING_VERSION` after each approval; Android `versionCode`).

### 7.3 Post-release

Run prod smoke within an hour of release. Watch Sentry crash-free sessions (target 99.5% or more for users and sessions) and the Play Android vitals ANR rate (below 0.47%) for 48 hours. Hotfix if either drops below threshold.

---

## 8. Manual exploratory checklists

Run each checklist with the QA account unless noted. Note device, OS, and build in the release ticket. Each checklist takes 10–20 minutes.

### 8.1 Auth and account switching
- [ ] Email sign-in; wrong password shows the inline error with the reset link; "email not confirmed" shows resend.
- [ ] Sign in with Apple (new and returning); Google sign-in (both platforms).
- [ ] Kill the app for over an hour with the token expired, relaunch: still signed in (refresh works) and no loop.
- [ ] Sign out, then sign in as **another** account: dashboard, food log, circles, Fitzy memory and profile photo all belong to the new user. Pull to refresh and check again (no cached `/profile`).
- [ ] Delete account (throwaway): confirmation, then a signed-out screen with the "account deleted" message, and the rows are gone in Supabase.

### 8.2 Food and water, offline and online
- [ ] Online: log a meal by text, photo, voice, and barcode, plus a beverage. Each appears once with sensible macros.
- [ ] Airplane mode: log 2 meals and 3 waters, undo 1 water, kill and relaunch. Pending state shows "saved on this phone". Reconnect: exactly 2 meals and 2 waters on the server, no duplicates.
- [ ] Rapid water taps (×5 in 2 s) both online and offline give the correct total.
- [ ] Edit and delete an entry. Re-analyze a photo meal.
- [ ] Android: a large camera photo (over 4.5 MB) uploads after compression.
- [ ] Day boundary: an entry logged at 23:58 local lands on the correct date.

### 8.3 Circles and chat
- [ ] Create a circle, share the invite code, join from a second device, leave.
- [ ] Chat: realtime message both ways under 2 s; image post; meal card post (iOS card, Android text: a known gap); day headers.
- [ ] Report and block a user, and their posts disappear. A late join respects `allow_late_join`.

### 8.4 Streaks and saves
- [ ] Logging an activity claims today (server `meta.streak`). A synced workout of 10 minutes or more claims.
- [ ] Missing a day with a shield uses exactly one shield. Without one, the Pro upsell appears. A milestone celebration shows once.

### 8.5 Referrals and campaigns
- [ ] Invite link opens the app or store and attributes the inviter. Invitee's first activity qualifies the referral.
- [ ] Campaign card, info sheet, and calendar door render for the current campaign. A future door is locked. Use the `-CampaignPreview <slug>:<surface>:<date>` matrix on iOS for each template.

### 8.6 Fitzy
- [ ] AI consent gate on first open. Starters work. Streaming renders progressively. Offline mid-stream shows a retry, not a hang.
- [ ] Free quota reached shows the paywall card. Pro shows the weekly plan, memory, and daily focus.
- [ ] Unsafe prompt (extreme diet) gets a safe response.

### 8.7 Paywall and purchases (sandbox)
- [ ] Every entry point opens one paywall (AI limit, history limit, circle limit, remove ads, streak shield, settings).
- [ ] Buy monthly, annual (upfront and installment where offered), and lifetime. Pro is unlocked within 5 s and ads disappear. Restore on a second device. Cancel in sandbox, then revert to free after expiry.
- [ ] Offer code redemption (iOS). Play: license tester purchase plus a pending purchase.

### 8.8 Ads and consent
- [ ] EEA fresh install: UMP form, then ATT (iOS), then ads personalised according to consent. Non-EEA: ATT only.
- [ ] Frequency cap respected. No ad on paywall, onboarding, or Fitzy. Pro user sees zero ads.

### 8.9 Push
- [ ] Permission prompt timing (after value, not at first launch). Meal reminder arrives, and quiet hours suppress it. No more than 3 per day apart from exempt ones.
- [ ] Tapping a circle-post push opens that circle (cold and warm start).

### 8.10 Deep links
- [ ] `fitcircle://dashboard`, `checkin`, `circle/<id>`, `leaderboard/<id>`, `profile`, `goals`, `streaks` from Notes or Messages, with the app killed, in the background, and signed out (lands after login).
- [ ] Universal invite links `https://www.fitcircle.ai/i/<code>`. An unknown host does nothing (no crash).

### 8.11 Apple surfaces (widgets, Live Activities, Controls, Siri, notifications, Watch)
- [ ] Widgets: every family (small, medium, lock screen circular and rectangular) shows correct data. Timeline refreshes after logging in the app, signed out shows a placeholder, and dark and tinted modes are legible.
- [ ] Live Activity ("Close the circle"): starts, updates, and ends. Dynamic Island compact, expanded, and minimal. Ends when the goal is met or at the end of the day. No zombie activity after sign out.
- [ ] Controls (Control Center and Action button): the action runs without opening the app where intended, and the result is reflected in the app.
- [ ] Siri / App Intents / Shortcuts: "Log water in FitCircle" works, signed out shows a graceful error, and the phrase is localised.
- [ ] Rich notifications: actions (log or snooze) work from the lock screen.
- [ ] Watch: logging on the Watch shows on the phone within a minute; works offline then syncs; complications update.

### 8.12 Foldables and large screens
- [ ] iPhone Duo inner display: sidebar tabs and two-pane dashboard; folding and unfolding keeps state.
- [ ] Android foldable: unfold during food entry keeps the draft; tabletop posture; no clipped dialogs.

---

## 9. Performance budgets

Measured on reference devices: iPhone 13 (iOS 18) and Pixel 7 class (API 34), release builds, warm network.

| Metric | Budget | How to measure |
|---|---|---|
| Cold start to dashboard interactive | iOS ≤ 2.0 s, Android ≤ 2.5 s (p50); ≤ 4 s p90 | Xcode Organizer launch metrics / `adb shell am start -W`; Sentry app-start spans |
| Warm start | ≤ 1.0 s | same |
| Water tap → UI updated | ≤ 100 ms (local-first, optimistic) | Maestro timing, manual |
| Text meal AI estimate | p50 ≤ 4 s, p95 ≤ 10 s | Vercel function logs, Sentry spans |
| Photo meal analysis | p50 ≤ 8 s, p95 ≤ 15 s | Vercel logs |
| Fitzy first token | ≤ 2 s p50 | client spans |
| API p95 (read endpoints) | ≤ 500 ms; writes ≤ 800 ms | Vercel observability |
| Scrolling | no dropped-frame hitches over 100 ms on dashboard, food log, chat | Instruments (Hitches) / Android Macrobenchmark `FrameTimingMetric` |
| Memory | ≤ 250 MB resident after a 10-minute session (iOS), no leak growth across 5 sign-in/out cycles | Instruments Allocations / Android Studio profiler |
| App size (download) | iOS ≤ 60 MB, Android AAB download ≤ 35 MB; alert if more than 5% growth per release | App Store Connect / Play Console; Sentry Size Analysis (§11) |
| Crash-free sessions | ≥ 99.5% | Sentry, Play vitals |
| ANR rate | < 0.47% (Play bad-behavior threshold) | Play vitals |

---

## 10. Accessibility checks

Automated:
- The snapshot test at accessibility XXL text (`testLoginAccessibilityXXL`) catches truncation and clipping. Add an XXL variant to every new snapshot screen that has text input.
- Android: Roborazzi at font scale 2.0 for one screen. Compose `ATF` checks (`enableAccessibilityChecks()`) in the Compose UI test where supported.
- Maestro relies on identifiers, not labels, so labels stay human (VoiceOver and TalkBack read them).

Manual, before each submission:
- [ ] VoiceOver / TalkBack: complete the smoke path (sign in, log water, undo, log a meal, open the circle, open Fitzy, open and close the paywall, sign out) using only the screen reader. Every control has a meaningful label (no "button" alone); the hydration chips read "Add 250 milliliters".
- [ ] Dynamic Type / font scale up to AX5 / 200%: no clipped primary actions, and scrolling reaches everything.
- [ ] Contrast: text on gradients at least 4.5:1, using Xcode Accessibility Inspector or Android Accessibility Scanner on the dashboard, paywall, and login.
- [ ] Touch targets at least 44×44 pt (iOS) and 48×48 dp (Android).
- [ ] Reduce Motion: celebration, confetti, and streak animations are reduced.
- [ ] Color is never the only signal (goal met shows a checkmark as well as green).
- [ ] Voice Control (iOS): "Tap Log In" works with the visible labels.

---

## 11. Always-on runner (Mac) and GitHub Actions

### 11.1 GitHub Actions status (checked 2026-10-21 with `gh api`)
- Actions are **enabled** on all three repos (`allowed_actions: all`). No self-hosted runners are registered.
- `FitCircle-iOS` and `Fitcircle-Android` are **private**. Their hosted jobs are refused before starting with "recent account payments have failed or your spending limit needs to be increased". Only hosted-minute billing is blocking them, not Actions itself.
- `FitCircle` (this repo) is **public**, so hosted runners are free and do run. CI currently fails on real lint and test errors, not billing.
- Self-hosted runners: GitHub doesn't bill hosted minutes for them. GitHub announced a $0.002/min platform fee for self-hosted runners in private repos for 2026-03-01, then postponed it; whether it is in effect is unconfirmed. If an account in failed-payment state also blocks self-hosted jobs, the launchd runner below still covers everything. Workflows targeting `runs-on: [self-hosted, macOS, fitcircle]` ship in each repo (`.github/workflows/self-hosted-*.yml`). See `qa/ci-runner/README.md` §GitHub runner for registration.

### 11.2 launchd runner
`qa/ci-runner/` contains `fitcircle-ci.sh`, `install.sh`, `uninstall.sh`, `render_report.py`, and a README covering the Mac mini migration.
- **Poll** every 10 minutes (`ai.fitcircle.ci.poll`). For each repo whose `main` moved, it runs the commit suites: iOS unit, snapshot, maestro-smoke; Android unit, screenshot, compose-ui, maestro-smoke; backend unit.
- **Nightly** at 02:00 (`ai.fitcircle.ci.nightly`). Full regression for all three, plus prod smoke.
- Runs on dedicated devices **"FitCircle CI iPhone"** and **"FitCircle CI Pixel"**, from its own clones in `~/FitCircleCI/repos`.
- Writes reports to `~/FitCircleCI/reports/<date>/<time>-<kind>/` (JUnit, `.xcresult`, HTML index, Maestro screenshots, snapshot diffs). `reports/latest` points at the newest. Reports are kept for 30 days.
- Notifies via macOS notification, plus Slack (`SLACK_WEBHOOK_URL`) and email (`NOTIFY_EMAIL` using `RESEND_API_KEY`, or local `mail`) if set in `secrets.env`.

---

## 12. Paid device clouds and services

Prices were checked on 2026-10-21 from the vendors' pricing pages; "unverified" marks numbers that came from a third party. The Mac runner already covers simulators and emulators, so a paid service is only worth it for **real devices** (OEM skins, old OS versions, real GPU and camera, App Store / Play builds).

| Service | Pricing (2026-10) | Runs our tests? | Real devices | Verdict |
|---|---|---|---|---|
| **Firebase Test Lab** | Spark (free): 10 virtual + 5 physical runs per day. Blaze: 60 virtual + 30 physical device-minutes free per day, then **$1/h virtual, $5/h physical**, billed per minute. **FTL shuts down 2027-09-30**; its successor, Developer Device Platform, keeps FTL rates until 2027-04-30 ([pricing](https://firebase.google.com/docs/test-lab/usage-quotas-pricing), [migration FAQ](https://firebase.google.com/docs/test-lab/migrate-faq)) | Android instrumentation and Espresso, **Robo crawler (no test code)**, iOS XCTest. **No Maestro** | yes, Android and iOS | **Use now for the Android matrix** (Robo + `androidTest`). It's cheap, but plan the 2027 migration |
| **BrowserStack App Automate** | Device Cloud **$199 per parallel per month** (annual), about $249 monthly (third-party figure, unverified: [comparison](https://www.testmuai.com/blog/browserstack-vs-saucelabs/); vendor page: [pricing](https://www.browserstack.com/pricing?product=app-automate)). App Live (manual) and Live plans start at $39/mo | XCUITest, Espresso, Appium, **Maestro on real devices** (beta; [docs](https://www.browserstack.com/docs/app-automate/maestro)) | yes, large iOS fleet including old iOS versions | **Best single vendor** for real-iPhone Maestro runs |
| Sauce Labs | Real Device Cloud **$199/mo** annual or $249 monthly per parallel; Virtual $149/$199; Live $39/$49 ([pricing](https://saucelabs.com/pricing)) | XCUITest, Espresso, Appium. No Maestro | yes | Same price as BrowserStack, without Maestro. Skip |
| AWS Device Farm | **$0.17 per device-minute** metered, or $250 per unmetered slot per month; 1,000 free trial minutes ([pricing](https://aws.amazon.com/device-farm/pricing/)) | XCUITest, Espresso, Appium; Maestro only via a custom environment (unverified) | yes | About 2.5× the cost at our volume. Skip |
| Maestro Cloud | **$250 per device per month** (by maximum concurrency) ([pricing](https://maestro.dev/pricing)) | Maestro | **no**: simulators and emulators only | Adds nothing the Mac runner doesn't. Skip |
| Emerge Tools (now part of Sentry) | **Size Analysis included in every Sentry plan** (100 build uploads per month). **Snapshots** in free beta since 2026-06, price not published ([size](https://blog.sentry.io/size-analysis-generally-available), [snapshots](https://blog.sentry.io/snapshots-available-beta)) | uploads swift-snapshot-testing PNGs and Android previews | n/a | **Turn on Size Analysis now** (free, and we already pay for Sentry). Try Snapshots for PR diff review |
| Bitrise | Hobby free (300 credits); Starter $89–99/mo; Pro $200–218/mo ([pricing](https://bitrise.io/pricing)) | full CI on hosted Macs | no (simulators) | Not needed while the Mac runner works |
| Codemagic | **500 free M2 minutes per month**; pay-as-you-go $0.095/min (M2), $0.114/min (M4); fixed from $3,990/yr ([pricing](https://codemagic.io/pricing/)) | full CI on hosted Macs | no | Keep as the **fallback** if the Mac is down (the free tier covers an occasional release build) |

### Cost model

Workload: a nightly 10-minute smoke on 5 Android and 3 iOS devices (30 nights), plus a 40-minute regression twice a month on the same devices.

- Android: 10×5×30 + 40×5×2 = **1,900 device-minutes per month**
- iOS: 10×3×30 + 40×3×2 = **1,140 device-minutes per month**

| Option | Arithmetic | $/month |
|---|---|---|
| FTL for both (3 physical + 2 virtual Android, 3 physical iOS; XCTest/Espresso only) | 2,280 physical minutes − 900 free (30/day) = 1,380 min = 23 h × $5 = $115, plus virtual ≈ $1 | **≈ $116** (≈ $203 if the free quota doesn't apply to iOS) |
| **BrowserStack App Automate, 1 parallel, both platforms, Maestro** | flat; nightly 80 min and regression 320 min fit one parallel back to back | **$199** (annual) |
| FTL Android + BrowserStack iOS (the suggested split) | Android physical 1,900 − 900 free = 1,000 min = 16.7 h × $5 = $83, plus $199 | $282 |
| AWS Device Farm metered | 3,040 × $0.17 | $517 |
| Maestro Cloud (8 devices) | 8 × $250, no real devices | $2,000 |

### Recommendation (cheapest set that adds real-device coverage)

1. **Now, at ≈ $0–30/month:** Firebase Test Lab for Android real devices, run as a **release gate rather than nightly**. Robo crawler plus the `androidTest` suite on 5 physical devices (API 28 Samsung, API 30, API 34 Pixel, API 36 Pixel, one foldable), about 15 minutes each, twice a month. That is 150 device-minutes, mostly inside the free daily quota. Add **Sentry Size Analysis** (included) and the free **Play pre-launch report**.
2. **iOS real devices, at about $39/month or $199/month:** start with **BrowserStack App Live**, manual, for the release-gate pass on iOS 17.x and the newest iOS. When real-iPhone automation is worth it, move to **App Automate with 1 parallel ($199/mo annual)**. That runs the *same* Maestro flows on real iPhones and Android phones, and it can replace FTL before the 2027 shutdown.
3. **Skip** Sauce Labs (no Maestro), AWS Device Farm (2.5× the cost), Maestro Cloud (no real devices), and hosted Mac CI. Keep Codemagic's free 500 minutes as a fallback.

Expected spend: **$0–30/mo** now with FTL, Sentry Size Analysis and the pre-launch report. About **$40–70/mo** once BrowserStack App Live is added. **About $199/mo** with App Automate covering real-device Maestro on both platforms. The suggested FTL Android + BrowserStack iOS split costs about $282/mo, and App Automate alone already covers Android as well.

---

## 13. Maintenance

- **New screen**: add identifiers on both platforms and at least one snapshot/screenshot state. Add a Maestro flow only if it's on a P0 path.
- **Re-recording**: snapshots must be re-recorded on the CI simulator or emulator. Never accept a re-record without looking at the diff.
- **Flake policy**: if a test fails, passes on re-run, and fails again within a week, tag it `quarantine`, open an issue, and fix it within 7 days.
- **Review** this plan each quarter or when a new surface ships (Apple surfaces, Watch).
