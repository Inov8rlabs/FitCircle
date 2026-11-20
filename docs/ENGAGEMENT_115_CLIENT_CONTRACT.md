# Release 1.1.5: client contract (iOS + Android)

Status: **backend built on `feat/engagement-115` (not merged, not deployed; migration 138 not applied)**, 2026-11-13.
Last updated after implementation: every shape below is what the code returns (route + service tests).
Source of truth for the *why*: `docs/ENGAGEMENT_115_SPEC.md` (§13 founder decisions win).
This file is the *what*: exact fields, endpoints, headers, push payloads and events.
Everything here is additive. 1.1.2–1.1.4 behaviour is unchanged.

Builds on the shield economy (`feat/shield-economy`, ships first): `shield_rules` on streak
responses, starter shields at onboarding, 1 shield per 7 streak days, cap 3. Tracking plan
**v35** = shields, **v36** = this release.

---

## 0. Headers every 1.1.5 request must send

| Header | Value | Why |
|---|---|---|
| `X-App-Version` | `1.1.5` (marketing version) | Daily scans + weekly Fitzy are remote-config rules `appVersionGte 1.1.5`. **No header → the 1.1.4 behaviour (21 lifetime then paywall; Fitzy daily rule).** |
| `X-App-Platform` | `ios` / `android` | Same rules are per platform. |
| `X-Client-Timezone` | IANA zone, e.g. `America/New_York` | Local day (scans) and local week (Fitzy, Monday 00:00). Missing/invalid → profile timezone → `America/New_York`. |
| `X-Client-Features` | existing list **+ `streak_celebration_v1`** | Tells the server the app shows milestone celebrations in-app, so it does not push them. |

**Background / outbox paths must send the same headers** (iOS `MealAnalysisBackgroundDrain`,
Android `analyzeDeferredMeal`, food-log outbox replay). Without `X-App-Version` +
`X-App-Platform` a daily-phase user is refused with `UPGRADE_REQUIRED`.

New `X-Client-Features` tokens: **`streak_celebration_v1`**, **`meal_drafts`** (§11: the client
shows Draft meals; without it the server never returns a draft)
- iOS: `AppClientHeaders.features` (`Core/Network/APISession.swift`)
- Android: `ClientInfoInterceptor.FEATURES` (`core/network/ClientInfoInterceptor.kt`)

---

## 1. `GET /api/mobile/entitlements` (additive)

Two new top-level objects. Decoders must treat every field as optional.

```json
{
  "tier": "free",
  "features": { "...": "unchanged" },
  "limits": {
    "foodAiParsesPerDay": 100,
    "fitzyMessagesPerDay": 0,
    "foodAiAnalysesTotal": 21,
    "foodAiAnalysesRemaining": 2
  },
  "allowances": {
    "foodScans": {
      "mode": "daily",
      "remaining": 1,
      "starterTotal": 21,
      "starterRemaining": 0,
      "dailyLimit": 2,
      "dailyRemaining": 1,
      "resetsAt": "2026-11-14T05:00:00.000Z",
      "timezone": "America/New_York"
    },
    "fitzy": {
      "mode": "weekly",
      "limit": 3,
      "used": 1,
      "remaining": 2,
      "window": "week",
      "resetsAt": "2026-11-17T05:00:00.000Z"
    }
  },
  "clientConfig": { "mealSharePrompt": true, "streakSaveOffer": true }
}
```

### `allowances.foodScans`

| Field | Type | Meaning |
|---|---|---|
| `mode` | `"unlimited" \| "legacy" \| "starter" \| "daily" \| "exhausted"` | `unlimited` = Pro/trial (100/day abuse ceiling, never a paywall). `legacy` = gate dark. `starter` = inside the 21 lifetime scans. `daily` = starter used up, N per local day. `exhausted` = starter used up and no daily allowance (old builds / web). |
| `remaining` | int \| null | Scans the next request may use. `null` = no product limit (`unlimited` / `legacy`). |
| `starterTotal` | int \| null | Lifetime starter allowance (21). null for unlimited/legacy. |
| `starterRemaining` | int \| null | `max(0, starterTotal − lifetimeUsed)`. |
| `dailyLimit` | int \| null | Resolved daily allowance (2). null when 0 or user not free. Use it in "after this you get N free scans a day". |
| `dailyRemaining` | int \| null | Only when `mode = daily`. |
| `resetsAt` | ISO instant \| null | Next local midnight, only when `mode = daily`. |
| `timezone` | IANA string | The zone the day was computed in. |

Legacy `limits.foodAiAnalysesRemaining` = `allowances.foodScans.remaining` **only when the daily
allowance resolves > 0 (1.1.5)**; otherwise the lifetime remaining as before.

### `allowances.fitzy`

| Field | Type | Meaning |
|---|---|---|
| `mode` | `"unlimited" \| "weekly" \| "daily" \| "locked"` | `unlimited` = Pro or gate dark (all other fields null). `weekly` = 1.1.5 free. `daily` = old daily rule > 0. `locked` = free with daily limit 0 (first message → paywall). |
| `limit` | int \| null | Weekly (or daily) allowance. |
| `used` | int \| null | Counted messages in the window (onboarding-tour and trial messages never count). |
| `remaining` | int \| null | `max(0, limit − used)`. |
| `window` | `"week" \| "day" \| null` | |
| `resetsAt` | ISO \| null | Week: next **Monday 00:00 local**. Day: next UTC midnight. |

**Gate rule:** when `allowances` is present, gate Fitzy sends on `allowances.fitzy.remaining == 0`
(not on `features.fitzy_unlimited.allowed == false` — weekly users are free but have messages).

### `clientConfig`

| Field | Default | Meaning |
|---|---|---|
| `mealSharePrompt` | `true` | Show the "Share to circles" card on the meal-logged success sheet. `false` → success sheet without the card. |
| `streakSaveOffer` | `true` | Replace the dashboard auto-fired shield paywall with a "Save your streak" card that opens the save flow (§6). |

---

## 2. Food scans (F2)

### Refusal — `photo-parse`, `voice-parse`, `describe`, `estimate-item`

Same 429 envelope and code as today. `details` adds `allowance` (the `foodScans` object *after*
the refusal):

```json
{ "success": false, "data": null, "meta": null,
  "error": { "code": "UPGRADE_REQUIRED",
    "message": "You've used today's 2 free AI scans. We saved your photo so you can add the details.",
    "details": {
      "feature": "food_ai_unlimited", "used": 2, "limit": 2,
      "savedEntryId": "uuid (only when the photo was saved, unchanged Option B)",
      "allowance": { "mode": "daily", "remaining": 0, "starterTotal": 21, "starterRemaining": 0,
                     "dailyLimit": 2, "dailyRemaining": 0, "resetsAt": "2026-11-14T05:00:00.000Z",
                     "timezone": "America/New_York" },
      "paywall": { "headline": "Scan every meal",
                   "body": "You've used today's 2 free scans. They reset at midnight, or scan every meal with Pro.",
                   "...": "existing bullets / trial fields" }
    } } }
```

- Daily phase: `used`/`limit` are the **daily** numbers. Starter / exhausted phase: unchanged copy, numbers and headline ("Unlock food logging analysis") — only `details.allowance` is added.
- `voice-parse` (voice + describe) keeps its own saved-note suffix: "… We saved your note so you can add the details."
- `estimate-item` has no Option B (no `savedEntryId`).
- Copy rule (§13.5): **"Scan every meal"**; never "unlimited" for scans.
- No AI is spent on a refused scan (refusal happens before any model call).

### Client behaviour (summary, see spec §2.4)
Meter copy from `allowances.foodScans`; at `remaining == 0` do **not** upload — open placement
`food_scan_limit` with the captured photo as hero, headline "Scan every meal", subhead
"Get calories and macros for this meal in seconds". Plan/badge/disclosure from
`GET /api/mobile/paywall/config` (never hard-code annual). Dismiss → manual logging with the photo
+ banner "Free scans reset at midnight (in {h}h)" (`exhausted`: "Add the details yourself").

**Refused after the photo was saved (`details.savedEntryId` present) → purchase → re-analyze that entry.**
Yes, re-run analysis on the saved entry (no duplicate): `POST /api/mobile/food/photo-parse`
(multipart, the same `image` file(s) the client still holds) with form fields
`existing_entry_id=<savedEntryId>` and `skip_fallback_save=true`. It returns the usual draft and
saves nothing; commit it with `PATCH /api/mobile/food-log/{savedEntryId}`. Voice / describe:
`POST /api/mobile/food/voice-parse` with the same two fields. There is no id-only re-analyze
endpoint (the server does not re-run the model on stored photos).

### Analysis job id — `X-Analysis-Job-Id` (spec §14.4 item 3)

Optional request header on `POST /api/mobile/food/photo-parse`, `POST /api/mobile/food/voice-parse`
and `POST /api/mobile/food/estimate-item`. Additive: old clients send nothing and nothing changes.

```
X-Analysis-Job-Id: 3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23
```

- **Value:** 8–64 characters of `[A-Za-z0-9_-]` (a lower-case UUID is ideal; the server lower-cases).
  Anything else is ignored (never an error).
- **One id per analysis of one capture.** Create it when the user captures / submits; reuse it
  for every resend of that same content: queue retry, background-session resend, resume after
  relaunch, re-opening the review, **and a user-tapped "Retry" after a failed / timed-out analysis
  of the same photo(s) / text**. Generate a **new** id only for a "Fix" (correction), a "Re-analyze"
  the user asks for on a result they already got, or new content (new photo, edited text). A Fix
  (`correction` field) never matches a job.
- **Retry is never charged twice:** a failed analysis is not charged at all (its credit is
  released), so the retry is the one counted analysis; if the first attempt actually succeeded on
  the server but the response was lost, the retry (same id or same bytes) returns that result and
  is not charged again.
- **Server behaviour** (window 10 minutes, per user):
  - A repeat of an analysis that was already counted (same job id, or byte-identical photo(s)+note,
    or the identical transcript / item) is **never counted again** and is **never refused** with the
    free-scan paywall, even when that analysis used the last free scan.
  - Photo: the response is the first analysis' result (`cached: true`, `parseHash` of the first
    analysis) when it is available; if the first is still running, the server waits up to ~6 s for it.
    A job repeat with *different* bytes whose first result is not available is analysed and counted
    as new (the job id never unlocks a free analysis of new content), so keep the uploaded bytes
    stable across retries when you can.
  - Voice / text / estimate-item: an identical repeat is analysed again but not counted.
- Old clients already get the content-identical dedupe (no header needed); the header covers retries
  that re-encode the photo.

---

## 3. Fitzy (F3)

`POST /api/mobile/fitzy/chat` response `data` and SSE `meta` + `done` events of
`POST /api/mobile/fitzy/chat/stream` add (all optional, null for Pro):

| Field | Type | Meaning |
|---|---|---|
| `remaining` | int \| null | (existing) remaining **after** this message; weekly remaining in weekly mode |
| `limit` | int \| null | new |
| `window` | `"week" \| "day" \| null` | new |
| `resetsAt` | ISO \| null | new |

Refusal (429 `UPGRADE_REQUIRED`), before any write or model call:

```json
"error": { "code": "UPGRADE_REQUIRED",
  "message": "You've used this week's 3 free Fitzy messages. They reset Monday.",
  "details": { "feature": "fitzy_unlimited", "used": 3, "limit": 3, "window": "week",
               "resetsAt": "2026-11-17T05:00:00.000Z",
               "paywall": { "headline": "Keep chatting with Fitzy", "...": "existing fields" } } }
```
(trial-eligible users get the trial headline, as today.) `nutrition-coach` shares the same quota.

SSE stream: the refusal is a single `error` frame `{ code, message, paywall, details }` — `details`
(with `window`/`resetsAt`) is present **only in weekly mode**; the 1.1.4 daily frame is byte-identical.
The 1.1.4 daily refusal (`window` absent in `details`) is unchanged on every route.

Placement for the pre-send gate: **`fitzy_weekly_limit`**. Counter copy:
"{remaining} of {limit} free messages this week"; at 0 "Free messages reset Monday".

---

## 4. Meal sharing (F4)

### `GET /api/mobile/food-log/share-targets` (auth, `Cache-Control: private, no-store`)

```json
{ "success": true, "error": null, "meta": null, "data": {
  "sharing_default": "unset",
  "circles": [
    { "circle_id": "uuid", "name": "Morning Movers", "member_count": 6,
      "avatar_urls": ["https://…"], "default_on": true, "reason": "friend_circle" }
  ] } }
```

- `sharing_default`: `on` | `off` | `unset` (stored `preferences.privacy.share_meals_with_circles`).
- `member_count` = active members including the user.
- `avatar_urls`: ≤ 3 (other members first). Max 30 circles; order = most recent chat activity, then name.
- `reason`: `remembered` | `circle_privacy` | `sharing_default_off` | `made_private` | `public_circle` | `large_circle` | `friend_circle`.
- Only `default_on: true` circles are pre-toggled. **Nothing posts until the user taps Share.**

### `POST /api/mobile/food-log/{id}/share` — new body shape

The route already exists with the legacy `{share_with, user_ids|circle_id}` body (unchanged).
A body with a `circles` array uses the new behaviour:

```json
{ "circles": [ { "circle_id": "uuid", "share": true }, { "circle_id": "uuid", "share": false } ],
  "remember": true }
```

- Send **every** row the user saw (max 100). `remember` defaults to `true` (upserts the per-circle memory; `false` = remember nothing, e.g. "Edit" of a single meal if you prefer).
- Circles the user is not an active member of are ignored (never an error).
- Offline: queue this call after the create in the outbox; it is idempotent, safe to replay.
- Response `200`:
```json
{ "success": true, "error": null, "meta": null,
  "data": { "entry_id": "uuid", "is_private": false, "visibility": "circle",
            "shared_circle_ids": ["uuid"], "posted": 1, "retracted": 0 } }
```
- All `share:false` → the meal becomes private, all cards retracted (`is_private: true`, `visibility: "private"`, `shared_circle_ids: []`).
- Idempotent; retry-safe on 500. Errors: `400 VALIDATION_ERROR`, `400 UNSHAREABLE` (water / supplement), `401`, `404 NOT_FOUND` (not the owner).

### Create / edit
`POST /api/mobile/food-log` and `PATCH /api/mobile/food-log/{id}` accept optional
`share_circle_ids: string[]` (uuids, max 50). Honoured **only with `share_with_circles: true`**.
- **`share_circle_ids: []` + `share_with_circles: true` = share to none**: treated exactly like
  `share_with_circles: false` (private, list cleared, cards retracted). It is never "all circles".
  Omitting the field is the only way to ask for the legacy all-`full`-circles rule.
- Optional **`share_seen_circle_ids: string[]`** (max 100) = every circle row the user saw on the
  share card. With it, the server remembers each choice exactly like `POST /share {remember:true}`
  (seen ∩ `share_circle_ids` → on, the other seen rows → off). Send it **only when the user tapped
  Share** (an offline-queued share inside the meal create/update). Absent → the defaults are not
  touched (1.1.4 bodies are unchanged).
- Chip on at save → send `share_circle_ids` = the cached `default_on` circle ids. No cached targets → omit the field (server legacy rule: every active circle where the user's tier is `full`).
- PATCH without the field keeps the stored list; `share_with_circles: false` clears it.
- Entry responses add `share_circle_ids: string[] | null`.

### Circle chat meal card payload (`meal_card` system post)
Adds `image_width`, `image_height` (int | null, primary image). Thumbnail: 180 pt/dp wide, height
`180 / aspect` clamped 135–240 (unknown → 135), `?size=medium`; viewer `?size=original`.

---

## 5. Pushes

All pushes carry `type`, `category`, `screen`, `dedupeKey`, `notification_id`.

| `type` | When | `screen` | `route` | Extra data keys |
|---|---|---|---|---|
| `dont_miss_twice` | D+1 after a first missed day, user's usual log hour (8–20, after quiet hours) | `food_log` (meal / plain / restart / shield_saved), `exercise_log` (workout) | `log_meal_camera` (meal variants only) | `mealType`, `variant` (`shield_saved`\|`meal`\|`workout`\|`streak_restart`\|`plain`), `missedDate` (YYYY-MM-DD), `streakDays` |
| `streak_save_offer` | D+1, free user's streak (≥ 3) broke with no shield | `streaks` | `streak_save` | `missedDate`, `lostStreak`, `offerId` |
| `milestone_achieved` | Milestone reached and the app did **not** show it (no `streak_celebration_v1`, or a sync claim) | `streaks` | `streak_milestone` | `milestone` (days) |
| `first_meal_nudge` | Once per user: finished onboarding with no meal (and no draft); the first lunch 12:30 / dinner 18:30 slot ≥ 60 min and ≤ 24 h after onboarding (§12) | `food_log` | `log_meal_camera` | `mealType` (`lunch`\|`dinner`) |

`streakDays` on `dont_miss_twice`: the kept streak for `shield_saved`, `0` after a break, else the
current streak. `category`: `momentum` for both D+1 types, `celebration` for `milestone_achieved`.
`milestone_achieved` reached during quiet hours is held and delivered when quiet hours end.

- One D+1 push per lapse (`dont_miss_twice` **or** `streak_save_offer`).
- `streak_lost` / `shield_applied` night pushes are retired while `DONT_MISS_TWICE_PUSH_ENABLED` is on (types kept for old deep links). **The switch is OFF by default** (founder enables it in prod), so until then old night pushes continue and no D+1 push is sent.
- `first_meal_nudge` (title "Snap your lunch|dinner", body "Take a photo and FitCircle works out the calories in seconds."): `category` `momentum` (the meal-reminder toggle mutes it), counts toward the daily cap, quiet hours skip it (never deferred), replaces that slot's regular meal reminder. Android: add the type to any type allowlist; route/keys are the meal-reminder ones.
- Android: add `route` values `streak_save`, `streak_milestone`, `log_meal_camera` to `ALLOWED_ROUTES` and data keys `missedDate`, `lostStreak`, `offerId`, `variant`, `streakDays`, `milestone`, `mealType` to `ALLOWED_DATA_KEYS`.

---

## 6. Streak save (F6)

### `GET /api/mobile/streaks/save-offer` (auth, no-store)

```json
{ "success": true, "error": null, "meta": null, "data": {
  "eligible": true, "offer_id": "uuid", "missed_date": "2026-11-12", "lost_streak": 12,
  "restored_streak": 13, "expires_at": "2026-11-14T08:00:00.000Z", "path": "paywall",
  "shields_available": 0, "unlimited": false } }
```
**`?peek=1` = read-only check**: same response, but no offer row is created and it is never
marked opened. Use it for every dashboard / Streaks card poll. Call it **without** `peek` only when
the user actually opens the save flow (push tap with `route=streak_save`, or a card tap that shows
the save sheet / paywall). Only a real open arms the post-purchase webhook rescue.

Ineligible: `{ "eligible": false, "reason": "nothing_to_save" | "expired" | "zombie_guard" | "too_short" }`
(other fields omitted). `path`: `activate` (Pro, or free with shields) | `paywall`.
`restored_streak` = `lost_streak` + 1 (for D) + 1 if today is already claimed.
Calling it without `peek` marks the offer opened (creates the row if no push did).

### Saving
Existing `POST /api/streaks/freeze/activate` `{ "date": "<missed_date>" }` → `{ shieldsRemaining, unlimited, date }`.
Now also marks the offer `saved`. After a purchase on the `streak_save` paywall: wait for server
Pro, then call activate. **`ALREADY_CLAIMED` = success** (the RevenueCat webhook backstop may have
saved it already).

Paywall placement **`streak_save`**: headline "Save your {n}-day streak", subhead "Pro includes
unlimited streak shields. Start your free trial and keep all {n} days." (trial wording only when eligible).

---

## 7. Milestone celebrations (F6)

- A create/claim response with `meta.streak.milestone` → show the full-screen celebration (any screen).
- `GET /api/mobile/streaks/celebrations` → `{ "success": true, "data": { "pending": { "milestone": 30, "name": "Monthly Master", "icon": "…", "shields_granted": 1, "reached_on": "2026-11-13" } | null } }`. Call on launch/foreground and on `route=streak_milestone`.
- `POST /api/mobile/streaks/celebrations/ack` `{ "milestone": 30 }` → `204`. Idempotent. Ack after showing (also after showing from a claim response, so it is not shown twice).
- Milestones: 3, 7, 14, 30, 60, 100, 180, 365, 500, 730, 1000.

---

## 8. Paywall placements (all through the shared paywall + `GET /api/mobile/paywall/config`)

| `source` | Opened from |
|---|---|
| `food_scan_limit` | out of scans (pre-gate or server refusal) |
| `fitzy_weekly_limit` | Fitzy send at 0 weekly messages |
| `streak_save` | save-offer `path: paywall` |

Badge is "Best value" (shipped in 1.1.4), per-month rounded down, billed price leads; follow
`docs/PAYWALL_DEFAULT_PLAN.md` §3a sheet-matching rules.

### Trial timeline on every placement (spec §14.1)

`GET /api/mobile/paywall/config` now also returns `trialTimeline: boolean` (remote config
`paywall_trial_timeline`, default `on` → `true`; works signed out). Cache it in `paywall_config_v1`
with the plans; fallback when never fetched: `true`.

```json
{ "success": true, "data": { "defaultPlan": "annual", "badgePlan": "annual", "trialTimeline": true }, "error": null, "meta": { "requestTime": 12 } }
```

- Every placement (onboarding, `food_scan_limit`, `fitzy_weekly_limit`, `streak_save`, `first_meal_aha`,
  Pro card, badge, history limit, …) renders the timeline under the plan cards when `trialTimeline` is
  true AND the selected plan has a confirmed trial (`intro_eligibility` eligible / server_promoted).
  It follows the selected plan; a plan with no trial hides it. Dates come from the store offer, never guessed.
- Onboarding: the `onboarding_paywall` arm payload `trial_timeline` (true or false, when present) wins.
- Paywall Viewed: send `trial_timeline_shown` (bool) on every placement; onboarding also sends
  `paywall_position` (`end` | `after_meal`).
- The reminder promise is now true on every channel: the backend emails the trial reminder when the
  push cannot be delivered (no token, push switched off, failed / non-quiet-hours suppression).
  No client work needed.

### `first_meal_aha` after an onboarding paywall without a scan (spec §14.2)

Server-only rule change: a user whose last automatic paywall (typically the onboarding paywall) came
before they had ever logged a meal now gets the `first_meal_aha` paywall after their first real scan,
even inside the 72 h spacing. It arrives through the existing journey paywall decision (1.1.0+ clients),
so no client change.

---

## 9. App update prompt (old clients)

At release the server flips `app_update_policy` to `recommended_version: "1.1.5"` (soft,
dismissible) with release notes titled "Update to get free daily scans"
(`apps/web/scripts/app-update-115.ts`, dry run by default; not applied yet). 1.1.5 clients see
`status: none`. No client change needed (existing `/api/mobile/app-update` handling).

---

## 10. Analytics (tracking plan v36)

Regenerate: in FitCircleBE run `node analytics/codegen.mjs --only ios` / `--only android`
(paths assume sibling repos `FitCircle-iOS`, `Fitcircle-Android`).

**New enums:** `intro_eligibility` (`eligible|ineligible|unknown|server_promoted`),
`scan_allowance_mode` (`starter|daily|exhausted`), `share_prompt_outcome` (`shared|dismissed|edited`).

**Changed events**
| Event | Change |
|---|---|
| Paywall Viewed | + `intro_eligibility`, `trial_days_offered` (int); `trial_eligible` = selected plan; `source` + `food_scan_limit`, `fitzy_weekly_limit`, `streak_save`; + `trial_timeline_shown` (bool, every placement), `paywall_position` (`end`/`after_meal`, onboarding only) |
| Purchase Started, Purchase Cancelled | + `intro_eligibility`, `trial_days_offered`; `trial_eligible` = bought plan |
| AI Limit Reached | + `allowance_mode` (food), `window` (`week`/`day`, Fitzy), `blocked_before_upload` (bool) |
| Streak Milestone Reached | + `trigger` (`claim_response`/`pending`/`push`) |
| Fitzy Message Sent | + `remaining_after` (int, free only) |

**New events (ios, android)**
| Event | Properties |
|---|---|
| Food Scan Meter Viewed | `mode` (required), `remaining`, `is_last` |
| Food Scan Paywall Resolved | `outcome` (`purchased`/`manual`/`dismissed`), `mode`, `had_saved_entry` |
| Meal Share Prompt Viewed | `circle_count`, `default_on_count`, `already_shared` |
| Meal Share Prompt Resolved | `outcome`, `shared_circle_count`, `toggled_off_count`, `toggled_on_count` |
| Chat Photo Viewed | `kind` (`meal_card`/`user_photo`), `zoomed` |
| Streak Save Offer Viewed | `path` (`activate`/`paywall`), `lost_streak`, `entry` (`push`/`dashboard_card`/`streaks_screen`) |
| Streak Saved | `method` (`shield`/`pro_unlimited`/`after_purchase`), `lost_streak` |

Push Sent / Push Notification Opened: new `notification_type` values `dont_miss_twice`,
`streak_save_offer`, `milestone_achieved` (no schema change).

---

## 11. Draft meals (spec §14.6)

Server switch `MEAL_DRAFTS_ENABLED` (off until migration 139 is applied; then on). While it is off
nothing below happens and no response carries the new fields. Every request below must send
`X-Client-Features: … meal_drafts`.

### Parse responses
`POST /api/mobile/food/photo-parse` and `POST /api/mobile/food/voice-parse` (voice and typed text)
add `data.analysisId` (uuid) to a successful draft when the request declares `meal_drafts` (not
for `skip_fallback_save` / `existing_entry_id` re-analysis or prefill: those entries already exist).
The server holds that result (and the photo). Tell it what happened:

| User action | Call |
|---|---|
| Saves the result | the normal `POST /api/mobile/food-log` with body field **`analysis_id`: `<analysisId>`** (also from the offline outbox). If the result already became a draft (you have not refreshed the list yet), the server confirms that draft with your body instead of inserting a copy: same response shape as a create (`data.id` = the draft's id, `entry_status: "confirmed"`; 200 + `meta.duplicate` when it was already confirmed). Replace your local row by `data.id`. |
| Discards it (review closed with Discard / Retake / back without saving) | **`POST /api/mobile/food/analyses/{analysisId}/discard`** → `200 { data: { discarded: bool } }`; idempotent, `false` = already resolved / unknown |
| Does neither for 30 min | the server turns it into a **Draft meal** (next 15-min cron run) |

A "Fix" (correction) or a re-scan within 15 min supersedes the older result (only the newest can
become a draft). A food entry saved without `analysis_id` within 30 min of a result also stops it
(never two copies). Results with no items never become drafts.

### Draft entries
A Draft meal is a normal food-log row with:

| Field | Value |
|---|---|
| `entry_status` | `"draft"` (`"confirmed"` on every other entry, old ones included) |
| `draft_created_at` | when it became a draft |
| `draft_method` | `photo` \| `voice` \| `text` |
| `draft_analysis_id` | the `analysisId` (also the entry `id`) |
| `logged_at` / `entry_date` / `meal_type` | the capture time, its local day and slot (user's timezone) |
| `title`, `nutrition_data` (`calories`, `protein_g`, …, `items` = the AI items as returned) | the AI result |
| `image_urls` / `photo_url` | the photo (photo drafts) |
| `is_private` | always `true` until confirmed |

- **Lists:** `GET /api/mobile/food-log` (all filters) and `GET /api/mobile/food-log/{id}` include
  drafts **only** with `meal_drafts`. Exclude `entry_status == "draft"` from every total, ring,
  goal and streak UI on the client (the server already does: stats, vitals, Fitzy, insights,
  streaks, circles, leaderboards, challenges, Home feed, analytics).
- **Confirm ("Add to my day"):** `POST /api/mobile/food-log/{id}/confirm`, optional JSON body =
  the PATCH fields (`title`, `meal_type`, `notes`, `nutrition_data`, `calories` …, `tags`) plus the
  share choice, exactly as on a create: `share_with_circles` (bool), `share_circle_ids` (uuid[],
  the 1.1.5 per-circle list, honoured only with `share_with_circles: true`; `[]` with `true` =
  private), `share_seen_circle_ids` (uuid[], remembered per circle). Without `share_with_circles`
  the user's "share new meals" default applies. `logged_at` /
  `entry_date` are ignored (it counts for the day it was eaten). → `200 { data: entry
  (entry_status "confirmed", image_urls), meta: { streak, alreadyConfirmed? } }`, same `meta.streak`
  as a create. Idempotent (`meta.alreadyConfirmed: true`, nothing re-runs). Other user / deleted → 404.
  Send `Meal Logged {method, from_draft: true}` client-side.
- **Edit before confirm:** `PATCH` works; sharing fields are ignored on a draft.
- **Discard a draft:** the normal `DELETE /api/mobile/food-log/{id}`.
- **Share:** `POST /api/mobile/food-log/{id}/share` on a draft → 400 `UNSHAREABLE` (confirm first).
- **Lifetime:** drafts older than 14 days are deleted with their photo. No push for drafts.
- **Home card count:** count `entry_status == "draft"` rows from the list (no extra endpoint).

## 12. Onboarding meal step + first-meal push (spec §14.7, §14.8)

- Experiment `onboarding_meal_step` (created as a draft at release): arm payload
  `meal_step: "example_describe"` for the variant (arm key `variantA`; act on the payload, never the
  key); control has no payload key = today's step.
- "I'll do it at my next meal": `PATCH /api/mobile/onboarding/progress` with
  `data.next_meal_nudge: true` (inside the existing free-form `data` snapshot; keep the other
  answers in `data`, it replaces the saved object). The server carries it on the `first_meal_nudge`
  push; the eligibility rules are the same for everyone.
- `first_meal_nudge` push: see §5. Needs nothing from the client beyond a registered push token.

