# Trial-first monetization: backend contract

Status: implemented on branch `feat/trial-first`, 2026-11-06. Not deployed.
Clients: iOS and Android work against this same contract. Admin Tools builds the remote-config UI against §6.

Everything below is **additive**. No existing field changes type, no envelope changes shape, and no `trigger` value is removed.

## 0. Summary

| Surface | Free (gate live) | Pro or trial |
|---|---|---|
| Fitzy chat | 0 messages a day (remote config). Users can open and explore Fitzy, but the first send returns UPGRADE_REQUIRED. | 200 a day abuse ceiling (code) |
| AI food analysis | 5 in total, ever (remote config) | 100 a day abuse ceiling (code) |
| Manual, search, barcode and photo-attach logging | Unlimited | Unlimited |
| Weekly plan, memory, history | Locked, with a teaser preview | Unlocked |

The trial length is `PRO_TRIAL_DAYS = 3` (`lib/entitlements/trial-eligibility.ts`).

The stores set the real trial length (App Store and Play intro offers). On the web it is `STRIPE_TRIAL_DAYS`, which prod already sets.

## 1. Fitzy chat requires Pro or a trial

### 1.1 Gate

`UsageService.assertFitzyQuota` is the first statement of `FitzyService.prepareTurn`. It runs before:
- any conversation is created,
- the user message is persisted,
- `fitzy_message_log` is written,
- the model is called.

A blocked turn therefore costs no AI spend and leaves no conversation turn behind. The legacy `/api/mobile/nutrition-coach` shares the same budget and gate.

The free limit is `free_fitzy_messages_per_day`, default 0 (§6). Pro and trial users keep the 200-a-day abuse ceiling, which returns `RATE_LIMITED`, never a paywall.

### 1.2 Error envelopes (unchanged shape)

Non-stream (`POST /api/mobile/fitzy/chat`) and legacy coach, HTTP 429:

```json
{ "success": false, "data": null,
  "error": { "code": "UPGRADE_REQUIRED",
    "message": "Start your free trial to chat with Fitzy.",
    "details": { "feature": "fitzy_unlimited", "used": 0, "limit": 0,
      "paywall": { "trigger": "fitzy_quota", "headline": "Try Pro free for 3 days",
        "bullets": ["Unlimited coaching with Fitzy, every day", "A weekly plan built around your goals",
                    "Fitzy remembers your routines and preferences", "Cancel anytime"],
        "cta": "Start free trial", "trialDays": 3, "trialEligible": true } } } }
```

Stream (`POST /api/mobile/fitzy/chat/stream`): HTTP 200 with a single `event: error` frame. This is the shape the endpoint already used:

```
event: error
data: {"code":"UPGRADE_REQUIRED","message":"Start your free trial to chat with Fitzy.","paywall":{...same object...}}
```

### 1.3 Copy

| | Trial eligible | Not eligible |
|---|---|---|
| message (limit 0) | `Start your free trial to chat with Fitzy.` | `Upgrade to Pro to chat with Fitzy.` |
| paywall.headline | `Try Pro free for 3 days` | `Unlock Fitzy Pro` |
| paywall.cta | `Start free trial` | `Continue with Pro` |
| paywall.bullets | 3 feature bullets + `Cancel anytime` | the 3 feature bullets |

- **Limit above 0:** if Admin Tools raises the free limit, the message reverts to the old wording ("You've used today's free Fitzy messages…"). The headline and CTA stay trial-aware.
- **Other triggers:** `weekly_plan`, `memory` and `history` paywalls are unchanged, with no new fields.

**Trial eligibility** (`trialEligible`) is the server's best guess and only affects copy:
- Eligible means `profiles.trial_started_at` is null and `subscription_platform` is not a store (`app_store`, `play_store` or `stripe`). A lapsed complimentary grant (`promotional`) is still eligible.
- If either column is unknown, the user is treated as not eligible.

**Trigger values:** no new Fitzy `trigger` value was added. Both decoders also tolerate unknown values: iOS `FitzyPaywall.trigger` is a lenient `String` and Android uses `String` with `ignoreUnknownKeys`.

**Onboarding exemption:** the tour's "Ask Fitzy" step sends `context: "onboarding"`. Free users who have not completed onboarding get up to 3 answers a day there (`ONBOARDING_FREE_FITZY_MESSAGES`). Shipped 1.1.x apps show a dead-end "Ask me again later" error at that step instead of a paywall, so blocking it would break the tour. After onboarding is complete, the context unlocks nothing.

## 2. Pre-send signal (no extra round trip)

From `GET /api/mobile/entitlements`, a client must not send, and should show the paywall, when:
- `features.fitzy_unlimited.allowed === false` and `limits.fitzyMessagesPerDay === 0`, or
- `features.fitzy_unlimited.allowed === false` and the day's messages are used. `remaining` comes from the chat `meta` or `done` event.

`limits.fitzyMessagesPerDay` already existed. It now carries the resolved remote-config value for free users (0 by default) and 200 for Pro.

## 3. Teaser promo: `fitzy_recommendations` (promo@1)

**Audience:** all conditions must hold.
- `isPro === false`. Trialing users are premium, so they are excluded.
- `subscriptionsEnabled`.
- Onboarding is complete and `profiles.goals` has at least one goal. This is what Fitzy needs to build a personalized weekly plan; the plan itself is Pro by tier.
- A **real** free weekly-plan preview exists: a `fitzy_plans` row for this week or last week whose commitments came from the model (`is_preview` with `model` set), or a real plan (lapsed Pro). The deterministic fallback commitments (model failed, `model` null) do not count. Trace reasons: `no_plan_yet` / `plan_unknown`.
- **No sign-up delay and no meal required** — the card shows from session 1 (most users are lost on day 0).

**Eager preview:** `POST /api/mobile/onboarding/complete` runs `warmFitzyPlanPreview` after the response (free users with goals only; one Haiku call, cached for the week as the `is_preview` row the plan screen already uses). Users who completed onboarding before this shipped get it from the feed: when a free, ready user has no real preview, the feed schedules the same warm-up after the response, so the card can show next session. The plan-preview read (one indexed query) only runs for free users with onboarding complete and a goal.

**Caps (early but not spammy):** shown on at most 3 distinct days a week (any number of sessions within a day — the day-0 window is the point), hidden for 72 hours after a dismiss, gone after conversion (`subscription_started`).

**Day-0 coordination / priority:** score 956, just above `pro_value` (955). When `fitzy_recommendations` is selected, `pro_value` (one paywall card at a time) and `meet_fitzy` (one Fitzy card at a time) are dropped; the trace shows `superseded_by_fitzy_recommendations`. The feed's 2-promo cap (G7) still applies; `first_meal` is a utility card exempt from it. So on day 0 a brand-new user sees `first_meal` (hero) + the teaser; after the first meal, `log_meal_now` (in its meal window) + the teaser.

**Pro lifecycle:** cards such as `trial_expiring` supersede the teaser and `pro_value`, via `SUPERSEDED_PROMO_KEYS`.

| | Trial eligible (`fitzy_recs_trial`) | Not eligible (`fitzy_recs_pro`) |
|---|---|---|
| eyebrow | `Fitzy` | `Fitzy` |
| title | `Fitzy has recommendations for you` | same |
| body | `Start your free 3-day trial to get your personalized plan.` | `Go Pro to get your personalized weekly plan from Fitzy.` |
| button | `Start free trial` | `See Pro` |
| action | `{type:'paywall', params:{placement:'fitzy_recommendations'}}` | same |

### 3.1 `meet_fitzy` copy (no bait-and-switch)

Audience unchanged (logged a meal, never opened Fitzy). Copy now depends on the tier:

| | Free, trial-eligible (`meet_fitzy_free_trial`) | Free, not eligible (`meet_fitzy_free`) | Pro / trial (`meet_fitzy_v1`) |
|---|---|---|---|
| title | `Meet Fitzy, your AI coach` | same | same |
| body | `Get a free daily focus from Fitzy. Chatting with Fitzy is part of Pro, with a free 3-day trial.` | `Get a free daily focus from Fitzy. Chatting with Fitzy is part of Pro.` | `Ask anything about your meals. Fitzy can tell you what is working and what to try next.` |
| button | `Meet Fitzy` | `Meet Fitzy` | `Chat with Fitzy` |
| action | `open_screen {screen:'fitzy'}` (no prefilled question) | same | `open_screen {screen:'fitzy', prompt:<last meal>}` |

**Admin visibility:** the promo appears in `SYSTEM_PROMOS`, so it shows in Admin Tools → Home feed → promo looks with the label "Fitzy recommendations".

**Pause:** `PROMOS_DISABLED_KEYS=fitzy_recommendations`.

**Shipped clients:**
- iOS 1.1.2 accepts the placement (token regex) and opens its generic paywall (`dashboardCard` context, analytics source `pro_card`).
- Android vc52 opens its `PROMO` paywall context and reports `source = fitzy_recommendations`.

## 4. Unlock audit (verified by tests)

**Trial start:**
- **Path:** RevenueCat `INITIAL_PURCHASE` with `period_type: TRIAL` sets `profiles.subscription_tier = 'premium'` and `subscription_status = 'trialing'` in the same webhook. The stores covered are `APP_STORE`, `PLAY_STORE` and `STRIPE`.
- **Stripe web trial:** `/api/webhooks/stripe` forwards the receipt to RevenueCat, which emits the same event.
- **Pull fallback:** `POST /api/mobile/subscriptions/sync`.

**What unlocks:** every server Pro check reads the same column through `normalizeTier` / `UsageService.getTier`, treating premium and enterprise alike. After a trial start:
- every `feature_gates` key returns `allowed`, including `ads_removed`, so ads are gone,
- the Fitzy and food quotas lift,
- `fitzyTier` becomes `pro`, which unlocks the plan, memory and conversation history,
- history and circles become unlimited,
- `subscription.isTrial` is true.

**Re-locking:**
- `CANCELLATION` (unsubscribe) keeps Pro until `EXPIRATION`.
- `EXPIRATION` re-locks everything.
- A refund-shaped cancellation re-locks immediately.

**Other checks found:** no Pro check bypasses `EntitlementService`'s tier rule. The remaining direct readers use the same premium-or-enterprise collapse:
- web `auth-store`,
- `check-on-login`,
- `referral-service`,
- `pro-lifecycle`.

## 5. AI food analysis: 5 in total for free users

### 5.1 What counts

A **successful** AI model analysis, from any of these:
- photo parse (including the "Fix" / refine call),
- voice parse,
- text describe (`voice-parse` with `source: text`),
- `estimate-item`.

What does not count:
- a failed or fallback parse (the credit is released),
- a cached result,
- manual, search or barcode logging,
- attaching photos to an entry,
- circle meal posts,
- the legacy nutrition coach, which counts against the Fitzy budget instead.

Free users past the allowance are refused even when a cached result exists. No server path runs food AI for them:
- there is no background or auto-analysis on upload,
- training capture only records drafts,
- body-comp photo scan is a separate, premium-gated feature.

### 5.2 Counter (no migration)

The counter is lifetime `count(*)` of `nutrition_parse_log` rows for the user. That table has recorded every successful parse since 2026-06-09, with no retention job. It is indexed on `(user_id, created_at)`.

`UsageService.reserveFoodAi` is race-safe:
1. Insert the row before the model call.
2. Count the user's rows.
3. If the count is over the limit, delete the row and refuse.

Two parallel calls at 4 of 5 can never both pass. The worst case is that both are refused and the user retries. On model failure the row is deleted, so the credit is released.

Pro and trial users only have the 100-a-day ceiling. Analyses made during a trial count toward the free allowance after it lapses.

### 5.3 Blocked response (photo-parse, voice-parse, estimate-item)

The envelope is unchanged: HTTP 429, `UPGRADE_REQUIRED`, `details.{feature, used, limit}`, plus an additive `details.paywall`:

```json
{ "trigger": "food_ai", "headline": "Unlock food logging analysis",
  "body": "You've used your 5 free AI food analyses. Start your free 3-day trial to keep logging with AI.",
  "bullets": ["AI analysis for every meal photo and description", "Calories and macros in seconds",
              "Fitzy coaching and your weekly plan", "Cancel anytime"],
  "cta": "Start free trial", "trialDays": 3, "trialEligible": true }
```

**Non-trial copy:** body "…Upgrade to Pro to keep logging with AI.", cta `Continue with Pro`, and no "Cancel anytime" bullet.

`error.message` is the body. On photo-parse without `skip_fallback_save` it also ends with "We saved your photo so you can add the details."

`feature` stays `food_ai_unlimited`. `details.paywall` is new on food routes, so no shipped decoder reads it. Both apps decode `details` as a loose map, which is safe.

### 5.4 The meal is never lost

**Photo-parse without `skip_fallback_save`** (every shipped request):
- The server saves the photo as a normal food-log entry with blank macros (Option B) and returns `details.savedEntryId`. The photos attach right after the response.
- If the same photos and note are refused again within 24 hours, the server returns the same entry instead of creating a duplicate. The entry is tagged with `metadata.unparsed_photo_key`. This stops iOS background retries from piling up blank entries.

**After the user subscribes:** "Re-analyze" on that entry calls photo-parse with the stored photo (and, on new clients, `skip_fallback_save` + `existing_entry_id`). That fills the entry in.

**Saving a photo meal with no analysis:** `POST /api/mobile/food-log` followed by `POST /api/mobile/food-log/{id}/images` (or `/images/batch`). Free users can always do this; no AI runs on that path.

### 5.5 Entitlements

These limits are additive:

| field | free (gate live) | Pro / trial | gate dark |
|---|---|---|---|
| `limits.foodAiAnalysesTotal` | resolved remote config (5) | null | null |
| `limits.foodAiAnalysesRemaining` | max(0, total − lifetime analyses) | null | null |

`limits.foodAiParsesPerDay` is unchanged: 5 for free users, which older displays read; 100 for Pro; 25 legacy.

Clients pre-gate on `foodAiAnalysesRemaining === 0` before uploading.

## 6. Remote config (free-tier limits without a deploy)

### 6.1 Registry (`lib/remote-config/registry.ts`)

Adding a key needs a deploy. Changing a value does not.

| key | type | default | min–max | unit |
|---|---|---|---|---|
| `free_food_ai_analyses_total` | int | 5 | 0–1000 | analyses (lifetime) |
| `free_fitzy_messages_per_day` | int | 0 | 0–200 | messages/day |

Premium abuse ceilings stay in code (`lib/config/tier-limits.ts`).

### 6.2 Storage: migration `129_remote_config.sql` (written, NOT applied)

- **`remote_config_defaults`:** `config_key` pk, `value` jsonb, `updated_by`, `updated_at`.
- **`remote_config_rules`:** `id` uuid pk, `config_key`, `name`, `enabled`, `priority` int, `audience` jsonb, `value` jsonb, `created_by`, `created_at`, `updated_by`, `updated_at`.
- **`remote_config_changes`:**
  - columns: `id`, `config_key`, `target` (`default` or `rule`), `rule_id`, `action` (`create`, `update` or `delete`), `actor`, `before`, `after`, `at`;
  - the service layer writes one row per write.

**Access:** RLS is enabled with no policies, and anon/authenticated are revoked, so only the service role can read or write. There are no procedures or triggers.

**Until 129 is applied:** reads see `42P01` and serve the code defaults, so behaviour equals the code defaults above.

### 6.3 Audience (all conditions must match; zod-validated)

`platforms[]` (ios, android, web), `appVersionGte`, `appVersionLt`, `countries[]` (ISO2), `channels[]` (`user_attribution.channel`), `signupAfter`, `signupBefore` (ISO date), `daysSinceSignupGte`, `daysSinceSignupLt`, `percent` (0–100) with `bucketSalt` (defaults to the rule id; uses `bucketOf`), `experiment {key, arms[]}` (the user's stored `experiment_assignments` arm), `userIds[]`, `excludeUserIds[]`.

If a context value a condition needs is unknown, the condition does not match.

### 6.4 Resolution

`RemoteConfigService.resolveConfig(key, ctx)` picks the first of:
1. the enabled, matching rule with the highest priority (ties go to the oldest),
2. the admin default row,
3. the code default.

Values are validated against the registry bounds on write and on read. An invalid value falls through to the next source.

**Cache:** per instance, `swrCache` keeps entries fresh for 30 seconds and serves stale entries for up to 10 minutes. On a DB error it serves the last good snapshot, or the code default if there is none. Write operations clear this instance's cache; other instances pick up the change within 30 seconds.

**Context:**
- `platform`, `appVersion` and `country` come from the current request's headers (`X-App-Platform`, `X-App-Version`, `x-vercel-ip-country`) through `next/headers`. They are unknown outside a request.
- Sign-up date comes from the profile the quota check already reads.
- `channel`, `signup` and the experiment arm are read lazily, only when a candidate rule needs them.

**Integration:**
- `UsageService` uses these values for the food allowance and the Fitzy daily limit.
- Entitlements `limits.fitzyMessagesPerDay`, `foodAiAnalysesTotal` and `foodAiAnalysesRemaining` report the resolved values.
- Lowering a limit below what a user has used gives remaining = 0.

### 6.5 Admin API

Auth matches `/api/admin/experiments`: `Bearer ADMIN_API_SECRET` plus `X-Admin-Actor` (required on writes), or an `is_admin` session.

Responses use the standard `{success, data, error, meta}` envelope. Validation errors are 400 `VALIDATION_ERROR` with `error.details.issues: [{path, message}]`, also copied to `data.issues`. An unknown key or rule returns 404.

| Method | Path | Body | `data` |
|---|---|---|---|
| GET | `/api/admin/remote-config` | — | `{ keys: [{ key, type, min, max, unit, description, codeDefault, default: {value, updatedBy, updatedAt} \| null, rules: [{id, key, name, enabled, priority, audience, value, valid, createdBy, createdAt, updatedBy, updatedAt}] }] }` |
| PUT | `/api/admin/remote-config/{key}/default` | `{value}`; `null` resets to the code default | `{ key, default, codeDefault }` |
| POST | `/api/admin/remote-config/{key}/rules` | `{name, enabled?, priority?, audience?, value}` | the rule (201) |
| PATCH | `/api/admin/remote-config/rules/{id}` | any of `{name, enabled, priority, audience, value}` | the rule |
| DELETE | `/api/admin/remote-config/rules/{id}` | — | `{deleted: true, id}` |
| GET | `/api/admin/remote-config/changes?key=` | — | `{ changes: [{id, key, target, ruleId, action, actor, before, after, at}] }` (newest first, at most 200) |
| POST | `/api/admin/remote-config/preview` | `{userId, platform?, appVersion?, country?}` | `{ userId, values: {key: {value, source: 'rule'\|'default'\|'code', ruleId?, ruleName?}}, context: {platform, appVersion, country, channel, signupAt, experimentArms, now} }` |
| POST | `/api/admin/remote-config/{key}/estimate` | `{audience}` | `{ count, total, approximate: true, ignored: [...] , note? }` |

**Field notes:**
- **Rule fields:** `enabled` defaults to false and `priority` defaults to 0. `valid` is false when a stored rule fails the current bounds or audience schema. Such a rule is skipped at resolution.
- **Preview** reads fresh rows, not the cache. Fields the body leaves out come from the user's attribution row, so `appVersion` is unknown unless supplied. The extra body fields beyond `{userId}` are additive.
- **Estimate** scans all profiles with their stored attribution and assignments:
  - It is cheap at today's ~240 users and is capped at 50k.
  - `appVersionGte` and `appVersionLt` are ignored because they are per request; they are listed in `ignored`.
  - Platform comes from the install platform in attribution.
  - A `percent` without `bucketSalt` uses a placeholder salt, flagged in `note`.

### 6.6 Protecting old clients with version rules

Every 1.1.0+ build sends `X-App-Platform` (`ios` / `android`) and `X-App-Version` (plain, e.g. `1.1.2`) on **every** request: iOS `AppClientHeaders` on the `APISession` configuration and on each built request; Android `ClientInfoInterceptor` (also `X-Platform`, `X-App-Build`). The resolver reads them through `next/headers` inside the route (Fitzy chat, food parses, entitlements). Versions compare numerically (`1.10.0` > `1.2.0`; suffixes like `1.2.0 (88)` are tolerated).

Recommended deploy-time setup (unknown versions fall to the safe side):
- admin **default** = the old-client value (e.g. `free_fitzy_messages_per_day` 5, `free_food_ai_analyses_total` 1000);
- per platform, a rule `{ platforms: ['ios'], appVersionGte: '<first build that handles the paywall>' }` (and one for `android`) with the strict value (0 / 5).

A request without the headers (pre-1.1.0 non-feed calls, web, server jobs) has an unknown version, never matches an `appVersionGte` rule, and gets the default. Proven by `apps/web/app/api/mobile/__tests__/remote-config-version-rules.test.ts`, which drives `GET /api/mobile/entitlements` and the Fitzy / food gates with the shipped apps' real header sets (`home-feed/__tests__/fixtures/{ios,android}-1.0.8.request.json`, version overridden).

## 7. Web (fitcircle.ai)

**Fitzy chat** (`components/nutrition/FitzyChat.tsx`, in the navbar drawer and on circle pages):
- **Pre-send gate:** from `/api/entitlements`, `isFitzyChatLocked` checks `features.fitzy_unlimited.allowed === false` and `limits.fitzyMessagesPerDay === 0`. When locked, the message is not sent and the typed text stays in the box.
- **Server refusal:** on `UPGRADE_REQUIRED` the same card is shown.
- **Card copy:**
  - when a trial applies: "Try Pro free for N days", "Cancel anytime…", and a "Start free trial" button linking to `/upgrade?source=fitzy_send` (the Paywall Viewed source in tracking plan v29);
  - otherwise: "Unlock Fitzy Pro" / "Continue with Pro".

**Trial check:** `GET /api/billing/trial` returns `{trialDays, eligible}`. It applies the same rule as checkout: `STRIPE_TRIAL_DAYS > 0`, plus `BillingService.isWebTrialEligible`, plus subscriptions enabled. Web shows trial copy only when checkout would really include the trial.

**`/upgrade`:**
- the headline is "Try Pro free for N days" with "Cancel anytime" when a trial applies;
- the CTA is "Start free trial", with the line "Free for N days, then $X. Cancel anytime before the trial ends and you won't be charged.";
- `PlanComparison` shows the viewer's resolved free limits.

**Free-plan copy:** the landing page, FAQ and Settings → Billing now describe 5 free AI analyses in total and Fitzy chat as part of Pro.

## 8. Files

- **Backend:**
  - `lib/config/tier-limits.ts`
  - `lib/entitlements/trial-eligibility.ts`
  - `lib/fitzy/paywall.ts`, `lib/fitzy/http.ts`
  - `lib/types/fitzy.ts`, `lib/types/body-composition.ts`
  - `lib/services/usage-service.ts`, `entitlement-service.ts`, `fitzy-service.ts`, `nutrition-intelligence-service.ts`, `home-feed-service.ts`, `promo-service.ts`
  - `lib/promos/{system-promos,journey-context,types,style-config}.ts`
  - `lib/pro-lifecycle/card.ts`
  - `lib/home-feed/cache.ts`
  - `lib/remote-config/*`
- **Routes:**
  - `api/mobile/fitzy/chat/route.ts`
  - `api/mobile/nutrition-coach/route.ts`
  - `api/mobile/food/{photo-parse,voice-parse,estimate-item}/route.ts`
  - `api/admin/remote-config/**`
  - `api/billing/trial/route.ts`
- **Migration:** `supabase/migrations/129_remote_config.sql`
- **Web:**
  - `components/nutrition/FitzyChat.tsx`, `components/billing/PricingCards.tsx`
  - `upgrade/page.tsx`, `settings/billing/page.tsx`, `page.tsx`
  - `components/landing/faq.ts`
  - `hooks/useWebTrial.ts`

Also: `lib/fitzy/plan-warmup.ts`, `api/mobile/onboarding/complete/route.ts`, `analytics/tracking-plan.json` (v29) + `lib/analytics/events.generated.ts`.

## 9. Tracking plan (v29)

- `Paywall Viewed.source` (and the Plan Selected / Dismissed descriptions) adds `fitzy`, `fitzy_send` (free user tried to send a Fitzy message), `fitzy_recommendations` (home feed teaser), `food_ai` (lifetime food AI allowance used up).
- `Fitzy Upgrade Tapped.feature` and `Fitzy Locked Feature Viewed.feature` add `send` and `recommendations`.
- Web uses `/upgrade?source=fitzy_send` from the Fitzy chat gate.
- Generated files the mobile branches must pick up (run `node analytics/codegen.mjs` from FitCircleBE on their branch): `FitCircle-iOS/FitCircle/Core/Analytics/AnalyticsEvents.generated.swift`, `Fitcircle-Android/FitCircle/app/src/main/java/com/fitcircle/app/core/analytics/AnalyticsEvents.generated.kt`.
