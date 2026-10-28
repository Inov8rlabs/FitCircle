# User targets, birth date and Pro badge: client contract (1.1.0)

Status: implemented on the backend 2026-10-28 (branch `feat/onboarding-v2-experiment`). Migration
`115_paywall_last_opened.sql` is written but not applied yet. Everything works before 115 is
applied (see §4.4). iOS and Android wire 1.1.0 against this document.

What it fixes (Android report, 2026-10-28):

1. Calorie and protein targets were stored only on the device, so plate score and the food-log
   budget used the server default (2 000 kcal).
2. The age from onboarding was used for the plan only and never saved.
3. The Home crown marker could only re-arm on a client schedule.
4. The "member since" date in Pro status came from RevenueCat only.

All endpoints use the standard mobile envelope `{ success, data, error, meta }`, Bearer auth and
`Cache-Control: no-store`. Errors: `401 UNAUTHORIZED`, `400 VALIDATION_ERROR` (with
`data.issues = [{ path, message }]`) and `500 INTERNAL_SERVER_ERROR`.

---

## 1. Where targets are stored

No new table or column. Each target uses the store that already exists:

| Target | Stored in | Also written by | Default when unset |
|---|---|---|---|
| calories | `profiles.preferences.nutrition.daily_calorie_target` | (new) | 2 000 kcal |
| proteinG | `profiles.preferences.nutrition.daily_protein_g_target` | (new) | none (`null`) |
| carbsG | `profiles.preferences.nutrition.daily_carbs_g_target` | (new) | none (`null`) |
| fatG | `profiles.preferences.nutrition.daily_fat_g_target` | (new) | none (`null`) |
| waterMl | `profiles.preferences.hydration.daily_water_ml_target` | `PUT /api/mobile/vitals/goals` | 2 000 ml |
| steps | `profiles.goals[type="steps"].daily_steps_target` | `PUT /api/mobile/profile/goals` | 10 000 |

Why these stores:
- `daily_goals` rows are not a fit. `goal_type` is a closed enum (`steps|weight_log|workout|mood|energy|custom`)
  that `GET /api/mobile/daily-goals` returns to shipped apps, which decode it as a closed enum. The
  rows are also tied to challenges and have start and end dates.
- `goals[]` already holds steps in the shape every client decodes. iOS decodes `goals[].type` as a
  closed enum, so calories cannot be added there as a new type. That is the same reason water lives
  in `preferences.hydration`.
- `preferences` is passed through unchanged to every client (`withPreferenceDefaults`), so a new
  `nutrition` key is ignored by shipped builds.

The three stores share one value each. If a user sets water in Vitals or steps in Profile → Goals,
`GET /api/mobile/targets` shows that value, and the reverse is also true.

## 2. Endpoints

### `GET /api/mobile/targets`

```jsonc
{
  "success": true,
  "data": {
    "calories": 1850,          // the user's value, else 2000
    "proteinG": 128,           // the user's value, else null
    "carbsG": null,            // the user's value, else null
    "fatG": null,              // the user's value, else null
    "waterMl": 2700,           // the user's value, else 2000
    "steps": 8000,             // the user's value, else 10000
    "sources": {               // per field: "user" | "default" | "none" (no value and no default)
      "calories": "user", "proteinG": "user", "carbsG": "none",
      "fatG": "none", "waterMl": "user", "steps": "user"
    },
    "origin": "onboarding_plan",               // origin of the last nutrition save, or null
    "updatedAt": "2026-10-28T12:00:00.000Z"    // last nutrition save, or null
  },
  "error": null,
  "meta": { "requestTime": 12 }
}
```

`calories`, `waterMl` and `steps` are never null. `proteinG`, `carbsG` and `fatG` are null until the
user saves them. The server has no default for them, and clients must not invent one.

### `PUT /api/mobile/targets` (`PATCH` behaves the same)

The update is partial. An omitted key keeps its value, and `null` clears it, which brings back
the default or `null`. Send at least one target. Unknown keys are ignored.

```jsonc
// request
{ "calories": 1850, "proteinG": 128, "waterMl": 2700, "steps": 8000, "origin": "onboarding_plan" }
// response: the same `data` as GET, after the save
```

Validation: numbers are rounded to whole numbers, then range-checked. Strings are rejected.

| Field | Min | Max |
|---|---|---|
| calories | 1 000 | 8 000 |
| proteinG | 20 | 500 |
| carbsG | 20 | 900 |
| fatG | 10 | 400 |
| waterMl | 250 | 10 000 |
| steps | 500 | 100 000 |
| origin | `onboarding_plan` \| `settings` \| `fitzy_plan` \| `other` (optional) | |

The ranges cover every value `POST /api/mobile/onboarding/plan` can return (a test checks this),
so an accepted plan never gets a 400.

```jsonc
// 400 example
{ "success": false,
  "data": { "issues": [ { "path": "calories", "message": "Number must be greater than or equal to 1000" } ] },
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body", "details": {}, "timestamp": "…" },
  "meta": null }
```

### Server features that now use the saved targets

| Feature | Before | Now |
|---|---|---|
| Plate score goal-fit (`GET /api/mobile/plate-score`, `/range`), including `calorieTarget` and `breakdown.basis.calorieTarget` | active calorie challenge → 2 000 (2 500 for athletes) | active calorie challenge → **the user's calorie target** → 2 000 / 2 500 |
| Web food-log calorie budget card (reads the plate score `calorieTarget`) | the default | the user's target |
| Vitals water card, `data.hydration` on water logs, home feed `waterLoggedToday` | `preferences.hydration` | unchanged (same store) |

`breakdown.basis.targetSource` is a new optional field with the values `"challenge" | "user" | "default"`.
With a user target, plate score adds the note "You're right in line with your daily target."

These features were checked and deliberately not changed:
- **Fitzy and the nutrition coach.** Their prompts and output filters forbid calorie targets
  (healthy-engagement guardrail, PRD §6.7/§6.9), so the grounding stays descriptive. The protein
  push nudge compares against the user's own usual intake, not a target.
- **Circle nutrition leaderboard (`calorieGoalHitRatePct`).** By design (§6.7) it counts days with
  calories logged and never compares intake with a target. Using per-member targets would also
  show each member's target to the circle.
- **Nutrition challenges.** They use the challenge's own `goal_amount`.
- **Home feed.** No current card uses a calorie or protein target. The planned `fitzy_hint` card
  ("calories left") should read `UserTargetsService`.

The apps should show the server values. Plate score, the budget and the rings all use the same
numbers.

## 3. Onboarding v3: saving the plan and the birth year

### 3.1 Accepted plan targets
After the user taps **Looks good** (or finishes **Adjust**) on the Plan step, call:

```jsonc
PUT /api/mobile/targets
{ "calories": <plan.calories>, "proteinG": <plan.proteinG>, "waterMl": <plan.waterMl>,
  "steps": <plan.steps>, "origin": "onboarding_plan" }
```

- Send the values the user accepted, after any changes made with the ± steppers.
- The call is idempotent, so retry it from the offline queue until it returns 2xx. A 4xx means
  the input was invalid, so drop the request and log it.
- Stop treating device-only storage as the source of truth. Cache the `data` from the response and
  refresh it from `GET /api/mobile/targets` when the app comes to the foreground and after sign-in.
  Keying the cache by user prevents leaks between accounts.
- Later edits in Settings use the same endpoint with `"origin": "settings"`.

### 3.2 Birth year / date of birth
The About-you step sends **either** field (if both are sent, `dateOfBirth` wins):

| Field | Type | Rule |
|---|---|---|
| `birthYear` | int | the age this calendar year must be 13–100 |
| `dateOfBirth` | `"YYYY-MM-DD"` | a real date; the age today must be 13–100 |

It is accepted, optional and additive on all three onboarding save points:

- `PATCH /api/mobile/onboarding/progress` `{ flow, step, data?, birthYear?, dateOfBirth? }`. Invalid
  values return 400 and nothing is saved.
- `POST /api/mobile/onboarding/plan` `{ goal, …, birthYear?, dateOfBirth? }`. When `age` is absent,
  this value is used as the age, so the `age_30` assumption disappears. Invalid values return 400.
- `POST /api/mobile/onboarding/complete` `{ birthYear?, dateOfBirth? }`. The body is optional.
  Invalid values are **ignored**, because completing onboarding must never fail.

Recommendation: send it on the About-you `PATCH /progress` and again on `POST /plan`. Both calls
are idempotent.

Storage rules (`profiles.date_of_birth`, a DATE):
- A year is stored as `YYYY-07-01`, which puts the age within six months, and is marked as an
  estimate in `profiles.preferences.date_of_birth_estimate = { "from": "birth_year", "date": "YYYY-07-01" }`.
- **A year never overwrites a full date.** A full date entered anywhere (Profile edit, an earlier
  `dateOfBirth`) is kept. A year replaces only an earlier year estimate.
- A full date always replaces the stored value and clears the estimate marker.
- The value is never echoed in the onboarding responses and never logged. The profile payload
  (`date_of_birth`) shows it as before.

Response shapes for all three endpoints are unchanged.

## 4. Entitlements: `proBadge` and `memberSince`

`GET /api/mobile/entitlements` and `POST /api/mobile/subscriptions/sync` return the same `data`,
with two new top-level fields:

```jsonc
{
  "tier": "free",
  "features": { … }, "limits": { … }, "subscription": { … },
  "subscriptionsEnabled": true, "gate": "none", "locked": false,
  "proBadge": { "marker": true, "offerId": "campaign:black-friday-2026" },   // new
  "memberSince": null                                                         // new
}
```

### 4.1 `proBadge`
- `offerId` is the active Pro offer, or `null` when there is none. While an offer is active, it is
  reported to every user, including subscribers.
- `marker` is `true` only when **all** of the following hold:
  - an offer is active;
  - the user has no Pro access: no subscription, no trial and no promotional grant;
  - `subscriptionsEnabled` is true;
  - the user has not opened the paywall since the offer started.

How the offer is chosen (first match wins):
1. **Admin Tools campaign.** This needs no deploy. A campaign that is published, not archived and
   **live** on the viewer's local day, and whose CTA action is **Paywall** (`cta.action = "paywall"`).
   `offerId = "campaign:<slug>"`, and the offer starts at local midnight of its start date. If
   several match, the one with the latest start date wins, then the highest priority. The day uses
   the `x-client-timezone` header, falling back to UTC. Admin Tools changes appear within about
   30 s (per-instance cache).
2. **Env fallback.** `PRO_BADGE_OFFER_ID`, plus an optional `PRO_BADGE_OFFER_STARTS_AT` (ISO 8601).
   Without a start time, only users who have never opened the paywall get the marker. When this is
   unset, no offer comes from env.

With no offer, the result is `{ marker: false, offerId: null }`, and **the client keeps its own
schedule**: the marker shows until the paywall is first opened, then re-arms weekly for the first
month.

### 4.2 Client rules
- Show the dot when either of these is true:
  - `proBadge.marker == true` **and** `proBadge.offerId` is not the `offerId` stored on the device
    as "cleared";
  - the client's own schedule says so while `offerId == null`.
- Never show it for subscribers or users on a trial. The server already returns `marker: false` for
  them, and the client should check this as well.
- **When the paywall opens from any entry point** (crown tap, feed card, automatic):
  - clear the dot locally and store the current `offerId` as cleared;
  - report the open with `POST /api/mobile/me/journey/events { "event": "paywall_shown", "placement": "<placement>", "automatic": <bool> }`.
    For a crown tap, send `"placement": "pro_badge", "automatic": false`. Taps do not start the 72 h
    automatic-paywall spacing.
- The server records every `paywall_shown`, automatic or tap, in `profiles.paywall_last_opened_at`
  (migration 115). This clears the marker on the user's other devices as well.
- A new `offerId` re-arms the dot even if the previous offer was cleared.

### 4.3 `memberSince`
This is an ISO 8601 timestamp (UTC) of the earliest paid or trial start on record, or `null`.

It is the earlier of these two:
- the first real RevenueCat purchase event (`INITIAL_PURCHASE`, `NON_RENEWING_PURCHASE`,
  `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION`), using the event's `purchased_at_ms`.
  TEST and PROMOTIONAL-store events never count. SANDBOX events count only where sandbox purchases
  are applied, which excludes production unless `ALLOW_SANDBOX_WEBHOOKS=true`.
- `profiles.trial_started_at`.

It is `null` for users who never paid or trialed, including users with promotional grants only. Pro
status shows "Member since {date}" from this value. When it is null, fall back to RevenueCat's
`originalPurchaseDate` or hide the line.

### 4.4 Before migration 115 is applied
- `marker` ignores the server-side paywall-open record and treats the user as never having opened
  the paywall, so the local "cleared" `offerId` (§4.2) is what hides the dot.
- `paywall_shown` still returns 200 with the same body. The write logs a warning and does nothing.
- Without migration 112, `trial_started_at` cannot be read, so `memberSince` uses only the
  purchase events.

## 5. Ops

- **Arming a marker for an offer:** in Admin Tools → Campaigns, create a campaign (any template)
  with the CTA set to **Paywall**, set its dates and publish it. To end it, unpublish it or let
  it end.
- **Migration 115:** run `npx -y supabase@latest db query --linked -f supabase/migrations/115_paywall_last_opened.sql`,
  then insert `'115'` into `supabase_migrations.schema_migrations`. Apply it **alone**, and never
  `db push --include-all` (104 is unapplied).

## 6. Compatibility with shipped clients (≤ 1.0.9)

All changes are additive. Nothing was removed or renamed, and no field became nullable that was
not nullable before. This is checked by `apps/web/app/api/mobile/targets/__tests__/shipped-client-compat.test.ts`:

- The profile payload (`toMobileUser`) for a user whose targets were saved by 1.1.0 still decodes
  as the iOS `User`. The steps target is an existing `goals[type="steps"]` element, and
  `preferences.nutrition` is an extra key that is passed through.
- `GET /vitals/summary` keeps the same keys, and a shipped app sees the saved water target.
- The plate score DTO keeps the same keys. `breakdown.basis` only gains the optional
  `targetSource`, and `calorieTarget` is still a number.
- Entitlements still decode on shipped iOS and Android with migrations 112 and 115 applied or not.
  `proBadge` and `memberSince` are new top-level keys, which Codable and kotlinx
  (`ignoreUnknownKeys`) ignore.
- `paywall_shown` returns the same body with or without migration 115.
- The onboarding `progress`, `plan` and `complete` responses are unchanged for shipped bodies.
  Shipped builds never send `birthYear` or `dateOfBirth`.

Also covered:
- `app/lib/targets/__tests__/user-targets.test.ts`
- `app/lib/onboarding/__tests__/birth-date.test.ts`
- `app/lib/entitlements/__tests__/pro-badge.test.ts`
- `app/api/mobile/targets/__tests__/route.test.ts`
- `app/api/mobile/onboarding/__tests__/birth-date.test.ts`
- `app/api/mobile/me/journey/__tests__/journey.test.ts`
