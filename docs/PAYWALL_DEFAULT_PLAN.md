# Paywall default plan: set from Admin Tools

The plan a paywall pre-selects, and the plan that carries the "Most popular" badge, come from remote config. That way Admin Tools → Remote config can change them without an app release. Both default to **annual**.

Ships in **iOS 1.1.4 (build 98+)** and **Android 1.1.4 (versionCode 61)**. Older apps keep their built-in monthly default.

## 1. Remote config keys (`app/lib/remote-config/registry.ts`)

| Key | Type | Options | Code default | Meaning |
|---|---|---|---|---|
| `paywall_default_plan` | enum | `annual`, `monthly` | `annual` | Plan pre-selected when a paywall opens |
| `paywall_badge_plan` | enum | `annual`, `monthly`, `none` | `annual` | Plan whose row shows the "Most popular" badge (`none` = no badge) |

Both keys resolve through `RemoteConfigService.enumValue(key, ctx)` (the enum accessor of the same resolver as every other key), so admin defaults and rules work as usual (platform, app version, country, experiment, user). The ctx takes `platform` / `appVersion` / `country` from the request headers (`X-App-Platform`, `X-App-Version`, `x-vercel-ip-country`), as the other mobile routes do. They are listed in `CLIENT_VISIBLE_KEYS`, the only keys a client endpoint may serve. No migration: values are stored as JSON strings in the existing `remote_config_defaults.value` / `remote_config_rules.value` jsonb columns, and invalid stored values fall through to the next source (rule → admin default → code default).

## 2. Endpoint

`GET /api/mobile/paywall/config` (`apps/web/app/api/mobile/paywall/config/route.ts`). Mobile auth is optional: it works signed out, because the onboarding paywall can appear before sign-up completes. It uses `verifyMobileAuth` (Bearer token, or web session cookie); no token, an invalid token, or an auth error all resolve with an anonymous ctx (`userId: null`). Middleware doesn't gate `/api/*`, so the route is reachable signed out. Response `cache-control: no-store`.

```json
{ "success": true, "data": { "defaultPlan": "annual", "badgePlan": "annual" }, "error": null, "meta": { "requestTime": 12 } }
```

- `meta` carries `requestTime`, plus `degraded: true` when the code defaults were served because of an error. Clients should ignore `meta`.
- **Signed out**, admin defaults and request-only rule conditions apply (`platforms`, `appVersionGte/Lt`, `countries`). User-scoped conditions never match: `userIds`, `percent`, `channels`, signup dates and `experiment`. (`excludeUserIds` excludes nobody.) No per-user rows are read. To target one experiment arm, the user must be signed in; the onboarding paywall can still use the arm's own rule (step 3.2.2 below).

- Values are exactly the registry options. Clients must treat any unknown value as the fallback (`annual`).
- The route never fails because of config: on any internal error it returns the code defaults with 200.

## 3. Client behaviour (iOS and Android identical)

1. **Prefetch.** Fetch the config at app launch and on sign-in, without blocking, and cache it on the device (UserDefaults or DataStore, key `paywall_config_v1`, holding `{defaultPlan, badgePlan, fetchedAt}`).
2. **On paywall open,** pre-select in this order:
   1. an explicit request plan: deep-link `plan=` / caller preselect;
   2. the experiment arm's own rule, i.e. variantB `annualOnly`;
   3. the cached `defaultPlan`;
   4. the built-in fallback, `annual`.
3. **Refresh while open.** The paywall also re-fetches the config with a short timeout (~1.5 s). If the fresh value arrives **before the user has touched a plan**, apply it; otherwise ignore it. The paywall never waits for config to render.
4. **Unavailable plan.** If the chosen plan isn't in the offering, fall back to the other plan, then to the first available.
5. **Badge.** Show "Most popular" on the `badgePlan` row only if that plan exists in the offering; `none` hides it. Style it as a small pill on the row's top edge, in the existing accent colour, and keep it visible in dark mode.
6. **Annual price.** Show the per-month equivalent on the annual row, e.g. "$2.50/mo" with "$29.99/yr" under it. Use the store's price locale; the per-month figure is the annual price ÷ 12, rounded down to the cent, never rounded up.
7. **Trial copy.** The trial copy stays store-driven, now 7 days. The CTA and the terms line must name the *selected* plan's real post-trial price and period ("7 days free, then $29.99/year").
8. **Every paywall** gets this: the onboarding paywall (all arms), standard and contextual paywalls, and the Locked screen.

## 3a. The paywall says exactly what the store sheet will say

The paywall must never promise anything the App Store or Google Play sheet doesn't repeat.

- **Prices:** billed amounts use the store's own formatted price string. The per-month equivalent is the only computed figure, and it's always secondary to the billed amount ("$29.99/year", then "$2.50/mo" smaller beneath it).
- **Trial wording** follows the store offer's period, in the same unit the sheet uses: iOS "1 week free", Play "7-day free trial".
- **Charges:** show "Due today $0", then "Then $29.99/year starting <date>". The date is today plus the offer period, in the user's calendar, medium date style. The post-trial price has the same prominence as the trial.
- **No eligibility, no trial copy.** If the user isn't eligible (iOS: RevenueCat says ineligible, or unknown and not promoted by the server; Play: no free phase), no paywall copy mentions "free" or a trial. The CTA is "Subscribe", and the price is due today.
- **Reminders:** promise a reminder before the trial ends only if one is actually sent.
- **Tests:** string tests pin these cases on both platforms: eligible annual, eligible monthly, ineligible or unknown, and non-USD locales.

## 4. Analytics

Add `default_plan` (`annual`|`monthly`) and `default_plan_source` (`request`|`experiment`|`remote`|`cached`|`fallback`) to **Paywall Viewed** in `analytics/tracking-plan.json`, bump the plan version, and regenerate the clients with the existing codegen. `plan` keeps meaning the currently selected plan.

Done in tracking plan **v34** (new enums `default_plan` and `default_plan_source`; both properties are optional). `default_plan` is the plan actually pre-selected, after the unavailable-plan fallback (§3.4). `default_plan_source` is the step of §3.2 that supplied it. The same v34 bump adds `intro_eligibility` (`eligible`|`ineligible`|`unknown`|`server_promoted`) and `trial_days_offered` (int, optional) to Paywall Viewed, Paywall Plan Selected, Purchase Started / Completed / Cancelled / Failed and Checkout Exit Reason. On those events `trial_eligible` now means the selected or bought plan starts with a free trial the store will honor. Regenerate in each client repo from FitCircleBE:

```sh
node analytics/codegen.mjs --only ios       # → ../FitCircle-iOS/FitCircle/Core/Analytics/AnalyticsEvents.generated.swift
node analytics/codegen.mjs --only android   # → ../Fitcircle-Android/FitCircle/app/src/main/java/com/fitcircle/app/core/analytics/AnalyticsEvents.generated.kt
```

Use `IOS_REPO=<path>` or `ANDROID_REPO=<path>` for a worktree. Generated API: Swift `AnalyticsEvents.paywallViewed(..., defaultPlan: DefaultPlan?, defaultPlanSource: DefaultPlanSource?)`, Kotlin `paywallViewed(..., defaultPlan: DefaultPlan?, defaultPlanSource: DefaultPlanSource?)`.

## 5. Compatibility

- Old apps never call the endpoint and keep monthly.
- If the backend isn't deployed yet, new apps use annual.
- Admin Tools needs no code if the Limits page lists registry keys generically, including enum keys. If it doesn't, add enum support there.
  - **Status (2026-11-13):** the Limits page (`inov8r-admin`, `components/modules/limits/`) lists every registry key from `GET /api/admin/remote-config`, but it can only edit `int` keys. Enum keys show as read-only: "Add rule" is disabled, and the default editor's number parser rejects `annual`. Until enum editing ships there, set these keys through the admin API, which already validates enum values: `PUT /api/admin/remote-config/{key}/default {"value":"monthly"}` and `POST /api/admin/remote-config/{key}/rules`.
