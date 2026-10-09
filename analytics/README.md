# FitCircle product analytics

One tracking plan, three clients (iOS, Android, web), any number of providers.

```
analytics/tracking-plan.json   ← the only place events, properties and user properties are defined
analytics/codegen.mjs          ← generates typed constructors for each client
  → apps/web/app/lib/analytics/events.generated.ts
  → FitCircle-iOS/FitCircle/Core/Analytics/AnalyticsEvents.generated.swift
  → Fitcircle-Android/.../core/analytics/AnalyticsEvents.generated.kt
```

## Changing the plan

1. Edit `tracking-plan.json` (follow `conventions` inside it).
2. `node analytics/codegen.mjs` — rewrites all three generated files (mobile repos must be siblings of FitCircleBE, or set `IOS_REPO` / `ANDROID_REPO`).
3. Instrument the call sites, commit each repo.
4. Register new events/properties in the Amplitude tracking plan (both FitCircle projects).

`npm run analytics:check` (CI) fails when a generated file is stale.

Shipped event names are frozen: rename in the analytics tool (display name), never in code, or history splits.

## Client architecture (identical on every platform)

```
call site ──► AnalyticsEvents.mealLogged(...)  (generated, typed)
          ──► Analytics.track(payload)          (facade)
                 ├─ adds global props: platform_app, environment, app_build
                 ├─ privacy backstop: drops blocked keys (health values, email, name, free text)
                 ├─ debug: asserts the name is in the plan
                 └─ fan-out to every enabled provider
                       AmplitudeProvider   (AMPLITUDE key set)
                       PostHogProvider     (POSTHOG key set)
                       SentryBreadcrumbs   (event name only)
                       ConsoleProvider     (debug builds)
```

Facade API: `track(payload)`, `screen(name)`, `identify(userId, userProperties)`, `setUserProperties(userProperties)`, `reset()`, `flush()`, `setOptOut(bool)`.

Provider interface: `start()`, `track(name, props)`, `identify(userId, set, setOnce)`, `setUserProperties(set, setOnce)`, `reset()`, `flush()`, `setOptOut(bool)`.

**Switching or adding a provider** = set or clear its key in build config (iOS Info.plist / Xcode Cloud env, Android Gradle property / CI env, web `NEXT_PUBLIC_*`). No call site changes. A new vendor = one new provider class registered in the facade.

## Identity

- `user_id` = FitCircle profile UUID on every platform, so one person's iOS, Android and web activity is one Amplitude user.
- `identify` on sign-up, login and session restore, before the `Sign Up Completed` / `Login Completed` event.
- On logout: track `Logout`, then `reset()` (new anonymous device id, user id cleared).
- User properties are the canonical set in the plan; `setOnce` keys (signup_method, signup_platform, account_created_date) are only ever set once.

## Amplitude projects (org Inov8r Labs, 380426)

| Project | Who sends | Key |
|---|---|---|
| FitCircle (746168) | App Store / Play / production web | `d0229f4c11c291cb0cb2204620bc9657` |
| FitCircle Dev (875589) | Debug, QA, Dev (Firebase) builds, local/preview web | `e03771b97db31e206aa90890ad502122` |

Dashboard: [FitCircle — Product Funnels](https://app.amplitude.com/analytics/inov8rlabs-545043/dashboard/oqek3fnj). Amplitude can't chart an event it has never received, so funnels for new events (activation, onboarding drop-off, circle loop) are added once the new builds send them.

Client API keys are publishable. Never ship a secret key in a client.

## Autocapture and quota

The org is on Amplitude Starter (2M events/month). Mobile autocaptures sessions and app lifecycle only; web autocaptures sessions, page views and attribution only (no element/form clicks). Session Replay is off unless `NEXT_PUBLIC_AMPLITUDE_REPLAY_SAMPLE_RATE` is set: FitCircle screens show health data, so replay always uses conservative masking.

## Revenue

Client `Purchase Completed` events power the paywall funnel. Authoritative revenue, renewals, cancellations and refunds should come from RevenueCat's Amplitude integration (server-side), which also covers web (Stripe) purchases made through RevenueCat.
