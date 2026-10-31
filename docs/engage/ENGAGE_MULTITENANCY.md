# Engage across Inov8r Labs apps: FitCircle, BuyForBaby, TripWiz

**Status:** Design recommendation · 2026-10-30
**Read with:** `ENGAGE_V2_SPEC.md`, which describes the product. This document describes how one Engage serves several apps.

## 1. Requirement

The same tool and the same engine should run campaigns, push, in-app messages, cards, email and journeys for **FitCircle**, **BuyForBaby (BFB)** and **TripWiz**, and for future apps. Each app keeps its own users, data and brand. Building Engage for a new app should mean **integrating against a contract**, not rebuilding it.

## 2. What the three apps have in common (surveyed 2026-10-30)

| | FitCircle | BFB | TripWiz |
|---|---|---|---|
| Backend | Next.js 15, Vercel | Next.js 15.5, Vercel; one deployment serves IN/CA/US by domain; native API `/api/v1/*` | **Next.js 14.2**, Vercel |
| Database / Auth | Own Supabase project, Supabase Auth, UUID user IDs | Own Supabase project (`celgaqzrrpjdtpduvumu`), UUID | Own Supabase project (`bqetkvrxqgdbtzphoakw`), UUID |
| iOS | SwiftUI + TCA, SPM, iOS 17+ | SwiftUI + Combine, **no packages at all**, **iOS 26+** | SwiftUI + Swift 6 concurrency, XcodeGen + SPM, iOS 17+ |
| Android | Compose, Hilt, Retrofit/OkHttp 4 | Compose (M3 Expressive, Nav 3), Hilt, **Retrofit 3 / OkHttp 5**, minSdk 28, multi-module | Compose, Hilt (kapt), Retrofit 2.11 / OkHttp 4, Supabase-kt + Ktor, minSdk 26 |
| Push | FCM v1 for both platforms; `push_tokens`; `NotificationOrchestrator` (caps, quiet hours) | **iOS: direct APNs (http2 + ES256)**, Android FCM; `push_devices` (has `app_version`); `sendPushToUser` | FCM for both platforms; `push_tokens` (incl. web); `createNotification` pushes every in-app notification |
| Email | Resend | Resend (+ suppression list, react-email, lifecycle crons) and some SES | Resend (+ inbound) |
| Analytics | Amplitude (+ codegen), Firebase, Meta, PostHog | Amplitude, PostHog, GA (iOS uses raw HTTP) | Amplitude, PostHog, GA (+ codegen) |
| Flags / experiments | `feature_flags`, experiments system | Flag targeting (bucket, overrides) | Env-var flags only |
| Capability header | `X-Client-Features`, `X-App-Platform/Version/Build` | API version header | `X-TripWiz-Features` |
| Admin API auth | `Bearer ADMIN_API_SECRET` + `X-Admin-Actor` (used by Admin Tools) | Supabase user `is_admin` | `x-admin-secret` + `ADMIN_EMAILS` |
| In Admin Tools registry | Yes | No | No |
| Brand | Dark; purple/cyan; icon keys | Rose `#BD3255` / sunset, Quicksand (web) / SF Pro Rounded | Pink/rose, Poppins |

**Conclusion.** The stacks are close enough for **one engine and one wire protocol**. What differs is push transport, client dependency policy, Android library versions, admin authentication and branding. All of these can sit behind adapters.

## 3. Options

### A. Central Engage service (the Braze model)
A single Engage backend and database. Every app streams user attributes and events to it over an ingestion API, and every client SDK talks to Engage directly.
- **Pros:** one deployment; a cross-app tool with no per-app installs; a natural multi-tenant schema (`tenant_id` everywhere).
- **Cons:**
  - **Targeting is only as good as what gets copied.** FitCircle's richest segments (streaks, circles, meals, subscription, journey state) live in its own database, so each app must keep Engage's profile store in sync, which is a whole subsystem.
  - The home feed composes cards server-side in FitCircleBE, so it would need a call to another service on its hot path (250 ms budget).
  - GDPR deletion and export have to fan out across systems.
  - Push credentials for all apps sit in one service, which makes its blast radius larger.
  - It's a new production system to run and monitor.

### B. Shared engine embedded in each app ("library + protocol")
Each app's backend installs the **Engage server package**. Engage tables live **in that app's own database** and the delivery APIs are mounted in that app's API. Small per-app **adapters** cover user facts, push sending, consent, events and auth. One **multi-app tool** talks to each app's `/api/admin/engage/*` through Admin Tools' existing per-app registry and proxy. Clients use shared **Engage SDKs** (Swift, Kotlin, Web) that speak the same protocol to their own app's backend.
- **Pros:**
  - Segments join **directly** to app tables, giving the richest targeting with no data sync.
  - No new data plane, no cross-app personal data, and per-app isolation by construction.
  - Each app keeps its own push stack and caps; FitCircle's orchestrator stays in charge.
  - Fits Admin Tools, which is already built as a multi-app registry with per-app base URL and secret.
- **Cons:**
  - Version skew: three backends upgrade the package on their own schedule. Mitigated by the protocol version, contract tests and Renovate-style bumps.
  - Migrations are installed per app database (the package ships SQL templates).
  - The package must run on Next.js 14 and 15.

### C. Central control plane, per-app data plane
Campaign definitions, assets and the tool live centrally, and each app pulls definitions and runs delivery locally.
- **Pros:** one source of campaign truth; cross-app campaigns.
- **Cons:** you build both A's sync and B's engine. Cross-app campaigns aren't a real need: the apps have different users, IDs and brands.

## 4. Recommendation: **B, an Engage protocol plus a shared engine, SDKs and a multi-app tool**

```
inov8r-engage/                          (new monorepo; private)
├── protocol/        Engage Protocol v1: JSON Schemas + OpenAPI + golden fixtures + TS types
│                    (content@1, layouts, actions, /sync, /events, /session, /admin/*, push payload keys)
├── packages/
│   ├── server/      @inov8r/engage-server   — engine: campaigns, segment compiler (tree→SQL),
│   │                assignment, eligibility, caps, dispatcher, journeys, stats rollups,
│   │                route-handler factories (Next 14+15), migration templates, admin auth middleware
│   ├── adapters/    reference adapters: supabase-users, fcm-push, apns-push, resend-email
│   ├── web/         @inov8r/engage-web     — React renderers for every layout + WebEngage runtime
│   │                (also the tool's exact web preview)
│   └── preview/     @inov8r/engage-preview — iOS/Android device-frame renderers for the tool
├── ios/EngageKit/   Swift Package: protocol models, store, sync, event queue, image cache,
│                    trigger engine, SwiftUI layouts (theme-injected), action router protocol.
│                    Zero third-party dependencies, iOS 17+.
├── android/engage/  Kotlin libs: :engage-core (models, store, sync, rules; kotlinx.serialization,
│                    transport interface — default HttpURLConnection, optional OkHttp adapter),
│                    :engage-compose (layouts, theme-injected), :engage-push (FCM helpers)
└── tools/           conformance test runner (hits an app's endpoints with fixtures), CLI
                     (`engage migrate` → writes SQL into the app's supabase/migrations)
```

### 4.1 The contract: Engage Protocol v1
- **Wire format:**
  - `GET /engage/sync`, `POST /engage/events`, `POST /engage/session`;
  - home-feed card `promo@2` content (for apps with a server-driven feed) or the `placement:home` fallback;
  - push payload keys (`engageSendId`, `engageCampaignId`, `variantId`, `screen`, `params`, `image_url`, `buttons`);
  - the admin API surface used by the tool.
- **Capability negotiation:**
  - `X-Engage: 1`;
  - `X-Engage-Layouts`, `X-Engage-Actions` and `X-Engage-Placements`;
  - app platform, version and build headers, with a **per-app alias table** so existing headers keep working: FitCircle's `X-App-*` and `X-Client-Features`, TripWiz's `X-TripWiz-Features`, and BFB's API version.
- **Conformance:** a CLI runs golden fixtures against any app's staging endpoints. Each app and each SDK release must pass it. This is what "apps build against a protocol" means in practice.
- **Each app's endpoint prefix is configurable:** FitCircle `/api/mobile/engage/*`, BFB `/api/v1/engage/*`, TripWiz `/api/engage/*`.

### 4.2 What each app implements (adapters, roughly 1–3 days per app)

| Adapter | FitCircle | BFB | TripWiz |
|---|---|---|---|
| `UserFacts` (fields for segments, by SQL views over app tables) | Streaks, circles, meals, sub state, journey | Orders, registry, baby stage, country/domain, consent | Trips, destinations, dates, group, sub |
| `PushSender` (Engage hands it a rendered payload; the app enforces its own caps) | → `NotificationOrchestrator.send` | → `sendPushToUser` (APNs + FCM) | → FCM `push.ts` |
| `EmailSender` | Resend shell | Resend + react-email + suppression list | Resend |
| `Consent` | `engage_consent_v` (4 stores) | Suppression list + prefs | Prefs |
| `Events` (domain events into `engage_events`) | RevenueCat/Stripe webhooks, streak claims, referrals | Orders, registry events | Trip created/joined, bookings |
| `Screens` (deep-link and action registry, declared to the tool) | `open_screen` targets, paywall… | `PushDestination` routes | App routes |
| `Theme` (token map, fonts, icon set) | Dark purple, icon keys | Rose/sunset, SF Pro Rounded / Quicksand | Pink/rose, Poppins |
| `AdminAuth` | Existing bearer + `X-Admin-Actor` | **Add** a bearer-secret admin path (keep `is_admin` for its own UI) | **Align** `x-admin-secret` with bearer + `X-Admin-Actor` |

**Tenancy inside one app:** BFB serves three countries from one deployment, so `market` (IN/CA/US) is a first-class targeting field and the default audience scope, and the tool shows a market selector for BFB.

### 4.3 Data
- **Engage tables live in each app's own Supabase project**, created from the package's migration templates. Same names (`engage_*`) and no stored procedures, following FitCircle's rule and adopted for all three.
- No `tenant_id` column is needed inside an app; the tenant is the deployment.
- **No personal data crosses apps.** The tool reads each app only through that app's admin API.
- **Cross-app reporting** (optional, P2): a portfolio view in the tool that aggregates each app's `engage_stats_daily` through its admin API. Only aggregates, never users.

### 4.4 The tool (multi-app)
- **Location:** `inov8r-admin`, served at **`engage.inov8rlabs.com`** (see `ENGAGE_TOOL_HOSTING.md`).
  - An **app switcher** (FitCircle · BuyForBaby · TripWiz), with `/[appId]/…` routes like Admin Tools' existing `apps/[appId]/[module]` structure.
  - Each app gets an `AppConfig` (base URL, secret env, modules incl. `engage`, branding).
- **Per-app settings** live in each app's database, so each app owns its own data:
  - caps, quiet hours, approval threshold;
  - the screens and actions registry;
  - placements;
  - the theme preview tokens.
- **Roles are per app and per module**, for example Anki as `engage:editor` on BFB and `viewer` on FitCircle.
- **Previews use each app's theme**, read from that app's `/admin/engage/theme`. The native frames are generic and filled with the app's tokens, fonts and icon set.

### 4.5 Client SDKs: library vs. per-app custom
- **Shared** (SDK): protocol models, sync, cache, event queue, trigger and calm-moment engine, caps, image cache and prefetch, impression tracking, the layout views (theme-injected) and test-send handling.
- **Per app** (host integration, about 1–2 days per platform):
  - mounting the in-app message host;
  - mapping "busy" states into calm moments (paywall, onboarding, camera);
  - implementing `EngageActionRouter` (deep links to the app's screens);
  - providing an `EngageTheme`;
  - choosing placements;
  - forwarding analytics events.
- **Distribution:**
  - iOS: Swift Package from a git tag. Dependency-free, so it's acceptable for BFB's no-packages policy; review with the BFB owner.
  - Android: GitHub Packages Maven (or a composite build from a git submodule). The core avoids pinning OkHttp or Retrofit, because BFB uses OkHttp 5 and TripWiz OkHttp 4.
  - Web: private npm on GitHub Packages.
- **Versioning:** SemVer per SDK. The protocol has its own major version, and the server supports N and N-1 protocol majors.
- **Why not one cross-platform UI kit** (Compose Multiplatform or Skip)? Native SwiftUI and Compose already exist in v1, and each app's design system must look native. A shared protocol plus native SDKs is the industry pattern (Braze, Iterable, Airship).

## 5. What this changes in the FitCircle plan

1. **Build FitCircle first, but inside the library boundary from day one.** The v1 code is ported **into `inov8r-engage`** rather than back into FitCircleBE/iOS/Android, and FitCircle consumes it as package version `0.x`. Extracting it later would mean doing the port twice.
2. **Cost:** about **+25–30%** on the FitCircle MVP (packaging, adapters as interfaces, conformance suite, publishing, theme injection). In return, BFB and TripWiz become **adapter-and-integration projects of roughly 1.5–2 weeks each**, instead of about 6 weeks each.
3. The FitCircle-specific parts stay in FitCircle:
   - home-feed integration (`promo@2` source in `composeFeed`);
   - orchestrator push adapter;
   - consent view;
   - Experiences linkage;
   - absorbing `SYSTEM_PROMOS`.
4. **Admin Tools gains:** `registry.ts` entries for BFB and TripWiz, a generic `engage` module whitelist, an app switcher and per-app roles.
5. **New phase E0b in the finish plan:** create the monorepo, CI, publishing, the protocol package and fixtures, and the conformance CLI.

## 6. Onboarding a new app (target: under 2 weeks)
1. Add `@inov8r/engage-server`, run `engage migrate`, and apply the migration alone.
2. Implement the 8 adapters (§4.2) and mount the route handlers.
3. Add an `AppConfig` in Admin Tools and set the admin secret.
4. Add EngageKit (iOS) and engage-android (Android), then implement the host integration (router, theme, calm moments, placements) and the push-open hook.
5. Pass the conformance suite on staging, run a test send on devices, then turn on the kill switch per platform.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Package version skew across 3 backends | Protocol N/N-1 support; conformance in each app's CI; automated bump PRs |
| An SDK looks off-brand in one app | Theme injection; per-app snapshot tests in each host app |
| BFB's no-dependency policy | EngageKit has zero dependencies; get owner sign-off |
| Next.js 14 (TripWiz) | Route-handler factories use only Web `Request`/`Response`; CI matrix on 14 and 15 |
| Different push transports | Engage never sends directly; it calls each app's `PushSender` adapter |
| Admin auth divergence | `@inov8r/engage-server` ships the admin auth middleware (bearer + `X-Admin-Actor` → app admin lookup) |
