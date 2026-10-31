# Engage: research and audit evidence

**Compiled:** 2026-10-30. This is the evidence behind `ENGAGE_V2_SPEC.md`. The sources are Braze docs (primary), Customer.io, OneSignal, Airship, Iterable, Firebase, Apple, Google, WebKit, FTC and Vercel, plus three code audits of FitCircle repos. Facts that may age are flagged. Re-check platform policy before submitting a build.

## 1. Braze feature inventory → what we need

Key: **E** = essential, **N** = nice-to-have, **S** = skip.

### Channels
- **Push (E):** APNs, FCM, deep links, images, per-platform overrides. Action buttons need categories pre-registered in the app, so they are P1.
- **In-app messages:** modal, slideup and full are **E**. HTML is **S** (App Review risk, accessibility, XSS).
  - [Braze IAM](https://www.braze.com/docs/developer_guide/in_app_messages)
  - User-supplied JavaScript on web requires the `allowUserSuppliedJavascript` opt-in ([web IAM](https://braze.com/docs/developer_guide/platform_integration_guides/web/in-app_messaging/integration)).
- **Content Cards:** a persistent feed with a 30-day maximum expiry. **Banners** are Braze's newer placement-based model and what Braze now recommends for new projects ([migration guide](https://www.braze.com/docs/developer_guide/banners/migrating_from_content_cards/)). How Banners work:
  - Apps declare named placements and refresh up to 10 at a time.
  - Targeting and personalization are re-evaluated on every refresh.
  - The highest priority wins; ties go to the newest.
  - Rate limit: 5 refresh tokens per session, refilling every 180 s.
  - They can't be triggered by an action or an API call.
  - [Banners overview](https://www.braze.com/docs/user_guide/channels/banners/), [placements](https://www.braze.com/docs/developer_guide/banners/placements?tab=web)
  - Braze's docs disagree on the maximum number of active messages per placement (25 vs 200).
- **Pattern to copy from Iterable:** Embedded Messaging uses placements and sends a **silent push to refresh** the cache ([Iterable](https://iterable.com/features/embedded-messaging/)). → Engage placements, plus a silent push for test sends.
- **Email:** N, later. **Webhooks:** N. **SMS:** S.

### Campaign types
- **E:** single, scheduled, local-time, action-triggered and API-triggered.
- **Recurring:** N.
- **Canvas journeys:** P1.
  - Exit criteria remove a user at the end of a Delay ([exit criteria](https://www.braze.com/docs/user_guide/engagement_tools/canvas/canvas_components/exit_criteria)).
  - Decision splits ([decision split](https://www.braze.com/docs/user_guide/messaging/canvas/canvas_components/decision_split)).
  - Re-eligibility windows ([re-eligibility](https://www.braze.com/docs/es/user_guide/messaging/messaging_fundamentals/re_eligibility/)).
  - A linear editor with branches is enough.

### Targeting
- **Real-time filters:** attributes, events, app version, platform, OS, locale, timezone and last used.
- **Long event windows** use batch "Segment Extensions": up to 730 days, refreshed on a schedule, 25 active by default ([Segment Extensions](https://braze.com/docs/user_guide/audience/segments/segment_extension/)). → Engage splits targeting into **real-time filters plus materialized segments**.
- **Version and OS syntax:** follow Firebase Remote Config conditions (`app.version`, `app.build`, `device.os`, country, language, percent) ([RC conditions](https://firebase.google.com/docs/remote-config/condition-reference)).
- **Test users:** [Content Test Groups](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/sending_test_messages).

### Personalization
- **E:** a Liquid subset with defaults.
- **Cheap to add:** `abort_message`. Aborted sends don't count ([docs](https://braze.com/docs/user_guide/messaging/design_and_edit/personalize/liquid/aborting_messages)).
- **S:** Connected Content (cached 5 min–4 h, [docs](https://www.braze.com/docs/user_guide/messaging/design_and_edit/personalize/connected_content/caching_responses)) and Catalogs.

### Delivery controls
- **Global frequency caps** ([docs](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/frequency_capping)):
  - up to 10 rules, ANDed;
  - scoped by channel or tag;
  - windows of up to 30 days, counted in **local calendar days**;
  - one count per dispatch, not per device;
  - checked **before** quiet hours, and a capped message is **skipped, not held**;
  - campaigns can opt out;
  - in-app messages and cards are not capped by these rules.
- **Rate limiting:** 10–500k per minute. Sends delayed more than 72 h are aborted. In-app messages and Banners are exempt.
- **Quiet hours** use the user's timezone (falling back to the company's). Messages are **held and released at the window edge**, which causes a burst; Engage adds jitter ([quiet hours](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/quiet_hours)).
- **In-app trigger rules** ([docs](https://www.braze.com/docs/developer_guide/in_app_messages/triggering_messages?tab=swift)):
  - default minimum interval 30 s (never below 10 s in production);
  - one message at a time;
  - priority breaks ties;
  - one message per session for session-start triggers;
  - triggers sync at session start ([FAQ](https://braze.com/docs/user_guide/channels/in_app_messages/faq/)).
- **Intelligent Timing:** must be scheduled 24 h ahead ([docs](https://braze.com/docs/user_guide/brazeai/intelligence_suite/intelligent_timing)). N for us.

### Experimentation
- **E:** A/B variants and a per-campaign control.
- Braze picks a winner at 95% confidence (χ² across variants, Z test against control) ([A/B FAQ](https://www.braze.com/docs/user_guide/messaging/ab_testing/faq), [analytics](https://braze.com/docs/user_guide/engagement_tools/testing/multivariant_testing/multivariate_analytics/)).
- **Global control group:** P1, excluded by tag ([GCG](https://braze.com/docs/user_guide/audience/global_control_group)).
- At our scale, show confidence intervals and **never auto-promote a winner**.

### Analytics
- Track: sends, deliveries/failures, impressions, clicks, dismissals, conversions, per variant and control.
- Conversion window: up to 30 days, default 3; a user converts once per event per campaign; Canvas credits the last step received ([conversion events](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/conversion_events)).

### Governance
- Draft → scheduled → live → paused → archived; test sends; preview as a user; audit log.
- Approvals are off by default in Braze, any edit resets them, and messaging rules can require approval above a reach threshold ([approvals](https://braze.com/docs/user_guide/messaging/governance/approvals)).

### SDK responsibilities
Session and foreground handling, event logging, token registration on every launch, sync at session start, trigger evaluation on the device, offline cache with expiry, idempotent impression and click logging, a safe deep-link router, accessibility, dark mode and RTL.

## 2. Previews
- Braze's composer preview is approximate, and Braze recommends a device test send ([IAM testing](https://braze.com/docs/user_guide/message_building_by_channel/in-app_messages/testing)).
- "Preview as user" renders Liquid for a real profile and needs a PII permission ([docs](https://braze.com/docs/user_guide/messaging/design_and_edit/personalize/preview_personalization/)).
- An in-app test arrives as a push that the tester taps. Test Banners stay visible for 5 minutes ([Banners testing](https://braze.com/docs/developer_guide/banners/testing/)).
- → Engage previews come in three tiers:
  1. React renderers in device frames, where the web renderer is the production component;
  2. a device test send using a silent push to refresh;
  3. a native snapshot gallery rendered in CI (P2).

## 3. Server-driven UI
- Use a fixed set of native layouts and components behind a versioned JSON schema (as Airship Scenes and Braze's typed in-app messages do) ([Airship](https://www.airship.com/docs/developer/sdk-integration/web/in-app-experiences/)).
- Actions are typed enums. Clients negotiate capabilities (`X-Client-Features`, versioned card types), and every message has a fallback.
- Styling uses tokens, not CSS.
- No HTML/JavaScript in-app messages. App Review **2.5.2** forbids downloaded code that changes features, and **4.7 / 4.7.2** limit HTML5 mini-apps and their access to native APIs ([guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- Don't use pull-based surfaces for time-critical information. Braze notes that cards and Banners depend on sync.

## 4. Platform policy and compliance (re-check before each submission)
- **Apple 4.5.4:** promotional pushes need **explicit opt-in shown in the app's UI and an in-app opt-out**. Push must not be required for the app to work, and must not carry sensitive personal data. → `marketing_enabled` (default off) and a "Tips & offers" toggle.
- **Apple 2.5.18:** no display ads in notifications. Promoting our own Pro plan is fine; third-party sponsor promos are risky.
- **Interruption levels:** passive, active, time-sensitive (needs a capability) and critical (needs an entitlement), set through `aps.interruption-level` ([Apple](https://developer.apple.com/tutorials/data/documentation/usernotifications/unnotificationinterruptionlevel.md)). Marketing uses passive or active.
- **Provisional authorization (iOS 12+):** delivered quietly. Engage treats `provisional` as its own permission state.
- **Live Activities push:** token-based APNs; push-to-start needs iOS 17.2+ ([WWDC23](https://developer.apple.com/videos/play/wwdc2023/10185/)). Out of scope, but the schema allows a `token_kind`.
- **Android 13+:** `POST_NOTIFICATIONS` is a runtime permission and is off by default for new installs ([docs](https://developer.android.com/develop/ui/views/notifications/notification-permission)). Channel importance can't be changed by the app after creation ([channels](https://developer.android.com/training/notify-user/channels)). → Define the Engage channels up front and report each channel's state from the client.
- **iOS web push:** iOS 16.4+, Home Screen web apps only, the request must come from a user gesture ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Declarative Web Push needs Safari 18.4+ ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)). → P2.
- **GDPR / CCPA:** consent per channel with its source and time, immediate withdrawal, Engage data included in deletion and export, a suppression list, and disclosure if any of it is shared with ad platforms.
- **CAN-SPAM (email):** accurate headers, a non-deceptive subject, a physical address, and an unsubscribe honoured within 10 business days ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
- **FCM:** default 600k messages per minute per project. Constant sending at the maximum rate can get an app flagged ([quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas)).
- **Token hygiene:** drop tokens on APNs 410 / `BadDeviceToken` and FCM `UNREGISTERED`; expire stale tokens after about 270 days.

## 5. Architecture patterns (what the vendors do → what fits Vercel + Supabase at 10k–100k users)
- **Vendors:** an append-only event stream plus a profile store. In-app messages are pulled at session start (OneSignal treats a return after ≥30 s in the background as a new session, [docs](https://documentation.onesignal.com/docs/in-app-messages)). Segments split into real-time and batch. Sends go through queued per-user jobs with idempotency keys.
- **Fits us:**
  - Postgres only.
  - Segment filter tree → SQL over `profiles` plus a facts table.
  - A dispatcher cron every minute with `SKIP LOCKED`, and a Postgres job table drained by the cron.
  - A unique ledger index as the real idempotency guarantee.
  - Pull API for in-app messages and cards, `no-store`.
- **Vercel Queues** was in public beta from 2026-02-27, with at-least-once delivery and an idempotency key ([changelog](https://vercel.com/changelog/vercel-queues-now-in-public-beta)). Vercel Workflow was in beta at the time of reading. Either is optional at this scale, and journey state in a table is cheaper to query and audit. **Check their GA status before depending on them.**

## 6. Audit of the parked v1 code (branch `feat/engage`, 2026-10-30)
- **Backend, functionally complete.** Read in a throwaway worktree:
  - 61 of 61 Engage tests pass;
  - the full suite (2,048) passes;
  - `tsc` is clean;
  - the 16 admin routes require admin.
- **Gaps and bugs:** listed as B1–B12 and G1–G6 in `ENGAGE_FINISH_PLAN.md` §2. The worst:
  - the push ledger is written before the send, so pushes suppressed by quiet hours or caps are lost;
  - event spoofing;
  - no event retention;
  - segments evaluated in Node with offset paging over every profile;
  - stats computed by loading raw rows.
- **Drift against main:**
  - Backend: 50 commits; the Engage-touched files changed by +2.8k/−1.8k (dashboard rewritten for the home feed, orchestrator, tracking plan v12→v16).
  - iOS: 95 commits; touched files +3.9k/−2.6k (`DashboardFeature` home-feed switch, AppFeature, the stale auth edits).
  - Android: 78 commits; +3.6k/−1.1k (MainScreen AppShell, DashboardScreen home feed).
- **Verdict:** port by hand in all three repos, no rewrite. The self-contained Engage files carry over.

## 7. Audit of the systems on main Engage must fit into (2026-10-30)
- **Home feed:**
  - **Live**, controlled by `HOME_FEED_*` flags, all defaulting on.
  - Card type support is negotiated through `cards=type@N`, `X-Feed-Schema: 1` and `X-Client-Features: icon_keys`; requests carry `X-App-Platform/Version/Build`.
  - `composeFeed` plus guardrails: at most 2 promo-category cards, at most 1 in the first 4, none adjacent.
  - `home_feed_rules` holds 1 rule, which is disabled; there is **no admin UI** (curl only).
  - `home_feed_decisions` is meant to keep 90 days but has no cleanup.
- **promo@1:**
  - `PROMOS_ENABLED=true` in prod, but only 1.1.0 clients declare promo@1.
  - The 4 promos (`first_meal`, `log_meal_now`, `pro_value`, `meet_fitzy`) exist **only in code** (`SYSTEM_PROMOS`); the database `promos` columns go unused, and there's no authoring UI.
  - Actions: `open_screen` (12 targets), `paywall`, `invite`, `start_circle`, `join_campaign`, `log_water`, `enable_notifications`, `open_url` (allowlisted hosts), `dismiss`.
- **Campaigns (Experiences):** live. Templates `seasonal_circle`, `daily_calendar` and `spotlight`; the hourly cron sends push and email with audiences `all`, `participants` or `reminders`; App Store event sync through the ASC API. There are **two editors**: the FitCircleBE `/admin/campaigns` one and the Admin Tools campaigns module, which has native iOS and Android preview mocks.
- **Push:**
  - `NotificationOrchestrator.send`: about 50 types with templates fixed in code (only the `campaign` type takes free-form copy).
  - Checks: dedupe, category toggle, 3 per local day plus exempt types, quiet hours, a burst limit, and Fitzy's reserved slot.
  - `push_tokens` has **no app version, OS or locale**; prod has 27 iOS and 66 Android active tokens.
  - **Opens are never recorded.** iOS has rich push (image and categories); **Android doesn't render images and drops unknown data keys**.
  - `FITZY_PUSH_ENABLED=true` in prod.
  - The dormancy and journey ladder in `lib/cron/notification-crons.ts` is **dead code**: nothing schedules it.
- **Email:** Resend, live. Consent is split across 4 stores.
- **Flags and experiments:** `feature_flags` (fails closed); the mobile route serves an allowlist; the experiments system (migrations 112/113) has arms, audience, sticky assignment, overrides, layers and audit; `onboarding_paywall` is running.
- **Analytics:** tracking plan v16 (153 events) with codegen for 3 platforms. Server-side events live in `engagement_activities`, `subscription_events`, `user_attribution`, `home_feed_events`, `promo_user_state` and `notification_log`.
- **Targeting data gaps:** no stored per-device app version, OS, locale, ATT status or push permission; `profiles.last_active_at` isn't maintained. → Add an `engage_devices` table and a session endpoint.
- **Admin Tools** (`inov8r-admin`):
  - Next 15.5, React 19, Tailwind v4, Auth.js Google login.
  - Domain-restricted to `hd` inov8rlabs.com / buyforbaby.in, plus `ADMIN_ALLOWED_EMAILS`.
  - A whitelisted proxy to `FitCircleBE /api/admin/*` using `FITCIRCLE_ADMIN_API_SECRET` and `X-Admin-Actor`.
  - Modules: ads, campaigns, releases, experiments.
  - Reusable for Engage: the UI kit, native preview mocks and the experiments `AudienceEditor`.
- **UI constraints:**
  - The no-emoji design language with icon keys, tokens, the gradient on a single CTA only, and no fake data.
  - iPhone Duo `PaneNavigation` (nothing primary opens as a sheet on the large layout) and Android `AppShell`.
  - Existing modals an in-app message must not collide with: the paywall (and its auto-throttle), Meet Fitzy, the post-aha paywall, the campaign info sheet, referral celebrations, ATT, the review prompt, the biometric lock and the AI consent dialog.
