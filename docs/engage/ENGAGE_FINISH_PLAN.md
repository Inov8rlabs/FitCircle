# Engage: what it takes to finish

**Status:** Plan · 2026-10-30 · Spec: `ENGAGE_V2_SPEC.md` · Hosting: `ENGAGE_TOOL_HOSTING.md` · Evidence: `ENGAGE_RESEARCH.md`

## 1. Where things stand

The work-in-progress was parked on 2026-10-30 as branch `feat/engage` in three repos, all pushed:

| Repo | Commit | Based on | Behind main by | Size |
|---|---|---|---|---|
| FitCircleBE | `1238991` | `5db490f` (Oct 19) | 50 commits | 107 files, +11.7k |
| FitCircle-iOS | `6389971` | `b7f837e` (Oct 16) | 95 commits | 29 files, +2.9k |
| Fitcircle-Android | `6611b10` | `05909e5` (Oct 16) | 78 commits | 47 files, +3.1k |

**What works on the branch:**
- **Backend:** all 61 Engage tests pass, the full suite (2,048) passes, and `tsc` is clean. The asset library, segments (evaluated in Node memory), messages, delivery API, variant assignment, caps, event ingestion, push and email send (Resend), the 15-minute cron, stats and the full admin UI (in FitCircleBE `/admin`) are all present.
- **iOS and Android:** a complete Engage client with five placements, an in-app message host with "calm moment" handling, an action router, image cache and prefetch, debug preview hosts, and tests (9 on iOS, 18 on Android).

**Why it can't simply be merged.** Main has since shipped systems that overlap or replace parts of it:
- the server-driven home feed (migration 106);
- promo@1 cards (migration 110);
- experiments (migrations 112–113);
- Admin Tools as the admin home, with a whitelisted proxy;
- icon keys and the design language (migration 114);
- the iPhone Duo pane layout and the Android foldable `AppShell`.

The client wiring points have been rewritten: iOS `DashboardFeature` (2.1k lines changed) and Android `DashboardScreen`/`MainScreen`.

**Verdict:** port by hand in all three repos. Don't rebase. Lift the self-contained pieces and re-wire them onto the current architecture as `ENGAGE_V2_SPEC.md` describes.

## 2. Bugs and gaps in v1 that must be fixed while porting

| # | Issue | Fix (spec §) |
|---|---|---|
| B1 | Push ledger row is written **before** sending. A push suppressed by quiet hours or the daily cap is never retried, so a 23:00 immediate send silently misses everyone in quiet hours. | Ledger `pending → sent / suppressed / failed`, with retry of suppressed sends (§8) |
| B2 | Event spoofing: impressions and clicks are accepted for any message ID, including drafts, with client timestamps. | Accept only delivered messages; clamp timestamps (§11.1) |
| B3 | `engage_events` grows without bound, with no retention. | 90-day cleanup and rollups (§7) |
| B4 | Segment estimates and send audiences page through **every profile** with offset paging, evaluated in Node (about 1,250 queries per estimate at 50k users). | SQL segment compiler, facts table, keyset paging (§5.4, §8) |
| B5 | Stats load every raw row into Node. | `engage_stats_daily` SQL rollups (§14) |
| B6 | `getEngage` loads the user's whole impression history on every call and writes exposures one at a time. | Time-bounded queries and bulk upserts |
| B7 | Platform comes only from `x-platform`; main sends `X-App-Platform`, `X-App-Version` and `X-App-Build`. | Use main's `request-info` helper |
| B8 | A multi-platform user's content override is taken from the first platform only. | Resolve per device at send time |
| B9 | The bucket has no `file_size_limit` or `allowed_mime_types`. | Set them in the migration |
| B10 | `EngageShell` replaces the whole FitCircleBE `/admin` layout. | The tool moves to Admin Tools; drop the shell |
| B11 | Tracking plan written as v12, but main is at v16. | Re-add the events on top of the current version and regenerate |
| B12 | Migration is numbered 104 and was never applied. Main's next number is 117 (it may be higher by then). | Renumber; apply it alone |
| G1 | No device registry: app version, OS, locale and push permission are unknown per user. | `engage_devices` plus a session endpoint (§5.3) |
| G2 | Push opens are never recorded (`/notifications/[id]/opened` is never called). | `push_opened` events (§8) |
| G3 | Android doesn't render push images and drops unknown push data keys. | BigPicture style and allowlisted keys (§8) |
| G4 | No marketing-push consent (App Review 4.5.4). | `marketing_enabled` plus a "Tips & offers" toggle (§10.1) |
| G5 | Email consent is split across four stores. | `engage_consent_v` view; unsubscribe writes to all of them (§10.1) |
| G6 | `home_feed_decisions` has no cleanup cron. | Add it alongside Engage retention |

## 3. Phases

Each phase ships on its own and is gated by kill switches. Effort is in focused agent-days, with the human steps noted. Sizes assume parallel backend, iOS, Android and tool streams as in earlier releases.

### E0: Decisions and groundwork (½ day + owner review)
- Owner approves `ENGAGE_V2_SPEC.md` §17 decisions: hosting, marketing opt-in default, seasonal campaigns become Engage campaigns with an optional experience (decided 2026-10-31), web push and email scope, global control group.
- Write the contract fixtures: `engage@1` content, the `promo@2` card and `/engage/sync`. These become the golden files for client tests.
- Reserve the migration number (next free: 118) and create branches `feat/engage-v2` from current main in the backend, iOS, Android and inov8r-admin.

### E0b: Shared platform scaffold (3–4 days), see `ENGAGE_MULTITENANCY.md`
- Create the `inov8r-engage` monorepo:
  - `protocol/` (JSON Schemas, OpenAPI, golden fixtures, TS types);
  - `packages/{server,adapters,web,preview}`;
  - `ios/EngageKit` (SPM, zero dependencies, iOS 17+);
  - `android/{engage-core,engage-compose,engage-push}`;
  - `tools/` (conformance CLI, `engage migrate`).
- CI matrix: Next 14 and 15; Swift 6; AGP and Kotlin versions for both OkHttp 4 and 5 consumers.
- Publishing: GitHub Packages (npm, Maven) and a git-tag SwiftPM release.
- Adapter interfaces: `UserFacts`, `PushSender`, `EmailSender`, `Consent`, `Events`, `Screens`, `Theme`, `AdminAuth`.
- **From here on, E1–E8 port v1 code *into* the monorepo packages.** The FitCircle repos only receive the adapters and host integration. In the steps below, "backend", "iOS" and "Android" mean "package plus the FitCircle adapter".

### E1: Backend core on current main (4–5 days)
**Port from v1** with light edits:
- `lib/engage/{schema,model,render,policy,assignment,attributes→facts}.ts`;
- `engage-asset-service` (with B9 fixed);
- the asset client pipeline;
- `engage-message-service`, which becomes `campaign-service-engage` for campaigns and messages (§3);
- the admin route handlers (re-pathed to §11.2).

**New:**
- Migration 117+ for all §12 tables, row-level security on with no policies, and no functions.
- Segment compiler from the audience tree to SQL, with tests against a real local Postgres. Use `supabase start`, or a pg container if Docker is available; otherwise a pg-mem fallback, with real-Postgres tests run in CI.
- Facts cron (`/api/cron/engage-facts`) and the device session endpoint (G1).
- Unified audience adapters for feed rules, promos and experiments → the §5.1 tree.
- Variant assignment through `lib/experiments/bucket` (sticky; control logged as exposure).
- Consent view and `marketing_enabled` (G4, G5).
- Retention crons (B3, G6).
- Audit log and roles (`engage_roles`, enforced through `X-Admin-Actor`).

**Tests:** unit tests plus SQL integration tests. Port v1's 61 tests where they still apply.

### E2: Delivery surfaces (4 days)
- **Feed:** the Engage card source in `composeFeed` with `slot_hint` and priority under the existing guardrails; the `promo@2` schema with down-conversion to promo@1; migrate `SYSTEM_PROMOS` into seeded Engage campaigns marked `system: true` (with output parity tests: identical feed for the same users before and after); add `campaign_id` and `variant_id` to `promo_user_state`.
- **Sync API:** `GET /api/mobile/engage/sync` (in-app messages, placements, triggers, prefetch, control), `POST /engage/events` (B2), `POST /engage/session`.
- **Capability negotiation** (§6.4) and the compatibility report endpoint.
- **Contract replay tests** against shipped clients: iOS 1.0.9 and 1.1.0, Android vc36 and vc40. They receive nothing new, or a valid promo@1.

### E3: Send pipeline (4 days)
- `engage_schedule`, the dispatcher cron (every minute, `SKIP LOCKED`), keyset audience paging, the per-user job and the ledger state machine (B1).
- Orchestrator integration:
  - new `NotificationType` family `engage_marketing` / `engage_lifecycle` / `engage_transactional`;
  - category and consent mapping;
  - global caps and the weekly marketing cap;
  - quiet-hours hold with jitter;
  - retry of suppressed sends.
- Token hygiene: deactivate tokens on 410, `BadDeviceToken` or `UNREGISTERED`, and expire after 270 days. Push-open tracking (G2).
- Email through Resend with the shell template, unsubscribe and rate limits.
- Throughput tests: a simulated 100k-user audience against a local database with a mocked push provider, completing within the §15 targets.

### E4: The tool in `inov8r-admin` (6–7 days)
- **Hosting** (per `ENGAGE_TOOL_HOSTING.md`): the `engage` module, proxy rules with tests, host routing for `engage.inov8rlabs.com`, the Engage shell, per-module roles, and cross-links.
- **Pages:**
  - Overview;
  - Campaigns list;
  - **Composer**: audience builder with live count and samples, per-surface message editors, schedule and trigger, goal and experiment, review with checklist, compatibility and dry run, then submit, approve or launch;
  - Segments, with use sites;
  - Assets (port v1's AssetsPage and AssetPicker);
  - Feed rules and feed-as-user preview;
  - Analytics;
  - Settings;
  - Audit.
- **Preview tier 1:**
  - The **web renderers** become shared production components. Pick one approach:
    - publish them from FitCircleBE as a small package consumed by inov8r-admin;
    - vendor them with a sync script and a drift test (the pattern `ads/types.ts` already uses);
    - or render the web preview server-side through a FitCircleBE preview endpoint returning HTML.

    **Recommended:** vendor with a drift test now, and package them later.
  - iOS and Android frames extend the campaigns module's `preview/native/*`, with Dynamic Type, dark mode, Duo inner and foldable widths.
  - "Render as user" with an eligibility trace.
- **Preview tier 2:** test send to admin-registered devices through a silent push (needs E5 and E6 clients).
- Port the composer UX from v1 (`MessageComposer`, `ContentEditor`, `ActionPicker`, `PreviewPane`, `FilterBuilder`, about 2.5k lines of React) onto the Admin Tools kit.
- Remove FitCircleBE `/admin/{messages,segments,assets}` (never shipped) and, once the Admin Tools campaign editor covers it, the duplicate FitCircleBE `/admin/campaigns` UI.

### E5: iOS client (5 days, ships in the next iOS release after approval)
- Port `Core/Engage/*` (models, store, image cache, app-event bridge), `Features/Engage/*` (placement view, card views, in-app message host, action router) and the debug preview host and tests. **Leave out** the stale auth and network edits in the v1 commit (APIClient, RefreshCoordinator, TokenRefreshManager, KeychainManager, CampaignHomeCard): they shipped on main in their final form.
- Re-wire the home feed to render `promo@2` in `HomeFeedLayout` / `PromoCard` (extending promo@1), declared in `cards=`. Remove v1's separate home-hero and home-feed placements.
- Wire the placements into the current views: Circles list, Profile, check-in celebration, food log, Fitzy. In the Duo large layout they render in the pane.
- In-app message host at the root, coordinated with `PaneCover` / `panePresentation`, `PaywallPresenter`, `CampaignPresenter`, the Meet-Fitzy sheet, ATT, the review prompt and the biometric lock (the calm-moment registry).
- Headers: `engage@1` in `X-Client-Features`, plus `layouts=`, `actions=` and `placements=`. Session endpoint on foreground. Push-open event. Silent-push "refresh now" handling.
- Notification settings: a "Tips & offers" toggle (marketing push opt-in).
- Tests: decoding against the golden fixtures, placement caps, trigger and calm-moment logic, actions, and snapshot tests for every layout × light/dark × default/XXL × phone/Duo inner. The snapshots feed tier-3 preview later.

### E6: Android client (5 days, ships in the next Android release)
- Port `features/engage/*`, `core/model/Engage.kt`, `core/network/EngageApi.kt`, the debug preview with its fixtures, and `EngageRulesTest`. Move the global platform and version headers onto main's `ClientInfoInterceptor` (it already sends `X-App-Platform`).
- `promo@2` in the home feed `PromoCard`. Placements in Circles, Profile, check-in, food log and Fitzy. Pane rendering on rail and sidebar shells.
- In-app message host with `EngageBusy`, coordinated with `JourneyHost`, the paywall, `CampaignInfoSheet` and `AiConsentDialog`.
- Push:
  - allowlist the Engage data keys in `NotificationDeepLink`;
  - BigPicture image rendering;
  - an Engage notification channel set: `marketing`, `lifecycle`, plus the existing channels;
  - push-open event;
  - FCM data-message refresh.
- "Tips & offers" toggle. Roborazzi snapshots for every layout.

### E7: Web (2–3 days)
- Port `WebEngage` and the v1 layouts onto the current dashboard (home-feed driven):
  - `promo@2` cards in `feed-layout.ts` (it doesn't declare promo@1 today);
  - placements where the pages exist;
  - in-app modal and slide-up.
- Shared renderers with the tool preview (E4).
- Web push stays P2: VAPID keys, `sw.js` push handler, subscription UI, `push_tokens.platform='web'`.

### E8: Analytics and experiments (2–3 days)
- `engage_stats_daily` rollup cron (B5), lift vs control with confidence intervals, conversion windows, per-platform breakdown.
- Tracking plan: Engage Push Opened and Engage Conversion events; regenerate the code for all three clients.
- An "Engage" filter in the Ads Console (campaigns tagged `acq_*`).

### E9: Journeys and lifecycle (P1, 4–5 days)
- `engage_journey_state` and dispatcher steps: delay, branch, split and exit; the list-based editor.
- Rebuild the dead lifecycle ladder (`lib/cron/notification-crons.ts`) as journeys. Retire the old file.
- Global control group (5%) and materialized segments with enter/exit triggers.

### E10: Migration and cleanup (2 days)
- **Retire the separate campaigns system:**
  - Migrate `hold_the_line`, `advent_2026`, `new_year_reset` and `ramadan_2027` into Engage campaigns with an experience (§3.4).
  - Move their push and email (`campaigns.notifications[]` / `emails[]`, `campaign_deliveries`) into Engage messages.
  - Port the experience editor (templates, calendar doors, circle template, ring-art generator, art upload, App Store / Play event sync) from the Admin Tools Campaigns module into the Engage composer's Experience step.
  - Remove the Admin Tools Campaigns module and FitCircleBE `/admin/campaigns`.
  - Shrink the campaign cron to experience phase mechanics.
  - The mobile campaign endpoints and client views stay unchanged.

  **Time this around live campaigns:** Hold the Line runs Nov 15 – Dec 15 and Advent Dec 1–24. Migrate before or after they run, never mid-flight, or keep the old module read-only until they end.
- Feed rules UI replaces curl.
- Optional, P2: move hard-coded marketing copy (trial reminder, `fitzy_intro`) to Engage-managed copy with code-owned triggers.

**Later apps:** **E11, BuyForBaby** and **E12, TripWiz**, about 1.5–2 weeks each.
- Adapters (§4.2 of the multi-tenancy doc).
- BFB needs a bearer-secret admin path, `market` targeting (IN/CA/US) and a direct-APNs `PushSender`.
- TripWiz needs admin auth aligned to bearer + `X-Admin-Actor`, and the Next 14 route factories.
- Host integration in each app's iOS and Android clients.
- Registration in Admin Tools.
- Passing conformance.

**Total:** about 6–7 calendar weeks (E10 grows by about 2–3 days for the campaigns migration) with parallel streams, plus about 25–30% for building inside the shared library boundary, so **about 8–9 weeks to the FitCircle MVP**, reaching an MVP after E1–E8 (Braze-equivalent for one-off, scheduled and triggered push, in-app messages, cards, placements and email, with segments, experiments, preview and analytics). Journeys (E9) and migration (E10) follow.

## 4. Release coupling

- **The backend and tool can ship any time.** Every new surface is capability-negotiated, so old apps receive nothing new.
- **Mobile releases needed:**
  - one iOS release (E5) and one Android release (E6) to enable in-app messages, placements, promo@2, the device registry, open tracking, rich Android push and the marketing toggle;
  - after that, campaigns need **no app releases**, unless a new layout, component or action is added.
- **Before the first mobile release:** the tool can already drive **push** (for users with the existing categories enabled; marketing campaigns stay blocked until the consent toggle ships), **email**, and **promo@1 cards** on 1.1.0 clients through down-conversion.

## 5. Test and acceptance plan

- **Contract:**
  - golden fixtures for `engage@1`, `promo@2` and `/engage/sync`;
  - replay against shipped clients (no decode failures, nothing undeclared delivered);
  - cross-platform parity tests (the same campaign renders the same text on all three renderers).
- **Backend:**
  - unit tests;
  - SQL integration tests for the segment compiler (every operator and field) and the dispatcher (idempotency, retries, caps, quiet-hours jitter, consent);
  - a load test with 100k users.
- **Live LLM-style rule:** run real data through production code paths before calling it done. Dry-run a real segment against prod, read-only, and compare its counts with ad-hoc SQL.
- **Clients:**
  - snapshot matrices (layout × theme × text size × device class);
  - UI tests for calm-moment blocking, trigger timing and dismiss persistence.
- **End to end, on staging and then prod with test accounts:**
  - create campaign → test send to an iPhone, iPhone Duo inner screen, Android phone, Android foldable and web;
  - launch to the test segment → verify impressions, clicks, conversion and lift in the tool.
- **Acceptance**, before marketing campaigns go to real users:
  - App Review 4.5.4 consent flow verified;
  - kill switches tested;
  - the approval flow tested with two different admins.

## 6. Human steps (account, DNS and console clicks)

1. Add the domain `engage.inov8rlabs.com` to the Admin Tools Vercel project, plus the DNS record. Keep Vercel SSO off on it.
2. Add the OAuth redirect URI `https://engage.inov8rlabs.com/api/auth/callback/google`, unless the shared cookie domain is used instead.
3. Set the env vars in Vercel:
   - `ENGAGE_ENABLED`, `ENGAGE_SENDS_ENABLED` (start false);
   - `ENGAGE_APPROVAL_THRESHOLD`;
   - the rate and cap settings;
   - `ADMIN_MODULE_ROLES` in inov8r-admin.
4. Apply the migration (alone).
5. iOS: confirm the push entitlement covers background (silent) pushes for test-send refresh. `content-available` is allowed with the existing APNs setup.
6. App Store and Play: the next releases carry the "Tips & offers" consent UI. Mention it in the review notes.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Marketing push without proper opt-in leads to App Review rejection (4.5.4) | Consent gate enforced on the server; category on every campaign; the linter |
| Spammy volume or user churn | Global caps, weekly marketing cap, approval threshold, global control group to measure harm |
| Feed clutter fighting first-party cards | Engage feed cards pass through the existing guardrails; density caps |
| Duplicate logic with Experiments, Promos and Campaigns | Explicit absorb list (spec §16); adapters, then deletion |
| Previews mislead | Tier-1 previews labelled "approximation"; tier-2 test send is the ground truth; tier-3 CI renders |
| Scale | SQL compiler, facts table, keyset paging, rollups; load test before broadcast use |
