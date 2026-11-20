# Release 1.1.5: engagement and conversion — implementation contract

Status: **spec, not built** (2026-11-13). Backend (`FitCircleBE`, branch off `origin/main`), iOS (`FitCircle-iOS`, off `release/1.1.4`) and Android (`Fitcircle-Android`, off `release/1.1.4`) build from this in parallel.

Founder decisions F1–F6 are fixed. Where this spec had to choose, the choice is listed in §11 ("Decisions made in this spec") and the open questions are in §12.

Shared rules for every section:
- No stored procedures or triggers. Migration 138 is plain DDL.
- No invented data. Every number in copy is the user's own number or a store price.
- Every push goes through `NotificationOrchestrator.send()`, so the duplicate guard, audience gate, category toggles, daily cap and quiet hours all apply.
- Every server change is additive for 1.1.2–1.1.4 clients (§9).
- Version rules use `X-App-Version` (TRIAL_FIRST_SPEC §6.6). Capability switches use `X-Client-Features`.

---

## 0. Summary of server surface

| # | Feature | New / changed server surface |
|---|---|---|
| F1 | Paywall | Default plan / badge / price / disclosure: **already in 1.1.4** (PAYWALL_DEFAULT_PLAN.md, `GET /api/mobile/paywall/config`). 1.1.5 adds only eligibility instrumentation (tracking plan v35) and `entitlements.clientConfig` for the F4 / F6 switches. |
| F2 | Meal scans | Remote config `free_food_ai_daily_after_total`. A daily phase in `UsageService`. Entitlements `allowances.foodScans`. Food UPGRADE_REQUIRED `details.allowance`. |
| F3 | Fitzy | Remote config `free_fitzy_messages_per_week`. A weekly window in `UsageService`. Entitlements `allowances.fitzy`. Chat response and stream add `limit`, `window`, `resetsAt`. `fitzy_message_log.tier` / `.context` (migration 138). |
| F4 | Circles | `GET /api/mobile/food-log/share-targets`. `POST /api/mobile/food-log/{id}/share`. Optional `share_circle_ids` on create and PATCH. Table `meal_share_circle_prefs` and column `food_log_entries.share_circle_ids` (migration 138). Meal card payload adds `image_width`, `image_height`. |
| F5 | Don't miss twice | Push type `dont_miss_twice`. Cron `/api/cron/dont-miss-twice`. Re-sequencing with win-back, momentum and meal reminders. Kill switch `DONT_MISS_TWICE_PUSH_ENABLED`. |
| F6 | Streaks | Push types `streak_save_offer` (new) and `milestone_achieved` (existing type, now sent). `GET /api/mobile/streaks/save-offer`. `GET/POST /api/mobile/streaks/celebrations`. Table `streak_save_offers` (migration 138). Client feature `streak_celebration_v1`. |

**New `X-Client-Features` token (both 1.1.5 apps):** `streak_celebration_v1`. It means "this app shows the streak milestone celebration in-app from `meta.streak.milestone` and from `GET /streaks/celebrations`". Append it to the existing list:
- iOS: `AppClientHeaders.features` in `FitCircle/Core/Network/APISession.swift`.
- Android: `ClientInfoInterceptor.FEATURES` in `core/network/ClientInfoInterceptor.kt`.

Every other 1.1.5 behaviour is gated on app version (remote config rules) or on new optional request fields. No other new tokens are needed.

**Platform files.** iOS paths below are relative to `FitCircle-iOS/FitCircle/`. Android paths are relative to `Fitcircle-Android/FitCircle/app/src/main/java/com/fitcircle/app/`.

---

## 1. F1: paywall and checkout (all paywalls, onboarding included)

### 1.1 Already specified for 1.1.4: reference, do not re-build

The annual default, the "Most popular" badge, the per-month price and the "say exactly what the store sheet says" rules ship in **1.1.4** under `FitCircleBE-paywalldefault/docs/PAYWALL_DEFAULT_PLAN.md`. That contract is canonical:
- remote config `paywall_default_plan` / `paywall_badge_plan`, served by `GET /api/mobile/paywall/config`;
- the client pre-select order (§3.2 of that doc);
- the badge; per-month = annual ÷ 12 **rounded down**;
- "Due today $0 / Then $X starting <date>";
- no trial copy without eligibility;
- the reminder promise only when one is actually sent;
- Paywall Viewed `default_plan` / `default_plan_source` (tracking plan **v34**).

1.1.5 adds **no** paywall-default logic of its own.

**Rule for every new 1.1.5 paywall:** `food_scan_limit` (§2.4), `fitzy_weekly_limit` (§3.4) and `streak_save` (§5.3) all render through the same paywall component. They get their pre-selected plan, badge and disclosure from that contract (the cached `paywall_config_v1`, then the fallback). **None of them may hard-code annual.** They pass no explicit `plan=`, so the remote `defaultPlan` applies. Each one gets a Paywall Viewed with `default_plan_source` like any other placement.

### 1.2 1.1.5 additions: intro-offer eligibility instrumentation

What exists today:
- `trial_eligible` is on Paywall Viewed, Purchase Started, Purchase Cancelled, Purchase Failed and Checkout Exit Reason.
- iOS gets it from RevenueCat `checkTrialOrIntroDiscountEligibility`; Android from `defaultOption.freePhase`.
- Purchase Cancelled already carries `source`, `plan`, `store`, `seconds_in_sheet` and `store_response_code`.

Gaps to close:

1. **New property `intro_eligibility`** (enum, values below) on **Paywall Viewed, Purchase Started and Purchase Cancelled**, on both platforms.

   | Value | iOS | Android |
   |---|---|---|
   | `eligible` | RevenueCat `.eligible` for the selected product | selected package `defaultOption.freePhase != null` |
   | `ineligible` | `.ineligible`, or the product has no `introductoryDiscount` | no free phase |
   | `unknown` | `.unknown` (today reported as `trial_eligible=false`) | offerings / phases unavailable |
   | `server_promoted` | an `unconfirmedIntroOffer` promoted by the server hint (`promotingUnconfirmedIntro()`) | `TrialOfferRepository` used the server `trialEligible` because the store had no answer |

   - UI copy follows PAYWALL_DEFAULT_PLAN §3a: trial copy only for `eligible` / `server_promoted`.
2. **One meaning for `trial_eligible`.** On both platforms it means "the **selected** plan (Paywall Viewed) or the **bought** plan (Purchase Started / Cancelled / Failed, Checkout Exit Reason) offers a free phase to this user".
   - iOS today means "any plan has a trial". Change it in `PaywallFeature` `trackViewedIfNeeded` and the purchase events.
   - Android already means the package being bought; check that Paywall Viewed uses the pre-selected package.
3. **New property `trial_days_offered`** (int, optional) on the same three events: the free-phase length in days from the store offer (iOS `subscriptionPeriod` value × unit; Android parsed `P7D` / `P1W`). Omit it when there is no free phase.

| | iOS | Android |
|---|---|---|
| Per-product eligibility value | `PurchasesClient.offerings` (`Core/Services/PurchasesClient.swift` ~89–135): keep `IntroEligibility` on `PlanOption` (`Core/Models/Subscription.swift`) | `Package.offersFreeTrial()` (`features/paywall/PaywallViewModel.kt:231`) + `TrialOfferRepository` (`core/billing/ProGate.kt:83`) |
| Events | `PaywallFeature` `trackViewedIfNeeded`, `.purchase*` (`Features/Paywall/PaywallFeature.swift`) | `PaywallViewModel` `paywallViewed`, `purchaseStarted`, `purchase()` :655 |

### 1.3 Server

- **Tracking plan v35** (§7), on top of the paywall-default v34. Run `node analytics/codegen.mjs` and commit the generated files to all three repos.
- **Entitlements, additive:** `clientConfig: { mealSharePrompt: boolean, streakSaveOffer: boolean }`, resolved from the §8 keys. Register both keys in `CLIENT_VISIBLE_KEYS` (introduced by the paywall-default work).
  - These could instead be served from `GET /api/mobile/paywall/config`. They are user-scoped, so they ride on the signed-in entitlements call.

### 1.4 Post-release task (no app code)

Save an Amplitude chart, **"Store sheet abandonment 1.1.5"**, in both projects (prod 746168, dev 875589):
- funnel Purchase Started → Purchase Completed, conversion window 30 min;
- breakdown `platform_app`, `source` (placement), `plan`, `intro_eligibility`;
- filter `app_build` ≥ the 1.1.5 builds;
- a companion segmentation: Purchase Cancelled by `intro_eligibility` × `store_response_code`.

Add it to the PMF dashboard and record the chart id in the releases tracker row for 1.1.5.

---

## 2. F2: AI meal scans for free users

### 2.1 Rules

| Phase | Who | Allowance |
|---|---|---|
| `unlimited` | Pro / trial (`subscription_tier` premium/enterprise) | the existing 100/day abuse ceiling (`RateLimited`, never a paywall) |
| `legacy` | `food_ai_unlimited` gate dark | the existing 25/day |
| `starter` | free, lifetime used < `free_food_ai_analyses_total` (21 for apps ≥ 1.1.2 via the existing rule) | `total − lifetimeUsed` |
| `daily` | free, starter allowance used up, `free_food_ai_daily_after_total` > 0 | `daily − dailyUsed` per **local day** |
| `exhausted` | free, starter used up, daily key = 0 (1.1.2–1.1.4, web) | 0 (today's behaviour) |

- **What counts as a scan:** everything `nutrition_parse_log` counts today, i.e. photo, voice, describe, Fix and estimate-item. Only successful analyses keep their row. Client copy says "AI scans", not "photo scans".
- **Lifetime used** is unchanged: the max of the mailbox group and the attested device (`lifetimeFoodAiUsage`).
- **Local day:**
  - The day is the request's `X-Client-Timezone` (`resolveClientTimezone`). If that is missing or invalid, use the profile timezone, then `America/New_York`.
  - `dayStart` = local midnight as a UTC instant.
  - `resetsAt` = the next local midnight.
- **Daily used**, with no double counting across the phase boundary:
  - `T` = rows since `dayStart`, using the same mailbox/device max as lifetime.
  - `L` = lifetime rows.
  - `starterLeftAtDayStart = max(0, total − (L − T))`
  - `dailyUsed = max(0, T − starterLeftAtDayStart)`
  - `dailyRemaining = max(0, daily − dailyUsed)`
  - So the day a user finishes the starter allowance, the scans that day used from the starter do not eat into the daily 2.
- **Reservation** (`reserveFoodAi`) keeps insert-then-count. In the daily phase it refuses when the post-insert `dailyUsed > daily`, deletes the row, and throws `UpgradeRequiredError`, all **before any model call**. The cached-draft path keeps `assertFoodAiQuota` first. So no AI is ever spent on a scan the user is not entitled to.

### 2.2 Remote config (new key)

| Key | Type | Code default | Bounds | Unit |
|---|---|---|---|---|
| `free_food_ai_daily_after_total` | int | **0** | 0–50 | scans per local day after the starter allowance |

**Deploy-time setup:**
- Leave the admin default unset (0).
- Add two rules: `{platforms:['ios'], appVersionGte:'1.1.5'}` → 2 and `{platforms:['android'], appVersionGte:'1.1.5'}` → 2.

**Why version-gate, not give it to everyone.** 1.1.2–1.1.4:
- pre-gate on `limits.foodAiAnalysesRemaining == 0` before uploading (iOS `ProGateSnapshot.foodAILocked`, Android `FoodAiRules.blocked()`);
- show "N free AI analyses left" as a lifetime count;
- get server copy "You've used your 21 free AI food analyses".

Giving them a daily allowance would either do nothing (they never upload) or, if the legacy field reported the daily number, make their meter lie. They get the daily allowance by updating. Requests with no version (crons, web) resolve 0: the win-back copy (`edc0c9f`) and the web meter are unchanged.

### 2.3 API

`GET /api/mobile/entitlements` adds an additive top-level `allowances` object. It is computed for every tier; Pro returns `mode:"unlimited"`.

```json
"allowances": {
  "foodScans": {
    "mode": "starter",
    "remaining": 2,
    "starterTotal": 21,
    "starterRemaining": 2,
    "dailyLimit": 2,
    "dailyRemaining": null,
    "resetsAt": null,
    "timezone": "America/New_York"
  },
  "fitzy": { "...": "see §3.3" }
}
```

| Field | Type | Notes |
|---|---|---|
| `mode` | `unlimited` / `legacy` / `starter` / `daily` / `exhausted` | §2.1 |
| `remaining` | int or null | what the next scan may use right now; null = no product limit (unlimited / legacy) |
| `starterTotal`, `starterRemaining` | int or null | null for unlimited / legacy |
| `dailyLimit` | int or null | the resolved daily key; null when 0 or not free |
| `dailyRemaining` | int or null | set only when `mode=daily` |
| `resetsAt` | ISO instant or null | next local midnight, `mode=daily` only |
| `timezone` | IANA | the zone the day was computed in |

**Legacy fields:**
- `limits.foodAiAnalysesTotal` and `limits.foodAiParsesPerDay` are unchanged.
- `limits.foodAiAnalysesRemaining` = `allowances.foodScans.remaining` when the request resolves the daily key > 0 (1.1.5). Otherwise unchanged (the lifetime remaining).

**Food UPGRADE_REQUIRED** (`photo-parse`, `voice-parse`, `estimate-item`; same 429 envelope). `details` adds `allowance` (the same object as `foodScans`, after the refusal). The daily-phase paywall copy is:
- `details.paywall.headline` "Unlock unlimited scans"
- `details.paywall.body` "You've used today's 2 free scans. They reset at midnight, or go unlimited with Pro."
- the starter phase keeps today's copy.

`message`: as today; the daily variant is "You've used today's 2 free AI scans." plus "We saved your photo so you can add the details." when Option B saved one. Option B (`savedEntryId`) is unchanged.

Backend files:
- `lib/services/usage-service.ts`: `foodAiPlan` gains `daily`. Add `foodScanAllowance(userId, tier, gateLive, tz)`. `countFoodAi` gets a `since` variant.
- `lib/remote-config/registry.ts`
- `lib/services/entitlement-service.ts`
- `lib/fitzy/paywall.ts`: `foodAiPaywall` / `foodAiBody` get a phase.
- the three food routes, for `details.allowance`
- `lib/types/body-composition.ts` (EntitlementsResponse)

### 2.4 Client behaviour (both platforms)

1. **Meter** on the scan entry (camera / library sheet header and the meal preview), free users only, from `allowances.foodScans`. Refresh entitlements after every scan; the local decrement stays.

   | State | Copy |
   |---|---|
   | `starter`, remaining ≥ 2 | "{remaining} of {starterTotal} free scans left" |
   | `starter`, remaining = 1 | "Last starter scan. After this you get {dailyLimit} free scans a day." (if `dailyLimit` is null: "Last free scan") |
   | `daily`, remaining ≥ 2 | "{remaining} of {dailyLimit} free scans today · resets at midnight" |
   | `daily`, remaining = 1 | "Last free scan today · resets at midnight" |
   | remaining = 0 | "No free scans left today · resets at midnight" (`exhausted`: "No free scans left") |

2. **Out of scans** (remaining = 0, known locally):
   - The user can still take or pick the photo.
   - **Do not upload it to photo-parse.** Open the new **scan paywall** (placement `food_scan_limit`), showing their photo:
     - the captured photo as the hero image;
     - headline "Unlock unlimited scans", subhead "Get calories and macros for this meal in seconds";
     - plan pre-selection, badge and disclosure from the paywall config (§1.1); never hard-coded annual.
   - **Purchased** → wait for the server to see Pro (iOS `waitForServerPro`; Android the same entitlement poll used after the Fitzy purchase), then analyze that photo through the normal queue.
   - **Dismissed / "Log it myself"** → open manual / text logging with the photo attached, plus a banner: "Free scans reset at midnight (in {h}h)" (`exhausted`: "Add the details yourself").
     - Never a dead end: the meal still saves (streak auto-claim and sharing included).
3. **Server refusal anyway** (stale entitlements, a second device, an outbox replay):
   - Handle UPGRADE_REQUIRED exactly like (2).
   - If `details.savedEntryId` is present, dismiss opens **that entry** for editing instead of a new form (no duplicate).
   - Purchase re-runs analysis on it with `existing_entry_id` + `skip_fallback_save=true`, which the server already supports.
4. **Background / outbox paths** (iOS `MealAnalysisBackgroundDrain`, Android `analyzeDeferredMeal`) **must send `X-App-Version` and `X-App-Platform`.** Without them the daily key resolves 0 and a daily-phase user is refused. Add a contract test on both platforms.

| | iOS | Android |
|---|---|---|
| Meter | `MealPreviewFeature` (~458, `foodAIRemainingHint`), `PaywallCopy.foodAIRemaining`; read `allowances` in `ProGateClient.swift` (`ProGateSnapshot`) and `EntitlementsService.swift` | `FoodAiRules.hint()` / `FoodAiGate` (`features/nutrition/FoodAiGate.kt`), `PhotoLogScreen.kt:416` |
| Pre-gate → photo paywall | `MealAnalysisFeature` `.analyze` (`.needsPro` → new `.scanPaywall(photo)`); `AppFeature` `.showFoodAIPaywall` (~1318) gets the photo + context `.foodScanLimit` | `PhotoLogScreen.kt:363–381` → new `PaywallContext.FOOD_SCAN_LIMIT` (source `food_scan_limit`) with a photo URI arg; `MainScreen.kt:1133–1165` |
| Purchase → analyze | `.foodAIPaywallOutcome(.purchased)` re-queues the job | resume the held job in `MealAnalysisManager` |
| Dismiss → manual with photo | `MealAnalysisFeature.manualForm(for:)` (already attaches photos) + reset banner | `FoodAiGate.takeForManual()` → `createManualRoute()` **must carry the photo URIs** (add the arg) + banner |
| Server refusal | `parsedFailure` (`isUpgradeRequired`) | `NutritionRepository.toParseFailure()` → `FoodAiLimit.onUpgradeRequired` |

---

## 3. F3: Fitzy, 3 free messages per week

### 3.1 Rules

- **Week:** starts **Monday 00:00 local**, in the request's `X-Client-Timezone` (fallback: profile timezone, then `America/New_York`). `resetsAt` = next Monday 00:00 local. Copy: "Resets Monday".
- **Weekly mode** applies when `free_fitzy_messages_per_week` resolves > 0 for the request. Then:
  - `limit` = the weekly value and `used` = free-tier, non-onboarding messages since the week start;
  - **`free_fitzy_messages_per_day` is ignored for that request.**
- **When the weekly key = 0**, the daily key applies exactly as today. That is 1.1.2–1.1.4 (0/day → first message opens the paywall), old builds (admin default) and web.
- **Pro / trial:** unchanged (200/day abuse ceiling).
- **Onboarding tour exemption** (`ONBOARDING_FREE_FITZY_MESSAGES`): unchanged, and those messages **do not count** toward the week.
- **Counting** needs two new `fitzy_message_log` columns (migration 138), written by `recordFitzyMessage`:
  - `tier` (`free` / `pro`, the tier when the message was sent);
  - `context` (`onboarding` or null).
- The weekly count is `tier = 'free' AND context IS DISTINCT FROM 'onboarding'`.
- Rows from before 138 have `tier` null and are not counted, so the first week is generous by design.
- Messages a user sent while on a trial never count against the free week.

### 3.2 Remote config (new key)

| Key | Type | Code default | Bounds | Unit |
|---|---|---|---|---|
| `free_fitzy_messages_per_week` | int | **0** | 0–100 | messages per local week (Mon 00:00); 0 = off (daily key applies) |

Rules: `{platforms:['ios'], appVersionGte:'1.1.5'}` → 3 and `{platforms:['android'], appVersionGte:'1.1.5'}` → 3. The existing `free_fitzy_messages_per_day` rules stay untouched.

### 3.3 API

**Entitlements** `allowances.fitzy`:

```json
"fitzy": { "mode": "weekly", "limit": 3, "used": 1, "remaining": 2, "window": "week", "resetsAt": "2026-11-17T05:00:00.000Z" }
```

`mode` is one of:
- `unlimited` (Pro, or gate dark) → all other fields null;
- `weekly`;
- `daily`, with `window:'day'` and `resetsAt` = next UTC midnight (today's semantics);
- `locked` (daily limit 0).

`limits.fitzyMessagesPerDay` is unchanged.

**Chat** `POST /api/mobile/fitzy/chat` and the SSE `meta` / `done` events of `/api/mobile/fitzy/chat/stream`:
- `remaining` is as today: remaining after this message, so in weekly mode it is the weekly remaining.
- Additive: `limit` (int or null), `window` (`week` / `day` / null), `resetsAt` (ISO or null).
- Pro: all null, as today.

**Refusal:** the same 429 `UPGRADE_REQUIRED` envelope.
- `details` = `{feature:'fitzy_unlimited', used, limit, window:'week', resetsAt, paywall}`.
- `message` = "You've used this week's 3 free Fitzy messages. They reset Monday."
- `paywall` = `paywallFor('fitzy_quota', …)` with headline "Keep chatting with Fitzy" (trial: `tryProFreeHeadline(days)`), plus the existing bullets and trial copy.
- The check stays **before any conversation write, log row or model call**.

Backend files:
- `lib/services/usage-service.ts`: `assertFitzyQuota`, `fitzyAllowance`, `recordFitzyMessage(userId, {tier, context})`, plus a `countSince` helper;
- `lib/services/fitzy-service.ts` (~461–497, plus the meta / done payloads);
- `lib/fitzy/paywall.ts`, `lib/fitzy/http.ts`;
- `api/mobile/fitzy/chat/route.ts` (~117) and `.../chat/stream`;
- `api/mobile/nutrition-coach/route.ts` (shares the quota);
- `lib/types/fitzy.ts`.

### 3.4 Client behaviour

- **Counter** in the chat header / composer for free users in weekly mode, always visible: "{remaining} of {limit} free messages this week". At 0: "Free messages reset Monday".
  - This replaces the "N free messages left today" pill (today it shows only at ≤ 3).
  - Source: chat `remaining` / `limit` / `window` when present, else `allowances.fitzy`.
- **Pre-send gate:** when `allowances.fitzy.remaining == 0`, keep the draft and open the paywall.
  - Placement `fitzy_weekly_limit`, context Fitzy: Fitzy avatar, headline "Keep chatting with Fitzy", their unsent message quoted. Plan, badge and disclosure come from the paywall config (§1.1).
  - After purchase, send the held message (the existing `pendingSend` / `onProUnlocked`).
  - Today's gate (`fitzy_unlimited.allowed == false`) must **not** block weekly-mode users: they are free, but they have messages left. Gate on `allowances.fitzy.remaining` when `allowances` is present.
- **Server refusal:** the same paywall (the existing backstop paths).

| | iOS | Android |
|---|---|---|
| Gate | `FitzyChatFeature` `.send` / `isSendLocked` (`gate.fitzySendLocked`) | `FitzyChatViewModel.sendBlockedByGate()` (:315) / `Entitlements.fitzyCapped` |
| Counter | `remainingLabel` / `remainingPillThreshold`, `FitzyChatView` ~447 | `FitzyRules.quotaPill()` / `QUOTA_PILL_THRESHOLD`, `FitzyChatScreen.kt:201` |
| Paywall | `.presentPaywall(.fitzyWeeklyLimit)` (new `PaywallContext`, analytics source `fitzy_weekly_limit`) | new `PaywallContext.FITZY_WEEKLY_LIMIT` |
| Decode | `APIClient+FitzyV2.swift` stream meta / done: `limit`, `window`, `resetsAt` (optional) | `FitzyStream.kt` / `FitzyApi.kt` (optional fields) |

### 3.5 Proactive Fitzy comment on the first scanned meal: later, not 1.1.5

No server hook writes an unprompted assistant message into a conversation today. It would need:
- a new conversation write;
- a model call per first meal (an AI cost that does not count against the user);
- a client inbox state.

Nearest existing surfaces:
- iOS `PostMealAha` / `MeetFitzySheet` (after the first AI meal);
- the Day-2 `fitzy_intro` push.

These are listed in §10 Later.

---

## 4. F4: meal logs back in circles

### 4.1 What ee9722c did (Nov 4) and why posts stopped

`ee9722c` made **new meals private unless the user explicitly shares them** (docs/FOOD_ENTRY_PRIVACY_SPEC.md):
- `profiles.preferences.privacy.share_meals_with_circles` defaults to off, and no rows were backfilled;
- the shipped clients' hard-coded `is_private:false` is ignored;
- 1.1.2+ apps show a chip seeded from that default, i.e. "Private".

So meal cards only appear when a user flips the chip per meal or turns on the Settings default. Almost nobody does, and circle chat lost its main content.

What exists that we build on:
- **Per-circle tier:** `circle_food_privacy` (full / summary / private; **no row = `full`**, `DEFAULT_FOOD_PRIVACY_TIER`).
- **Posting:** `CircleMealPostService.onMealLogged` posts a shared meal to every active circle where the owner's tier is `full`. There is a 2 h push rule.
- **Explicit-choice evidence:**
  - **`share_meals_with_circles` stored as `false`** is an explicit user choice. The key only exists if the user used the toggle: iOS reads it read-only (`Core/Models/User.swift:131`), and Android sends `null` on Settings saves (`SettingsViewModel.kt:511`). The dedicated `/food-log/sharing` PUT and the Settings preferences PUT are the only writers.
  - An explicit `circle_food_privacy` row with tier ≠ `full`.

### 4.2 Behaviour

**Meal log success screen.** New on both platforms; neither app has one today (iOS shows a `LoggedMealNotice` banner, Android pops back).

After any food entry saves (photo, voice, manual, search, barcode, re-log from the app; **not** water / supplements, widgets, Watch or Wear), show a sheet:
- "Logged {slot}" + thumbnail + calories (the user's own data, already shown on confirm) + the streak line from `meta.streak`;
- below it, the **Share to circles** card when `clientConfig.mealSharePrompt` is true and `share-targets` returns ≥ 1 circle.

**Share card behaviour:**
- One row per active circle (name, member count, avatar stack), each with a toggle prefilled from `default_on` (§4.3).
- One button: **"Share to {n} circles"**, disabled when n = 0. One tap shares to the toggled circles.
- **Nothing is posted until that tap**, with one exception: if the meal was already saved shared (the chip was on), the card shows "Shared to {names}" with "Edit".
- Toggle changes are **remembered** per circle on share (`remember:true`).
- "Not now" / swipe-down dismisses: the meal stays private and nothing is remembered.
- No circles → no card (the success sheet still shows).

**The confirm-screen chip stays** (FOOD_ENTRY_PRIVACY_SPEC §1, "nothing is shared silently").
- If the user saves with the chip **on**, the create request sends `share_circle_ids` = the circles whose `default_on` is true.
- If no targets are cached, omit the field; the server's legacy rule applies (all `full` circles).

### 4.3 Default for each circle toggle (server-computed; first rule that applies wins)

| # | Condition | `default_on` | `reason` |
|---|---|---|---|
| 1 | `meal_share_circle_prefs` row for (user, circle) | its `share` | `remembered` |
| 2 | `circle_food_privacy` row for (user, circle) with tier ≠ `full` | false | `circle_privacy` |
| 3 | `preferences.privacy.share_meals_with_circles === false` **stored** (explicit) | false | `sharing_default_off` |
| 4 | `preferences.privacy.meals_made_private_at` set (bulk "Make all past meals private", §4.6) | false | `made_private` |
| 5 | circle `is_official = true` or `visibility = 'public'` | false | `public_circle` |
| 6 | active members (incl. the user) > `meal_share_large_circle_threshold` (20) | false | `large_circle` |
| 7 | otherwise (a friend circle: private / invite_only, ≤ 20 members) | **true** | `friend_circle` |

Rules 3 and 4 respect an explicit privacy choice: a user who ever chose "private by default" starts with every toggle off and can still share with one tap. Only circles with `status` active / upcoming are listed.

### 4.4 API

**`GET /api/mobile/food-log/share-targets`** (mobile auth, `Cache-Control: private, no-store`)

```json
{ "success": true, "error": null, "meta": null, "data": {
  "sharing_default": "unset",
  "circles": [
    { "circle_id": "uuid", "name": "Morning Movers", "member_count": 6, "avatar_urls": ["https://…"],
      "default_on": true, "reason": "friend_circle" }
  ]
} }
```

- `sharing_default` is `on`, `off` or `unset` (whether the stored key is true, false or absent).
- `avatar_urls` holds at most 3 entries.
- Circles are ordered by the user's most recent chat activity, then name, with at most 30 rows.

**`POST /api/mobile/food-log/{id}/share`** (owner only; other users get 404)

Request:
```json
{ "circles": [ { "circle_id": "uuid", "share": true }, { "circle_id": "uuid", "share": false } ], "remember": true }
```
- `circles` must include every row the user saw. `remember` defaults to true.

Effect:
- Target = the `share:true` ids ∩ the user's active circles.
- **Non-empty target:**
  - the entry becomes shared (`is_private:false`, `visibility:'circle'`) and `share_circle_ids` = target;
  - it is posted to each target circle that has no live card (push only if eaten ≤ 2 h ago and never posted before, unchanged L10/L11);
  - live cards in circles no longer in the target are retracted **before the response** (`retractMeal` semantics, per circle).
- **Empty target:** the entry becomes private and every card is retracted. This is identical to PATCH `share_with_circles:false`.
- `remember` → upsert `meal_share_circle_prefs` for every listed circle.
- Water / supplements → 400 `UNSHAREABLE`.
- Idempotent.

Response (`200`):
```json
{ "success": true, "error": null, "meta": null,
  "data": { "entry_id": "uuid", "is_private": false, "visibility": "circle", "shared_circle_ids": ["uuid"], "posted": 1, "retracted": 0 } }
```
Errors: `400 VALIDATION_ERROR`, `401`, `404 NOT_FOUND`, `500` (retry-safe).

**Create `POST /api/mobile/food-log` and edit `PATCH /api/mobile/food-log/{id}`** get a new optional `share_circle_ids: uuid[]`.
- It is honoured only together with `share_with_circles:true`.
- Absent → `share_circle_ids` null → **legacy rule** (every active circle with tier `full`). This keeps every shipped client and offline-outbox replay byte-identical.
- PATCH without the field keeps the stored list.
- `share_with_circles:false` → private, and the list is cleared.
- Responses add `share_circle_ids` (uuid[] or null) to the entry; this is additive.

**Where a shared entry is visible** (one helper, `mealVisibleInCircle(entry, circleId)`):
- If `share_circle_ids` is not null → the circle must be in the list (the explicit per-meal choice beats a tier row).
- Else → tier `full` (today).
- Apply it in:
  - `CircleMealPostService.circlesSharingFull` (rename it `targetCircles`);
  - `viewerCanSeeEntry` (the image proxy);
  - `circle-food-feed-service` (feed and reactions);
  - `onMealUpdated`.

**Meal card payload**, additive in `buildPayload`: `image_width` and `image_height` (ints or null, from `food_log_images.width/height` of the primary image), so clients can size the thumbnail before it loads.

Backend files:
- new routes `api/mobile/food-log/share-targets/route.ts` and `api/mobile/food-log/[id]/share/route.ts`;
- `lib/services/food-entry-privacy.ts` + `food-entry-privacy-service.ts` (rules, `defaultOnFor`);
- `lib/services/circle-meal-post-service.ts`, `food-log-service.ts`, `circle-food-feed-service.ts`;
- `api/mobile/food-log/images/[imageId]/route.ts`;
- `api/mobile/food-log/sharing/bulk/route.ts` (writes `meals_made_private_at`);
- `lib/services/data-export-service.ts` (export the new table);
- account deletion (cascade covers it, but add it to the deletion audit list).

### 4.5 Chat image rendering (both platforms)

Today:
- iOS meal card photo: full width × 200pt, aspect-fill, no tap (`SystemPostView.swift` ~202). User photos: 220×220 crop, no tap (`CircleChatView.swift` ~968). No full-screen viewer.
- Android meal card: full width at 4:3, crop (`SystemPostRenderer.kt:217`). User photos: 220dp square crop (`CircleChatScreen.kt:1183`). `ChatPhotoViewer` has **no pinch-zoom** (`ChatImages.kt:166`).

1.1.5:
- **Meal card thumbnail:**
  - width **180 pt/dp** (fixed, leading-aligned inside the card, with title and macros beside or below it);
  - height = 180 ÷ aspect, clamped to **135–240**, using `image_width/height` (unknown → 4:3, i.e. 135);
  - `aspectFill` inside that box, corner radius 12;
  - load `?size=medium`.
- **User photo bubbles:** the same box rule (max 180 wide), aspect from the image once loaded.
- **Tap → full-screen viewer:**
  - black background, `?size=original`;
  - pinch-zoom 1–4×, double-tap toggles 1× / 2.5×, pan when zoomed;
  - swipe down (or close button) to dismiss; VoiceOver / TalkBack label "Photo, double-tap to zoom".
  - Reuse iOS `MealPhotoViewer` (`Features/Nutrition/Components/MealPhotoViewer.swift`) and Android `MealPhotoViewer` (`features/nutrition/confirm/MealPhotoHeader.kt:188`, `transformable`). Replace Android `ChatPhotoViewer`.
  - Images still load through the authenticated proxy (`AuthenticatedAsyncImage` / `ChatAuthImage`).

### 4.6 Migration 138: data and default handling

No entry is re-shared and no `share_meals_with_circles` value is rewritten. The FOOD_ENTRY_PRIVACY_SPEC "no backfill" decision stands. The new default applies only to the success-screen toggles, and sharing still needs a tap. See §6 for the SQL.

- `meals_made_private_at`: from 1.1.5, `POST /food-log/sharing/bulk` writes `preferences.privacy.meals_made_private_at = now()` (server merge, like the other privacy keys).
- **One-off backfill** for bulk actions taken Nov 4–release: `apps/web/scripts/backfill-meals-made-private.ts`.
  - It reads Amplitude `Meal Privacy Changed {surface: settings_bulk}` (server export API) and sets the key for those users.
  - Dry run by default; `--apply` to write.
  - It writes only when the key is absent.
  - Run it once before enabling `meal_share_prompt` in prod.

### 4.7 Client file pointers

| | iOS | Android |
|---|---|---|
| Success sheet (new) | `Features/FoodLog/MealLoggedSheet.swift` (new), presented from `AppFeature` where `loggedNotice` is set today (~1201–1290); data from `NutritionConfirmFeature` `.committed(.success)` (~1109) and `FoodLogEntryFormFeature`; replaces the `LoggedMealNotice` banner for food | `features/foodlog/logged/MealLoggedSheet.kt` (new), shown from `NutritionConfirmScreen` `onCommitted` (`MainScreen.kt:1490`) and `FoodLogEntryViewModel` save |
| Targets / share API | `Core/Network/APIClient+MealSharing.swift` (`MealSharingAPI`: `shareTargets()`, `share(entryId:circles:)`) | `core/data/foodlog/FoodSharing.kt` (`FoodSharingApi`, `FoodEntrySharingRepository`) |
| Create sends ids | `FoodLogMetadata` (`Core/Models/FoodLog.swift`) `shareCircleIds`; outbox `FoodLogEntryLocal` gets an optional `shareCircleIds` (lightweight migration) | `FoodLogEntry` (`core/model/FoodLogModels.kt:200`) `@EncodeDefault(NEVER) shareCircleIds: List<String>?`; Room outbox payload carries it |
| Offline | Share tap before the entry synced → queue a `share` op after the create in the outbox; never drop it | `FoodLogOutbox` follow-up op keyed on the local id |
| Chat thumbnail + viewer | `SystemPostView.swift` `SystemMealCard`, `CircleChatView.swift` bubble; Duo `DuoCircleChatView.swift` | `SystemPostRenderer.kt` `SystemMealCard`, `CircleChatScreen.kt` `MessageBubble`, `ChatImages.kt` |
| Payload decode | meal payload `image_width/height` optional (`Core/Models/ChatMessage.swift`) | `MealCardPayload` (`core/model/ChatModels.kt:346`) optional fields |

---

## 5. F5 + F6: "Don't miss twice", streak save, milestones

### 5.1 Definitions

- **Claimed day:** a local day with a `streak_claims` row. That is any manual log, a check-in, a synced workout ≥ 10 min, or a shield. This is the same signal the streak uses.
- **First missed day D:** D is unclaimed and D−1 is claimed (any streak ≥ 1).
- **Lapse episode** = D. One `dont_miss_twice` **or** one `streak_save_offer` per D, never both, never again for the same D. A new episode starts only after the user claims a day after D.
- **The day after:** D+1 in the user's push zone (`resolveNotificationTimezone`).

### 5.2 The D+1 job (new)

The cron `/api/cron/dont-miss-twice` runs hourly at :10 (add it to `vercel.json`), behind `CRON_SECRET`. Service: `lib/services/dont-miss-twice-service.ts`; pure rules: `lib/journey/dont-miss-twice.ts`.

For each user with an active push token who is in their **send hour** (see "Send hour" below):
1. Kill switches: env `DONT_MISS_TWICE_PUSH_ENABLED=false` → nothing. Remote config `dont_miss_twice_push` = off → nothing for that user.
2. Call `StreakClaimingService.checkAndBreakStreak(userId)` (idempotent). This guarantees the nightly protect-or-break has run in the user's zone.
3. If yesterday (D) is claimed (a shield counts), or today (D+1) is already claimed → skip.
4. If D−1 is not claimed → skip (not a *first* miss).
5. **Pick the type:**
   - `streak_save_offer` when `streak_save_offer` (remote config) = on, and the break result was `broken && !zombieGuard && lostStreak >= streak_save_offer_min_streak (3)`. In practice that means free users with 0 shields; Pro never breaks except through the zombie guard.
     - Write a `streak_save_offers` row (§6) with status `offered`.
   - Otherwise `dont_miss_twice`, with these variants (pure, the user's own data only):

   | Variant | When | Title / body |
   |---|---|---|
   | `shield_saved` | a shield was auto-applied to D | "A shield saved your {n}-day streak" / "Log {slot} today to keep it going." + " That was your last automatic save, so today counts." when `lastAutoProtect`, else " {k} shields left." (Pro: no count) |
   | `meal` | top activity in the last 14 days is food | "Don't miss two days" / "You usually log {slot} around {h}. Snap today's and you're back on track." |
   | `workout` | top activity is workouts (manual or synced) | "Don't miss two days" / "One workout or one meal today and you're back on track." |
   | `streak_restart` | the streak broke and is below the save minimum, or zombie guard | "Yesterday slipped by" / "Log one meal today and day 1 of your next streak is yours." |
   | `plain` | not enough history | "Don't miss two days" / "Log one meal today and you're back on track." |

   - `{slot}` = the user's most-logged slot in the last 14 days (`food_log_entries.meal_type`). `{h}` = the modal local hour of their first log of the day, written "8 am" / "12 pm". No emoji, no invented data.
6. **Send hour:**
   - The modal local hour of the user's first manual log of the day over the last 14 days, clamped to 8–20. Fallback: 12.
   - If the hour falls inside quiet hours → the first hour after quiet hours end.
   - At most once per D (dedupe key).
7. **Send** through the orchestrator. Neither type is deferrable: the job already avoids quiet hours, and a held push is still dropped then.

**Streak save offer copy** (`streak_save_offer`):
- title "Save your {n}-day streak";
- body, free user: "You missed yesterday. A streak shield can still keep all {n} days. Today only.";
- body, Pro (a webhook-lag edge): "You missed yesterday. Use a shield and keep all {n} days. Today only."

**Re-sequencing** (all server-side, so pushes are never doubled):

| Existing push | Change when `DONT_MISS_TWICE_PUSH_ENABLED` is on |
|---|---|
| `streak_lost`, `shield_applied` (nightly cron `lib/cron/streak-daily-check.ts`) | **Not pushed any more.** The state rides on the D+1 push (`shield_saved` variant / save offer / `streak_restart`). The cron keeps protecting and breaking streaks. With the env off, the old pushes return. |
| `momentum_at_risk` (19:00 on the day itself, before a miss) | Unchanged on day D. On D+1 it is skipped if a `dont_miss_twice` / `streak_save_offer` was delivered in the last 20 h (`ReminderService`). |
| `meal_reminder_*` on D+1 | The reminder for the slot the D+1 push named is skipped that day (`MealReminderService`). Other slots are unchanged and still cap-respecting. |
| `winback_day3` | A `dont_miss_twice` / `streak_save_offer` delivered in the last 44 h counts as that day's win-back touch. Day 3 slides to the next day of its band (allowed, §8.4), so it never goes the day right after. Add this to `WinbackService`, the same way `leaderboard_overtaken` replaces a step. |
| `leaderboard_overtaken`, `health_sync_update` | Treat a D+1 push in the last 20 h like a win-back step (they skip that user that day). |

**Orchestrator registration:**

| Type | Category | Screen (default) | Cap | Audience | Interval |
|---|---|---|---|---|---|
| `dont_miss_twice` | `momentum` | `food_log` (`dashboard` / `exercise_log` per variant, via `SCREEN_OVERRIDE_TYPES`) | counts toward the daily cap of 3 | `HABIT_TYPES` (active users only) | `TYPE_MIN_INTERVAL_HOURS` 44 |
| `streak_save_offer` | `momentum` | `streaks` | cap-exempt (replaces cap-exempt `streak_lost`) | `HABIT_TYPES` | 44 |
| `milestone_achieved` | `celebration` | `streaks` | cap-exempt | normal (not dormant / test) | n/a |

- Add `dont_miss_twice` and `streak_save_offer` to `TYPE_CATEGORY_MAP` (`notification-preferences-service.ts`).
- Add `milestone_achieved` to `DEFERRABLE_PRIORITY` (after the meal reminders): a milestone reached by a 2 am sync is held until quiet hours end.
- **Dedupe keys:** `dmt:<D>`, `streak_save:<D>`, `streak_milestone:<days>:<boundaryDay>`.

**Push data payloads:**
- **`dont_miss_twice`:** `type`, `category`, `screen` (`food_log` / `exercise_log` / `dashboard`), `route` = `log_meal_camera` (meal variants only), `mealType`, `variant`, `missedDate` = D, `streakDays`, `dedupeKey`, `notification_id`.
- **`streak_save_offer`:** `type`, `category`, `screen` = `streaks`, `route` = `streak_save`, `missedDate`, `lostStreak`, `offerId`, `dedupeKey`, `notification_id`.
- **Old clients** route `screen=streaks` (iOS also falls back on the `streak_` prefix; Android on `screenForType`). They land on Streaks, where tapping "use shield" gives 402 `NO_SHIELDS_AVAILABLE`, which opens the `streak_shield` paywall. That works today. Android 1.1.4 drops unknown data keys and `route`; iOS 1.1.4 ignores unknown routes and falls through to `screen`. **Both must be verified on the shipped builds** (§10.3).

**Dry run:** `GET /api/cron/dont-miss-twice?dry_run=1[&all_hours=1][&userId=][&as_of=]` returns the decisions and copy without sending (the same shape as `/api/cron/winback`).

### 5.3 Streak save flow (F6)

**`GET /api/mobile/streaks/save-offer`** (mobile auth, no-store)

```json
{ "success": true, "error": null, "meta": null, "data": {
  "eligible": true, "offer_id": "uuid", "missed_date": "2026-11-12", "lost_streak": 12, "restored_streak": 13,
  "expires_at": "2026-11-14T08:00:00.000Z", "path": "paywall", "shields_available": 0, "unlimited": false
} }
```

- **`eligible`:** D = yesterday local is unclaimed, D−1 ends a run ≥ the minimum, not zombie-guard, and now is before `expires_at` = end of D+1 local + the 3 am grace (`GRACE_PERIOD_HOURS`).
- **Ineligible** → `{eligible:false, reason:'nothing_to_save'|'expired'|'zombie_guard'|'too_short'}`.
- **`restored_streak`** = `lost_streak` + (1 if today is claimed) + 1 for D.
- **`path`:**
  - `activate`: Pro, or a free user with shields > 0 (a rare race);
  - `paywall`: free and no shields.
  - XP purchase (`STREAK_SHIELD_XP_PRICE`) is deliberately not offered here (§11 D7).
- **Side effect:** marks the offer row `opened_at` (it is created on demand when no push created it, e.g. a dashboard card).

**Saving:** the existing `POST /api/streaks/freeze/activate` with `{"date": missed_date}`. It already protects a named past day, consumes nothing for Pro, and returns `{shieldsRemaining, unlimited, date}`.
- New: on success the server marks the matching `streak_save_offers` row `saved` (`method` = `pro_unlimited` | `shield`).

**After a purchase on the save paywall:**
- **Client:** wait for server Pro (iOS `waitForServerPro`; Android an entitlement poll, up to ~15 s), then call activate with `missed_date`. Then show the restored-streak celebration.
- **Server backstop:** when the RevenueCat webhook flips a user to premium (`subscription-service.ts`), apply a shield for any `streak_save_offers` row that is `offered`, `opened_at` not null and not expired, then mark it `saved` (`method: 'after_purchase'`). The client activate call then gets `ALREADY_CLAIMED`, which it treats as success.

**Client (both):** a deep link with `route=streak_save` (or `screen=streaks` + type `streak_save_offer`) opens the Streaks screen and calls `save-offer`:
- **`activate`** → a "Save your {n}-day streak" sheet with one button "Use a shield" → activate → `ShieldAppliedCelebration`.
- **`paywall`** → paywall placement `streak_save`:
  - headline "Save your {n}-day streak";
  - subhead "Pro includes unlimited streak shields. Start your free trial and keep all {n} days." (trial wording only when eligible, §1);
  - plan, badge and disclosure from the paywall config (§1.1); after purchase → the save flow above.
- **Dismiss** → back to Streaks with a "Save by {expires_at local time}" card while eligible.
- **Not eligible** → plain Streaks.

The dashboard break-time auto-paywall (iOS `DashboardFeature.swift` ~2113; Android `DashboardViewModel.maybeShowShieldUpsell` :834) is replaced, when `clientConfig.streakSaveOffer` is true, by a dashboard **"Save your streak" card** that opens the same flow. There is no auto-fired paywall.

| | iOS | Android |
|---|---|---|
| Route | `DeepLinkRouter.parseNotificationDeepLink` (new route `streak_save`), `AppFeature` `.deepLink` (~1618–1720) | `NotificationDeepLink` `ALLOWED_ROUTES` + `ALLOWED_DATA_KEYS` (`missedDate`, `lostStreak`, `offerId`, `variant`, `streakDays`), `MainScreen.kt` ~600–760 |
| Flow | `Features/Streaks/StreakClaimViewModel.swift` (`activateFreeze(for:)`), new `StreakSaveSheet`, `StreakClaimContainerView` | `features/streaks/StreakClaimViewModel.kt` (`activateFreeze()` :485), new `StreakSaveSheet`, `ShieldAppliedCelebration` |
| Paywall | new `PaywallContext.streakSave` (source `streak_save`) | new `PaywallContext.STREAK_SAVE` |
| Dashboard card | `DashboardFeature` (~1740, ~2113) | `DashboardViewModel` (:834), `StreakClaimDashboardCard.kt` |

### 5.4 Streak milestones (F6)

**List:** the canonical `MILESTONES` in `lib/streaks/streak-config.ts`: **3, 7, 14, 30, 60, 100, 180, 365** (and 500, 730, 1000).
- Both apps already mirror it (iOS `StreakMilestone` / `AppConstants`, Android `ClaimMilestone.kt`).
- It is not changed to the suggested 50 (§11 D5).
- Dedupe already exists: `celebrated_milestone_days` in `StreakShieldService.awardForStreakGrowth`.

**Server.** When `claimStreak` returns a `milestone` that is a celebration milestone (not a bare weekly shield earn):
1. **In-app ownership.** `claimStreak` gets `opts.inAppCelebration`, which is true only when:
   - the claim came from a foreground manual action route (`POST /api/mobile/food-log`, `/beverages`, `/exercises`, `/exercises/quick-log`, `/api/streaks/claim`, `/checkin`); **and**
   - the request's `X-Client-Features` includes `streak_celebration_v1`.

   Sync routes (`/exercises/sync`, `/tracking/bulk-sync`) are always false.
2. **Push** `milestone_achieved` when `!inAppCelebration` and `streak_milestone_push` = on:
   - title "{n}-day streak";
   - body "{name}: {n} days in a row. Tap to celebrate." (`name` = the milestone name, e.g. "1-Week Warrior"), plus " You earned a streak shield." when `shieldsGranted > 0`;
   - data `screen=streaks`, `route=streak_milestone`, `milestone={n}`, `dedupeKey`.
   - Old apps open Streaks (the type has an existing screen mapping and `milestone_` prefix fallback). They get the push even after an in-app log, because they do not declare the feature (§11 D6).
3. **Pending celebration** for claims the app did not show: store `pending_celebration: {days, name, icon, day, at, shieldsGranted}` on the `milestone_shield` `streak_shields.metadata` row (same optimistic write). No migration is needed.

**`GET /api/mobile/streaks/celebrations`**:
- Returns `{data: {pending: {milestone, name, icon, shields_granted, reached_on} | null}}`.
- `pending` only if `at` is within 72 h.

**`POST /api/mobile/streaks/celebrations/ack`** `{milestone}` → 204. This clears it and is idempotent.

**Clients (1.1.5, both):**
- Show the full-screen milestone celebration whenever any create / claim response has `meta.streak.milestone` with a celebration milestone, on any screen, not only the streak claim screen. Also show it on foreground / launch (and on `route=streak_milestone`) when `GET /streaks/celebrations` returns one, then ack.
- Reuse iOS `MilestoneCelebrationView` (hosted today only in `StreakClaimContainerView` ~156; lift it to `AppFeature`) and Android `MilestoneCelebrationDialog` (`features/streaks/components/`).
- The existing Pro upsell after milestones (Android `MilestoneUpsellManager`; iOS `PaywallContext.milestone`, unused) stays as it is. It is not added on iOS in 1.1.5.
- Fire `Streak Milestone Reached` once per milestone.

---

## 6. Migration 138: `supabase/migrations/138_engagement_115.sql`

**How to apply:** apply it ALONE (`npx -y supabase@latest db query --linked -f …`, then insert the history row). Never use `db push --include-all`. Refresh the DB contract snapshot afterwards and run the API snapshot suite before and after.

**Code is fail-soft until it is applied:**
- A missing column or table falls back to legacy behaviour (`isMissingColumn` / `42P01` → empty) for `share_circle_ids`, prefs, offers and `fitzy_message_log` columns.
- Weekly Fitzy counting returns 0 when the columns are missing, so it is generous rather than blocking.

```sql
-- 138: Release 1.1.5 engagement (docs/ENGAGEMENT_115_SPEC.md). Tables, columns, indexes, RLS only.
-- No stored procedures, functions or triggers.

-- F4: per-circle "share my meals here" memory (success-screen toggles).
create table if not exists public.meal_share_circle_prefs (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  fitcircle_id uuid not null references public.fitcircles(id) on delete cascade,
  share        boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, fitcircle_id)
);
alter table public.meal_share_circle_prefs enable row level security;
revoke all on public.meal_share_circle_prefs from anon, authenticated;

-- F4: explicit per-meal circle list; NULL = legacy rule (every circle with tier 'full').
alter table public.food_log_entries add column if not exists share_circle_ids uuid[];

-- F3: weekly free Fitzy counting.
alter table public.fitzy_message_log add column if not exists tier text check (tier in ('free','pro'));
alter table public.fitzy_message_log add column if not exists context text;
create index if not exists fitzy_message_log_user_free_idx
  on public.fitzy_message_log (user_id, created_at desc) where tier = 'free';

-- F6: streak save offers (one per user per missed day).
create table if not exists public.streak_save_offers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  missed_date   date not null,
  lost_streak   integer not null,
  status        text not null default 'offered' check (status in ('offered','saved','expired')),
  method        text check (method in ('shield','pro_unlimited','after_purchase')),
  offered_at    timestamptz not null default now(),
  opened_at     timestamptz,
  saved_at      timestamptz,
  expires_at    timestamptz not null,
  unique (user_id, missed_date)
);
create index if not exists streak_save_offers_open_idx on public.streak_save_offers (user_id, status) where status = 'offered';
alter table public.streak_save_offers enable row level security;
revoke all on public.streak_save_offers from anon, authenticated;
```

**Storage notes:**
- `preferences.privacy.meals_made_private_at` is jsonb, so it needs no DDL.
- `pending_celebration` lives in the existing `streak_shields.metadata`.
- There is no data backfill in SQL. The bulk-private backfill is a script (§4.6).

**Next free migration after this one: 139.**

---

## 7. Analytics: tracking plan v35 (on top of the paywall-default v34) (`analytics/tracking-plan.json` → `node analytics/codegen.mjs`)

Conventions: Title Case `<Object> <Past-tense verb>`, snake_case properties, lowercase enum values. No health values: calorie and scan counts below are allowance counters, not health data.

**New enums:**
- `intro_eligibility`: `eligible | ineligible | unknown | server_promoted`
- `scan_allowance_mode`: `starter | daily | exhausted`
- `share_prompt_outcome`: `shared | dismissed | edited`

**Changed events:**

| Event | Change |
|---|---|
| `Paywall Viewed` | + `intro_eligibility`, `trial_days_offered` (int). `default_plan` / `default_plan_source` already added in v34. `trial_eligible` = the selected plan. `source` gains `food_scan_limit`, `fitzy_weekly_limit`, `streak_save`. |
| `Purchase Started`, `Purchase Cancelled` | + `intro_eligibility`, `trial_days_offered`. `trial_eligible` = the bought plan. |
| `Purchase Failed`, `Checkout Exit Reason` | `trial_eligible` = the bought plan (description only). |
| `Paywall Plan Selected` | `source` description gains the new sources. |
| `AI Limit Reached` | + `allowance_mode` (scan_allowance_mode, food only), `window` (`week` / `day`, Fitzy only), `blocked_before_upload` (bool). |
| `Streak Milestone Reached` | + `trigger` (`claim_response` / `pending` / `push`). |
| `Fitzy Message Sent` | + `remaining_after` (int, free only). |
| `Push Sent` / `Push Notification Opened` | No schema change. Document the new `notification_type` values `dont_miss_twice`, `streak_save_offer`, `milestone_achieved`. |

**New events:**

| Event | Platforms | Properties |
|---|---|---|
| `Food Scan Meter Viewed` | ios, android | `mode` (scan_allowance_mode, required), `remaining` (int), `is_last` (bool) |
| `Food Scan Paywall Resolved` | ios, android | `outcome` (`purchased` / `manual` / `dismissed`), `mode`, `had_saved_entry` (bool) |
| `Meal Share Prompt Viewed` | ios, android | `circle_count` (int), `default_on_count` (int), `already_shared` (bool) |
| `Meal Share Prompt Resolved` | ios, android | `outcome` (share_prompt_outcome), `shared_circle_count` (int), `toggled_off_count` (int), `toggled_on_count` (int) |
| `Chat Photo Viewed` | ios, android | `kind` (`meal_card` / `user_photo`), `zoomed` (bool) |
| `Streak Save Offer Viewed` | ios, android | `path` (`activate` / `paywall`), `lost_streak` (int), `entry` (`push` / `dashboard_card` / `streaks_screen`) |
| `Streak Saved` | ios, android | `method` (`shield` / `pro_unlimited` / `after_purchase`), `lost_streak` (int) |

Server (Amplitude HTTP V2, `platform: server`, real users only, same as `Push Sent`): `Streak Save Offer Created {lost_streak}` and `Don't Miss Twice Evaluated {decision, variant}` (decision: `sent | skipped_claimed | skipped_not_first_miss | suppressed`). Only emit them if they stay cheap. Otherwise `Push Sent` suppression reasons are enough.

---

## 8. Remote config and kill switches

| Key / switch | Type | Default | Rule / meaning |
|---|---|---|---|
| `free_food_ai_daily_after_total` | int 0–50 | 0 | ios / android ≥ 1.1.5 → 2 |
| `free_fitzy_messages_per_week` | int 0–100 | 0 | ios / android ≥ 1.1.5 → 3 |
| `paywall_default_plan`, `paywall_badge_plan` | enum | annual | **owned by PAYWALL_DEFAULT_PLAN.md (1.1.4)**; the new 1.1.5 paywalls read them too |
| `meal_share_prompt` | enum on / off | on | `clientConfig.mealSharePrompt`; off = no share card (the success sheet stays) |
| `meal_share_large_circle_threshold` | int 2–500 | 20 | §4.3 rule 6 |
| `streak_save_offer` | enum on / off | on | push type choice + `clientConfig.streakSaveOffer` (dashboard card) |
| `streak_save_offer_min_streak` | int 2–30 | 3 | §5.2 |
| `streak_milestone_push` | enum on / off | on | §5.4 |
| `dont_miss_twice_push` | enum on / off | on | per user / percent rollout (cron: no platform or version facts, so use `percent` / `userIds` rules only) |
| env `DONT_MISS_TWICE_PUSH_ENABLED` | bool | on | hard kill. Off = no D+1 job, **and** `streak_lost` / `shield_applied` night pushes return |

The Admin Tools Limits page can only edit `int` keys today (PAYWALL_DEFAULT_PLAN §5). Until enum editing ships, set the enum switches above through `PUT /api/admin/remote-config/{key}/default` and `POST .../rules`.

Rollback for F2 and F3 = disable the version rules. Clients then read `mode: exhausted` / `locked`, which means 1.1.4 behaviour.

---

## 9. Compatibility matrix

| Server change | iOS / Android 1.1.2–1.1.4 | Pre-1.1.2 / no headers / web | 1.1.5 |
|---|---|---|---|
| `allowances`, `clientConfig` in entitlements | ignored (unknown keys; both decoders lenient) | ignored | used |
| Daily scans | key resolves 0 → today's 21-then-paywall, legacy fields unchanged | 0 (old builds keep the admin 1000 default) | daily phase; legacy `foodAiAnalysesRemaining` = current remaining |
| Food UPGRADE_REQUIRED `details.allowance` | extra key ignored, same code / status | same | used |
| Weekly Fitzy | weekly 0 → daily rule 0 → first message paywall (unchanged) | default (unchanged) | 3 / week |
| Fitzy chat `limit` / `window` / `resetsAt` | ignored | ignored | used |
| `fitzy_message_log.tier` / `context` | written for every client (server side) | same | same |
| `share_circle_ids` on create / PATCH / response | never sent → legacy all-`full`-circles rule; extra response key ignored | same | sent |
| `share-targets`, `/{id}/share` | not called | not called | used |
| Meal payload `image_width` / `height` | ignored; old layout | — | thumbnail sizing |
| `mealVisibleInCircle` | identical for null lists (all old rows and old clients) | same | per-meal lists |
| Night `streak_lost` / `shield_applied` stop (DMT on) | they get `dont_miss_twice` / `streak_save_offer` instead: screen `streaks` / `food_log` (both handle these) | same | full routes |
| `route` = `streak_save` / `streak_milestone` | Android drops the key (allowlist); iOS falls through to `screen` — **verify** | — | routed |
| `milestone_achieved` push | always sent to them (no feature) → Streaks screen | same | only when not shown in-app |
| `save-offer`, `celebrations` endpoints | not called | — | used |
| `freeze/activate` marks the offer saved | response unchanged | same | same |
| Paywall default / badge (1.1.4 contract) | 1.1.4 uses it; 1.1.2–1.1.3 keep monthly | — | new placements reuse it |

Shipped-client replay: extend `api/mobile/food-log/__tests__/shipped-client-compat.test.ts` and the entitlements / Fitzy compat tests with the 1.1.4 iOS and Android request and decode fixtures.

---

## 10. Test plan and later

### 10.1 Backend (Vitest)

- **`usage-service`:**
  - every phase transition, using the `dailyUsed` formula including the boundary day;
  - local-midnight edges across 3 zones;
  - mailbox / device max in the daily phase;
  - reservation race at 1/2;
  - refusal before the model call (spy on the model);
  - weekly window on a Monday 00:00 boundary;
  - onboarding / trial rows not counted;
  - old-version requests get unchanged results (the `remote-config-version-rules` test with 1.1.4 header fixtures).
- **Routes:**
  - photo-parse UPGRADE_REQUIRED daily copy + `details.allowance` + Option B;
  - Fitzy chat and stream weekly refusal envelope;
  - entitlements `allowances` for free, Pro and gate-dark users.
- **F4:**
  - `defaultOnFor` table tests for rules 1–7;
  - `/share` post / retract per circle, before the response;
  - a push only within 2 h and never on a re-share;
  - legacy create unchanged;
  - image proxy denies a member of a non-target circle;
  - offline replay of a 1.1.4 body.
- **F5 / F6:**
  - pure variant picker;
  - send hour + quiet-hour shift;
  - one per D across reruns (dedupe + offer unique);
  - win-back day 3 slides;
  - momentum / meal reminder suppression;
  - DMT off restores `streak_lost` / `shield_applied`;
  - save-offer eligibility (zombie, expiry at grace end, too short);
  - webhook backstop applies once;
  - milestone push suppressed only with `streak_celebration_v1` + a manual route;
  - pending celebration ack.
- **Dry runs** against prod data before enabling: `/api/cron/dont-miss-twice?dry_run=1&all_hours=1`.
- **Release preflight:** `scripts/release-preflight.sh`, plus the API snapshot suite before and after migration 138.

### 10.2 Clients (unit + UI)

- **Paywall:**
  - the new placements (`food_scan_limit`, `fitzy_weekly_limit`, `streak_save`) pre-select the remote `defaultPlan`; a test flips the cached config to `monthly` and checks it;
  - analytics payloads: `intro_eligibility`, `trial_days_offered`, `trial_eligible` = the selected plan.
  - Default / badge / disclosure strings are covered by the PAYWALL_DEFAULT_PLAN tests.
- **Scans:**
  - meter states (5 rows of §2.4);
  - out-of-scans capture → no upload (network spy) → paywall with the photo → purchased analyzes it / dismiss opens manual with the photo + reset banner;
  - a server refusal with `savedEntryId` opens that entry;
  - background upload carries version headers.
- **Fitzy:** weekly counter; send at 0 holds the draft → paywall → resend after purchase; daily-mode fallback when `allowances` is absent.
- **Circles:**
  - success sheet for each logging path; toggles prefill; share posts; remember;
  - offline share queued after create;
  - thumbnail 180-wide aspect clamp; viewer pinch / double-tap / swipe-dismiss; accessibility labels.
- **Streaks:**
  - `route=streak_save` for Pro → activate and for free → paywall → purchase → restored;
  - expiry card;
  - milestone celebration from a meal-log response and from pending on launch, shown once.
- **Shipped builds:** tap each new push type on a 1.1.4 iOS and a 1.1.4 Android device. They must land on the `screen` fallback with no crash.

### 10.3 Manual QA before enabling switches in prod

1. Run the §4.6 backfill script (dry run, then apply).
2. Turn on the version rules on a test account (`userIds`), then for all ≥ 1.1.5.
3. Check one real D+1 push per variant on test devices (test accounts are audience-blocked, so use the `X-Test-Device` override in dry run only).

### 10.4 Later (not 1.1.5)

- Proactive Fitzy comment on the first scanned meal (§3.5).
- `open_screen@2` with `exercise_log` for promo cards.
- Shield purchase with XP in the save flow.
- An Android `fitcircle://` intent filter (the scheme is not registered; pushes route by `screen` / `route`, so 1.1.5 does not need it).
- Widget / Watch / Wear share prompt.

---

## 11. Decisions made in this spec

- **D1. Paywall default / badge / price are not re-specified here.** PAYWALL_DEFAULT_PLAN.md (1.1.4) owns them, and every new 1.1.5 placement reuses that config.
- **D4. Daily scans and weekly Fitzy are version-gated to ≥ 1.1.5** (rules, defaults 0). The reasoning is in §2.2.
  - Onboarding messages and messages sent on a trial don't use up the free week.
- **D5. Milestones use the canonical list** (3, 7, 14, 30, 60, 100, 180, 365, …), not the suggested 3, 7, 14, 30, **50**, 100, 365. Both apps mirror the server list, and shield / badge assets exist for it.
- **D6. Milestone push** is sent only when the app did not show the celebration in-app (no `streak_celebration_v1`, or a background sync claim), so 1.1.5 users never get a push about something they just saw.
  - Old builds always get it.
- **D7. Shields are NOT subscriber-only today.** Free users get 1 starter shield, earn +1 per 7 days and +1 per 30 days (cap 3), and those shields auto-apply nightly. Pro gets unlimited shields.
  - So the "save your streak" offer reaches free users who are **out** of shields. Tap → paywall (Pro = unlimited shields), then the save is applied.
  - Pro users almost never break (only the 2-in-a-row zombie guard, which gets no offer).
  - The XP-shield purchase path is not surfaced in this flow.
  - Earned free shields are not removed.
- **D8. Don't-miss-twice and the save offer are one push slot.** They share the same D+1 moment, one per lapse, and the night `streak_lost` / `shield_applied` pushes are folded into it.
- **D9. Success-screen sharing needs one tap.** Default-ON toggles never post on their own, so no one is re-shared silently.
  - The Nov 4 "no backfill / private by default" promise holds.
  - A stored `share_meals_with_circles:false`, or a bulk make-private, counts as an explicit choice and turns every toggle off.
- **D10. Per-meal circle lists** (`share_circle_ids`) instead of changing per-circle tiers. Turning a circle off for one meal must not hide that user's older photos in it (the image proxy uses the tier).
  - Null = the legacy rule, so old clients are unchanged.
- **D11. Placements:**
  - new: `food_scan_limit`, `fitzy_weekly_limit`, `streak_save`;
  - kept: `food_ai` (voice / describe), `fitzy_send` (1.1.4 path), `streak_shield` (Streaks screen out-of-shields).
- **D12. Scan paywall copy says "Unlock unlimited scans"** (the founder's wording), although Pro has a 100/day abuse ceiling. This is standard fair-use; see §12 Q5.

## 12. Open questions for the founder

1. **Badge wording and rounding** (for the 1.1.4 contract owner):
   - That contract shows "Most popular". FitCircle has no purchase data showing annual is *our* most chosen plan (35 real users, $0 revenue), so "Best value" (literally true: lowest monthly cost) avoids borrowed social proof. Recommendation: "Best value". It would need a text key (e.g. `paywall_badge_text`) next to `paywall_badge_plan`.
   - It also rounds per-month **down**, so $29.99 shows "$2.49/mo", not the founder's "$2.50/mo". Confirm which.
2. **Shield entitlement:** shields are already free-earnable (D7). Keep that, or make shields Pro-only? Pro-only would be a bigger change, with a streak-economy migration and copy everywhere. It is not in this spec.
3. **Onboarding paywall experiment:** pre-selecting annual changes every arm of the running onboarding paywall layout experiment. Restart the readout window at 1.1.5, or split the analysis by `app_build`?
4. **Night pushes:** retire `streak_lost` / `shield_applied` night pushes (D8)? They are usually quiet-hours-dropped anyway.
5. **"Unlimited scans" wording** vs the 100/day fair-use ceiling. Add "fair use" to the Terms, or say "Scan every meal"?
6. **Old 1.1.2–1.1.4 users** get the new scan and Fitzy allowances only after updating. Fire the app-update prompt (`/api/mobile/app-update`) for them at release?

## 13. Founder decisions (2026-11-13), these override anything above

1. **Badge:** "Best value". It shipped in 1.1.4 as hard-coded copy, and `paywall_badge_plan` chooses the row. Per-month is rounded **down** ($2.49/mo), and the billed price leads. The new paywalls (scan limit, Fitzy, streak save) use `/api/mobile/paywall/config` for the default plan and badge. They also follow the 1.1.4 sheet-matching rules (`docs/PAYWALL_DEFAULT_PLAN.md` §3a): store price strings; store offer period wording; "Due today" plus the first charge date; no trial copy unless eligible.
2. **Shields stay free to earn.** The new economy is on branch `feat/shield-economy` (worktree FitCircleBE-shields, NOT yet merged; it ships after 1.1.4 apps are live):
   - 1 shield per `streak_shield_earn_interval_days` (7);
   - no monthly bonus;
   - `streak_shield_starter_count` (2) granted at onboarding completion;
   - cap `streak_shield_max_balance` (3);
   - `shield_rules` on streak responses.

   1.1.5 must build on that contract. The backend engagement branch merges `feat/shield-economy` first, or rebases onto main after it lands. Tracking plan: shields took **v35**, so this spec's analytics become **v36**.
3. **Onboarding paywall experiment:** the experiment is switched to control. No readout changes are needed; split by `app_build` if it is ever re-enabled.
4. **Night pushes:** retire the `streak_lost` / `shield_applied` night pushes in favour of the next-day push (D8). Keep the types for old clients' deep links.
5. **Scan copy:** "Scan every meal" everywhere. "Unlimited" is never used for scans, and the fair-use line stays in the paywall terms.
6. **Old clients:** show the soft, dismissible app-update prompt at 1.1.5 release ("Update to get free daily scans"), using the existing app-update system.
7. **Test accounts:** a separate 1.1.5 change is in flight on `release/1.1.5` (Android) and `feat/test-account-flag` (backend). The server flags robot, QA and review accounts, and the app mutes Sentry, analytics and pushes for them. Paywall prefetch failures become breadcrumbs. Don't duplicate this work; coordinate if you touch the same files.

## 14. Trial conversion additions (founder request 2026-11-16)

Why: Nov 13–15, 24 paywall viewers → 3 store sheets → 0 trials. Last 30 days: 195 users saw the onboarding meal step, 22 scanned a meal, 115 tapped "Maybe later"; the `first_meal_aha` paywall fired once. The onboarding paywall comes 4 steps after the meal step.

### 14.1 Trial timeline on every paywall

Today the timeline ("Today: full Pro access, free" → "By {date}: we'll remind you before your trial ends" → "{date}: your plan starts at {price}. Cancel anytime before.") exists in both apps but renders only on the onboarding paywall, for the `onboarding_paywall` arm payload `trial_timeline: true` (iOS `PaywallCopy.trialTimeline`, Android `TrialTimelineCopy`). Its rules stay as they are: real dates from the store offer, shown only for a CONFIRMED free trial on the selected plan (`intro_eligibility` eligible / server_promoted), hidden otherwise, never guessed.

1.1.5:
- **Every paywall placement** (onboarding, `food_scan_limit`, `fitzy_weekly_limit`, `streak_save`, `first_meal_aha`, Pro card, badge, history limit, …) renders the timeline under the plan cards when the switch is on and the selected plan has a confirmed trial. It follows the selected plan: switching annual ↔ monthly updates the price and dates; a plan with no trial hides it.
- **Switch:** remote config `paywall_trial_timeline` (enum `on` | `off`, default `on`), in `CLIENT_VISIBLE_KEYS`, served as `trialTimeline: boolean` by `GET /api/mobile/paywall/config` (additive; cached with `paywall_config_v1`; fallback when never fetched: `true`).
- **Onboarding precedence:** the arm payload `trial_timeline` (when present, true or false) wins over the remote switch, so the experiment stays fair.
- **Analytics:** Paywall Viewed gets `trial_timeline_shown` (bool) on every placement.

**The reminder promise must be true.** The trial reminder (`trial-reminder-service.ts`, 10:00 local, 24–48 h before the trial ends) is push-only today. 1.1.5 backend: when the push cannot be delivered (no active token, push master switch off, or the orchestrator outcome is `no_token` / suppressed for a non-quiet-hours reason), send the same reminder **by email** (Resend, transactional, template "Your FitCircle trial ends {day}" with the plan, price, end date and how to cancel on that store). Quiet hours still defer the push; the email fallback is decided once the attempt is final. Kill switch `TRIAL_REMINDER_EMAIL_ENABLED` (default on). Stamp `trial_reminder_sent_at` once either channel succeeds.

### 14.2 Paywall right after the first scan

**Onboarding (new arm payload, 1.1.5 clients):** `paywall_position`: `"end"` (default, today) | `"after_meal"`.
- `after_meal`: when the user finishes the first-meal step **with a logged meal** (result shown and saved), the onboarding paywall (same component, context `.onboarding`, same layout / `later_delay_s` / timeline payload) opens immediately, before `askFitzy`. Paywall Viewed source stays `onboarding`, with new property `paywall_position: after_meal`.
- After Start trial, purchase or "I'll do it later", onboarding continues at `askFitzy` → … → `summary`, and **no second paywall** at the end. The progress snapshot records that the onboarding paywall was shown so a resume never shows it twice.
- Meal skipped, failed or not logged → the paywall stays at the end, exactly as today (`paywall_position: end`).
- All the existing server calls fire as today (`onboarding_paywall_at`, `reachGate`, `paywall_shown` journey event).
- Older apps ignore the key (paywall at the end).

**Experiment** (`onboarding_paywall`, set in Admin Tools at release): control = plans + `trial_timeline: true` (50 %); new `variantD` "After first meal" = plans + `trial_timeline: true` + `paywall_position: after_meal` (50 %). Until 1.1.5 is live, control gets `trial_timeline: true` at 100 % (the 1.1.3+/1.1.4 apps already render it).

**Outside onboarding (backend, works for 1.1.0+ clients):** `postAhaEligible` today requires the 72 h auto-paywall spacing, so a user who saw the onboarding paywall *without* scanning never gets `first_meal_aha` after their first real scan. New rule in `lib/journey/paywall.ts`: `first_meal_aha` is exempt from the spacing when the user has never logged a meal before their last automatic paywall (i.e. the onboarding paywall was seen without a scan). It stays once-only and still never in a Pro / trialing account.

### 14.3 Meal-log abandonment

Analysis first (Amplitude + code), written to `docs/MEAL_LOG_ABANDONMENT_2026-11.md`: every step from opening the logger to a saved meal, by method (photo, gallery, voice, text, barcode, manual), platform and version, with where each abandoned log stops, AI failure / latency, and the onboarding meal step's skip reasons. Fixes that fall out of it and fit 1.1.5 are added here as §14.4 before the build is cut.

### 14.4b Backend as built (2026-11-16)

- `paywall_trial_timeline` (registry + `CLIENT_VISIBLE_KEYS`) → `trialTimeline` on `GET /api/mobile/paywall/config` (signed out too). Contract: `docs/PAYWALL_DEFAULT_PLAN.md` §1–2.
- `first_meal_aha` spacing exemption: `lib/journey/paywall.ts` (`firstMealAt` = earliest non-deleted food entry, already read by `JourneyService.getJourney`; exempt when it is after `paywall_auto_last_at` or null). No new query, no migration.
- Trial reminder email fallback: `lib/services/trial-reminder-service.ts` + `lib/email/trial-reminder-email.ts`. Email when the push outcome is anything but sent / `quiet_hours` / `deferred` / `duplicate`. Robot / QA test accounts get no email (internal + review do); `Trial Reminder Sent` skipped for every test account. The email quotes no price: the server has no reliable post-trial price (the trial event carries price 0; store prices vary by territory). Transient email failures (rate limit, network) are retried on the next hourly run; Resend idempotency key = the push dedupe key.

- §14.4 item 3, double analysis (2026-11-16, prod, last 30 days, 316 counted analyses / 85 users): photo re-analyses of identical bytes were already free (content-hash cache: 11 repeats, 4 users, all served from cache), but **text/voice repeats of the same input were charged again** (9 pairs, 9 users, 2–35 s apart: voice-parse had no cache), and a photo retry while the first analysis is still running could be charged twice. Fix: a repeat of an analysis counted in the last 10 min (same content hash, or the same optional `X-Analysis-Job-Id` header) is never charged or paywalled again; a photo repeat returns the first result (waits ≤ 6 s if it is still running). No migration (the job id rides in `nutrition_parse_log.image_hash` as `<hash>|job:<id>`). Contract: ENGAGEMENT_115_CLIENT_CONTRACT §2.
- §14.6 drafts: migration `139_meal_drafts.sql` (written, not applied), `MEAL_DRAFTS_ENABLED` (off until 139 is live) + `MEAL_DRAFT_PROMOTION_ENABLED`, cron `/api/cron/meal-drafts` (every 15 min), `lib/services/meal-draft-service.ts`, `lib/meal-drafts/*`, confirm `POST /api/mobile/food-log/{id}/confirm`, discard `POST /api/mobile/food/analyses/{id}/discard`. Every food_log_entries reader goes through `confirmedOnly()` (guard test `__tests__/unit/meal-drafts-readers.test.ts`). The privacy data export deliberately keeps drafts (right of access; rows carry `entry_status`).
- §14.7 `first_meal_nudge`: `lib/journey/first-meal-nudge.ts` + MealReminderService (replaces that slot's reminder), `FIRST_MEAL_NUDGE_ENABLED` (default on).
- §14.8: scorecard metric `first_meal_24h_after_onboarding`; experiment body `lib/experiments/onboarding-meal-step.ts` (arm key `variantA`: arm keys must be consecutive from variantA), create script `scripts/onboarding-meal-step-experiment.ts` (dry run by default, creates a draft).

### 14.5 Tracking plan

v36 adds: Paywall Viewed `trial_timeline_shown` (bool), `paywall_position` (enum end | after_meal, onboarding only). Server: `Trial Reminder Sent {channel: push | email}`.

### 14.4 Meal-log fixes in 1.1.5 (from docs/MEAL_LOG_ABANDONMENT_2026-11.md)

1. **Never lose a ready result (both apps).** A result that finishes while a busy screen is up (onboarding steps, the paywall, any sheet) is not marked "prompted"; it opens at the next idle moment (e.g. right after the paywall closes or onboarding finishes). If it still isn't opened, the Home screen shows a "Your meal is ready — save it" card until it is saved or discarded. In onboarding with `paywall_position: after_meal`, the paywall waits for the meal result/save, never the other way round.
2. **"No food found" is useful.** When the analysis finds no food, offer "Describe it instead" (text logging pre-filled with nothing, focus on the field) and "Retake", instead of an empty review.
3. **Double analysis check.** Event timelines suggest a second analysis of the same photo ~60 s after the first, with no new photo, which costs a free scan. Confirm or rule out in each app (queue retry / resume path); if real, fix: one photo → at most one counted analysis (reuse the job id; the server must not count a retry of the same job twice).
4. **Instrumentation (tracking plan v36):** `Meal Review Shown {job_id, auto_opened, source}`, `Meal Review Closed {job_id, outcome, edit_count, reanalyzed}`, `Meal Capture Cancelled {stage, source}`. Fix the method on Meal Logged (iOS voice/search/barcode currently arrive as `manual`; Android edits logged as `manual`), make Onboarding Meal Logged fire only for the onboarding meal (including manual saves), and send one analysis-started per attempt (retries carry `retry: true` if the property exists, else don't re-send).
5. **iOS user id casing.** iOS sets the Amplitude user id from `UUID().uuidString` (upper case) while the server and Android use lower case, splitting each iOS user in two. 1.1.5 sets it lower-cased. Older iOS history stays under the upper-case id (Amplitude can merge with a one-off user-id mapping later).

Not in 1.1.5: auto-saving abandoned drafts (needs a founder decision), inline onboarding review (stretch), a day-0 "snap your lunch" push for meal-step skippers (server-only; built later behind a kill switch, off until approved).

### 14.6 Draft meals: unsaved AI results are kept, never silently counted (founder decision 2026-11-16)

**Rule:** an AI meal result (photo / voice / text) that is neither saved nor discarded **30 minutes** after it was ready becomes a **Draft meal**. A draft is visible, clearly marked, and does **nothing** until the user confirms it.

- **Where it lives:** server-side, so it survives app kills and reinstalls (the backend owns the AI result already). Shape (backend decides the storage; a migration 139 is allowed, applied alone with founder approval at release): a food-log entry with `entry_status = 'draft'` (`'confirmed'` for every existing and normal entry), the AI items/estimates, the photo, the meal slot/time it was captured for, and `draft_created_at`.
- **Drafts never count:** excluded from daily totals, goals, macros, streak claims, Circle meal sharing / chat posts, leaderboards, Fitzy context, insights, exports, and the AI scan allowance (the scan was already counted once). They are never shared.
- **Old clients (≤1.1.4) never see drafts:** list/sync endpoints include drafts only for clients that declare `X-Client-Features: meal_drafts` (1.1.5+). Everything else filters `entry_status = 'confirmed'`.
- **Confirm:** `POST /api/mobile/food-log/{id}/confirm` (optional edited items in the body) → `entry_status = 'confirmed'`, keeps the original capture time (it counts for the day it was eaten), then runs the normal create side effects for that day (streak claim per the usual backdating rules, meal-share prompt / prefs, analytics `Meal Logged {method, from_draft: true}` from the client). Idempotent.
- **Discard:** the normal delete.
- **Lifetime:** a draft stays until confirmed or discarded; drafts older than 14 days are deleted by the cleanup cron (with their photo), and the user is never charged a scan again for them.
- **The client experience (both apps):**
  - Food Log: a draft row in its meal slot with a **"Draft"** pill (secondary, dashed outline, muted calories shown as "≈ 520 kcal · not counted"), and a one-line explainer the first time: "We kept this meal you didn't save. Review it to add it to your day."
  - Tapping it opens the normal review screen with the header "Review your draft" and two clear actions: **Add to my day** (primary) and **Discard**. Edits work as in normal review.
  - Home: one card "1 meal draft to review" (count when several) until none are left; tapping opens the oldest draft.
  - Daily totals show an inline hint under the day total when drafts exist: "+1 draft not counted".
  - No push for drafts in 1.1.5.
- **Before the 30 minutes**, the §14.4 "ready result" behaviour applies (auto-open at the next idle moment, Home "Your meal is ready" card). After the draft is created that card becomes the draft card.
- **Analytics:** server `Meal Draft Created {method}`; client `Meal Draft Resolved {resolution, age_minutes, edited, surface}`.

### 14.7 "Snap your first meal" push, same day (founder approved 2026-11-16)

- **Who:** real users (not test accounts) who finished onboarding without logging a meal (meal step skipped or no meal saved), have **no confirmed meal and no draft**, have push enabled, and haven't had this push before. Once per user, ever.
- **When:** the user's next meal slot (lunch 12:30 or dinner 18:30 local, the user's own reminder times if they set them in onboarding) that starts **at least 60 minutes after** onboarding finished and within **24 hours** of it. If none fits, no push. Quiet hours: skip, don't defer.
- **Copy:** title "Snap your {lunch|dinner}", body "Take a photo and FitCircle works out the calories in seconds." (no numbers, no social proof). Tap opens the camera food logger (existing meal-reminder deep link to the photo logger; old apps fall back to the Food Log).
- **Mechanics:** notification type `first_meal_nudge`, through NotificationOrchestrator (counts toward the daily cap; category = meal reminders, so the meal-reminder toggle mutes it), dedupe key `first_meal_nudge:<user>`. Runs in the existing 15-minute meal-reminder cron. The 72 h new-user grace for regular meal reminders is unchanged.
- **Switch:** `FIRST_MEAL_NUDGE_ENABLED` (Vercel env, default **on** — approved). Push Sent covers analytics.
- If the user chose "Do it at my next meal" on the onboarding step (§14.8), they get this push even if they skipped push-permission timing elsewhere, as long as push is allowed on the device.

### 14.8 Experiment: a different onboarding meal step (founder approved 2026-11-16)

Experiment `onboarding_meal_step` (created at release in Admin Tools; audience new users, min app 1.1.5, iOS + Android; 50/50; fallback control). Independent of `onboarding_paywall`.

- **control:** today's step.
- **variantB "example + describe"** (payload `meal_step: "example_describe"`):
  1. An **Example** result card above the buttons showing what a scan returns: an illustrated meal (no stock photo; a drawn plate illustration from the design system), items with portions, calories and macros for a typical meal (e.g. "Grilled chicken, rice, broccoli · ≈ 610 kcal · 45 g protein"), with a clear "Example" label. It is an illustration, never presented as the user's data.
  2. Two equal buttons: **Snap a photo** and **Describe it** (text logging, e.g. "2 eggs and toast"), both running the real analysis.
  3. The skip becomes **"I'll do it at my next meal"**: sets `next_meal_nudge` on the onboarding progress (server reads it for §14.7) and moves on.
- **Primary metric:** first confirmed meal within 24 h of onboarding. Secondary: meal-step completion, D1 retention, trial start within 24 h. Guardrail: onboarding completion.
- **Analytics:** `meal_step_variant` on Onboarding Meal Step Viewed / Skipped / Logged; `next_meal_nudge` on Skipped.
- At ~200 users a month reaching the step, expect 4–6 weeks before a 10-point difference is readable.

### 14.9 Experiment arm: "Forced trial (no close)" (founder approved 2026-11-17)

`onboarding_paywall` gets a hard arm: start the free trial (or buy) to finish onboarding. Half of eligible users get it, half get control (today's closable paywall).

- **Arm:** the next free key after the after-meal arm (`variantE` when `variantD` "After first meal" exists, which the script creates if it is missing), name "Forced trial (no close)", payload `{layout:"plans", paywall:"hard", trial_timeline:true}`. Script: `apps/web/scripts/onboarding-forced-trial-experiment.ts` (dry run by default; `--apply --actor <admin email>` PATCHes through `ExperimentService.update`, which writes the audit log; `--split control=50,forced=50,afterMeal=0` is the default). Plan logic: `lib/experiments/onboarding-forced-trial.ts`.
- **Who can be randomised** while a hard arm has weight > 0 (`hardPaywallIneligibility` in `lib/experiments/assign.ts`). This rule comes from the arms, not the stored audience, so an Admin Tools audience save cannot drop it. Excluded users are ineligible for the **whole** experiment: they get the control payload, nothing is persisted, and no arm counts them, so every arm loses them equally.
  - **Invited** (`ExperimentService.arrivedViaInvite`): a `referrals` row as invitee with any status (referral link or code, email/SMS invite auto-attribution, circle-join claims), or membership of a friend's non-public circle (`fitcircle_members.invited_by` ≠ self, which covers circle invite links, codes and accepted email invites even with the referral program off). The demo public circle and public circles don't count. If the lookup fails, the user is treated as invited.
  - **Invited after being assigned** (the claim lands after the first assign call): when the row is unexposed and onboarding isn't finished, it is rewritten to the fallback arm with `reason=fallback`, whatever arm it was. Exposed rows, finished onboarding and QA overrides stay sticky.
  - **Clients below 1.1.5** (`HARD_PAYWALL_MIN_APP_VERSION.onboarding_paywall`, from `X-App-Version`; a missing version fails). Shipped 1.1.0–1.1.4 render "hard" as control. The script also raises `audience.minAppVersion` to 1.1.5 so Admin Tools shows the gate.
  - **Pro** (`subscription_tier = premium`), complimentary grants and `excludeUserIds` (the review demo account).
- **No app lock:** `POST /onboarding/gate` records `onboarding_paywall_at` as today but never sets `onboarding_gate` for `onboarding_paywall`; only `onboarding_v2` does. The client enforces the forced trial at the end of onboarding only, with fallbacks to the closable paywall: not trial-eligible, store offer failed, offline, or a locally known invite. Pro users skip it. A lapsed trial leaves a normal free account.
- **Allocation:** 50/50 control vs forced, with variantD paused at 0 until the forced test reads out. At ~9 sign-ups a day, a 3-way split leaves each arm too small to read. Read results only for rows with `assigned_at` ≥ the start and `app_version` ≥ 1.1.5, because control still holds the 100 % period's rows.
