# Profile completion card (home feed) — v1

Status: approved direction 2026-11-03 (product owner). Backend contract final 2026-11-02 (`feat/profile-completion-card`). Branch `feat/profile-completion-card` in BE / iOS / Android.

## Why
Onboarding v3 now lets people skip everything on "About you" (and other questions) so they finish setup. Most do skip
(16 of 27 users skipped About you). Their plan is then built on a standard reference body. We need a gentle, delightful
way to collect the missing details later, right on Home — not buried in Profile.

Owner's words: "a card on home feed which tells them their profile completion status and is a swipeable carousel with
questions to answer for each of the remaining questions from onboarding. The card can be midway on the screen. Design it
well, make it easy for users to enter details, and make it look beautiful, polished and delightful."

## Questions (v1 catalog — order = carousel order)
Only data the server can store and the onboarding v3 flow asks. Keys are stable wire ids.

| key | question (copy can be tuned) | input | stored where (final, BE 2026-11-02) |
|---|---|---|---|
| `goal` | What's your main goal? | single-select chips (same options as onboarding goal step) | `profiles.preferences.about_you.goal` (new preferences key, written by this endpoint). Read fallback: onboarding v3 resume blob `onboarding_progress.data.v3.goal` (iOS) / `onboarding_progress.data.goal` (Android) — onboarding v3 never wrote the goal anywhere else |
| `height` | How tall are you? | wheel/stepper, ft+in or cm (follows the user's unit setting) | `profiles.height_cm` (INTEGER, rounded) |
| `weight` | What do you weigh today? | stepper/keypad, lb or kg; counts as today's weigh-in | today's `daily_tracking` row (`weight_kg`, user's local day) via `MobileAPIService.upsertDailyTracking` — the same call as `POST /api/mobile/tracking/daily` (weight streak + daily-goal completion) — plus `profiles.weight_kg`. Answered = any `daily_tracking.weight_kg > 0`, else `profiles.weight_kg > 0` |
| `goal_weight` | What's your goal weight? | stepper, lb/kg; inline healthy-range hint; never blocks | `profiles.goals[type="weight"].target_weight_kg` via `VitalsService.updateGoals` (= `PUT /api/mobile/vitals/goals`); `starting_weight_kg` set to the current weight when the goal has none |
| `birth_year` | What year were you born? | year wheel (sensible range) | `profiles.date_of_birth` = `YYYY-07-01` + `preferences.date_of_birth_estimate` (USER_TARGETS_CONTRACT §3.2 rules: a year never overwrites a full date). Answered = `date_of_birth` not null |
| `sex` | Which should we use for your plan? | chips: Female / Male / Rather not say | `profiles.gender` (`female` \| `male` \| `prefer_not_to_say`; `non_binary` also accepted/counted). "Rather not say" = answered |
| `activity` | How active are you day to day? | single-select cards (same options as onboarding activity step) | `profiles.preferences.about_you.activity`. Read fallback: `onboarding_progress.data.v3.activity` (iOS) / `.data.activity` (Android) |

A question is "remaining" when its value is missing (null/empty). "Rather not say" counts as answered.
Completion % = round(answered / total × 100) over the questions applicable to this user.

**Applicability (final):** every key always applies except `goal_weight`, which applies only when the goal is a weight
goal (`lose_weight`, `build_muscle`) **or the goal is still unknown**. Rationale: onboarding's plan only uses the goal
weight for weight goals; keeping it while the goal is unknown means answering the goal can only *remove* a carousel page
(never insert one mid-swipe), and the ring never goes backwards. A goal weight saved earlier doesn't count once the goal
is `eat_healthier` / `stay_active` (total drops to 6).

## Home feed contract (extends docs/HOME_FEED_SPEC.md; additive, not breaking)
New card type `profile_completion@1`. Returned only to clients that declare `profile_completion@1` in `cards=`.

```json
{ "id": "profile_completion", "type": "profile_completion", "version": 1, "dismissible": true,
  "props": {
    "percent": 43,
    "answered": 3, "total": 7,
    "remaining": ["weight", "goal_weight", "birth_year", "sex"],
    "units": "imperial",
    "hints": { "goal_weight": { "healthy_min_kg": 53.5, "healthy_max_kg": 72.0 } },
    "goal": "lose_weight"
  } }
```
- `dismissible: true` is always sent on this card (the first card to send it; other v1 cards still omit it).
- `remaining`: applicable unanswered keys, in carousel order (`goal, height, weight, goal_weight, birth_year, sex,
  activity`). Clients render the keys they know, skip unknown ones, collapse if none left. Never empty when sent.
- `units`: `"metric" | "imperial"` — the vitals summary rule (`preferences.display.units` or `preferences.unitSystem`
  = `imperial` → imperial, else metric).
- `hints`: always an object (may be `{}`). `hints.goal_weight` is present only when `goal_weight` is in `remaining` and
  the height is known: the BMI 18.5–24.9 range for that height (`lib/utils/bmi.ts healthyWeightRangeKg`, the vitals BMI
  card's `healthy_range_kg`), kg, 1 decimal. Informational only — never block a value outside it.
- `goal`: `"lose_weight" | "eat_healthier" | "build_muscle" | "stay_active" | null` — the user's known goal, resolved
  exactly as for applicability (`preferences.about_you.goal`, then the onboarding blob `data.v3.goal` / `data.goal`);
  `null` when unknown. Always present (added 2026-11-03, additive). Clients use it to pre-fill goal-dependent pages
  (e.g. the goal-weight default below vs above today's weight) when the goal was answered in onboarding, not on the
  card; when `null` they keep their own fallback (the goal answered on the card this session, else their default).
- Placement: right after `vitals` (score just below vitals; with a campaign: `progress, hydration, referral, vitals,
  profile_completion`), never in the first 3 positions (new guardrail **G10**, counted without `offline_banner`; in a
  feed too short for that it is dropped). Rules can still move/boost/hide it (`profile_completion` as the card ref).
- Eligibility (server): `profiles.onboarding_completed = true` AND ≥ 1 remaining AND not snoozed. Snooze = a `dismiss`
  event for `card_type: "profile_completion"` in `home_feed_events` within the last 7 days — i.e. the client's normal
  `POST /api/mobile/home-feed/events` dismiss is all that's needed; no extra call. Hidden for good at 100 %. If the
  server can't read the stores (timeout/outage), the card is omitted (fail closed — it needs its props). Kill switch
  (`HOME_FEED_ENABLED=false`) → omitted.
- Shipped clients (1.0.8–1.1.x) don't declare it → their responses are byte-for-byte unchanged and the extra reads never
  run (contract-tested).

## Saving answers — `POST /api/mobile/profile/completion` (new, one endpoint)

Bearer auth, standard mobile envelope `{ success, data, error, meta }`, `Cache-Control: no-store`. Send
`x-client-timezone` (used for "today" of the weigh-in; falls back to `profiles.timezone`, then UTC).

Request (one answer per call; **metric only** — convert lb → kg (`÷ 2.20462` / `× 0.45359237`) and ft+in → cm before
sending; unknown extra fields ignored):
```jsonc
{ "key": "height", "value": 175.26, "source": "home_card" }   // source optional: "home_card" | "profile"
```

| key | value (JSON type, exact allowed values) |
|---|---|
| `goal` | string: `lose_weight` \| `eat_healthier` \| `build_muscle` \| `stay_active` (onboarding v3 `V3Goal` ids) |
| `height` | number, cm, 100–250 (stored rounded to whole cm) |
| `weight` | number, kg, 30–300 |
| `goal_weight` | number, kg, 30–300 |
| `birth_year` | integer; age this calendar year 13–100 (onboarding rule) |
| `sex` | string: `female` \| `male` \| `prefer_not_to_say` (`non_binary` also accepted) |
| `activity` | string: `sedentary` \| `light` \| `active` \| `very_active` (onboarding v3 `V3Activity` ids) |

Response 200:
```jsonc
{ "success": true, "error": null, "meta": { "requestTime": 41 },
  "data": {
    "percent": 57, "answered": 4, "total": 7,
    "remaining": ["goal_weight", "birth_year", "sex"],
    "units": "imperial",
    "hints": { "goal_weight": { "healthy_min_kg": 55.4, "healthy_max_kg": 74.5 } },
    "goal": "lose_weight",
    "key": "weight",                       // the key just saved
    "targets_updated": ["calories", "waterMl"]   // see Plan refresh; [] when nothing changed
  } }
```
`data` minus `key`/`targets_updated` is exactly the card `props` shape → the client replaces its card state with it
(no feed refetch). Errors: `401 UNAUTHORIZED`; `400 VALIDATION_ERROR` with `data.issues = [{ path, message }]` (unknown
key, wrong type, out of range — e.g. path `value`); `500 INTERNAL_SERVER_ERROR`. Idempotent: resending the same answer
is safe (offline queue retries OK; a 4xx means drop it).

`GET /api/mobile/profile/completion` → `data` = the status (`percent, answered, total, remaining, units, hints, goal`), for a
Profile-screen entry point (`source: "profile"`) or to refresh the card outside the feed.

Existing endpoints still work for the same data (`PUT /api/mobile/profile` height/gender, `POST /tracking/daily`,
`PUT /vitals/goals`), but the card should use the single endpoint: it is the only writer of `goal`/`activity` and the
only one that refreshes the plan.

### Plan refresh (server)
Targets are not derived server-side — they are stored values (`PUT /api/mobile/targets`, USER_TARGETS_CONTRACT). After
each answer the server recomputes the onboarding plan (`lib/onboarding/plan.ts computePlan`, same inputs onboarding v3
sends: goal (default `stay_active`), height, weight, goal weight for `lose_weight` only, sex, age (birth-year estimate →
this year − year), activity) **before** and **after** the answer, and replaces a saved target (`calories`, `proteinG`,
`waterMl`, `steps`) only when ALL hold: the last nutrition save has `origin: "onboarding_plan"`, the saved value still
equals the before-plan (the user never adjusted it), and the after-plan differs. Anything the user set (Adjust steppers,
Settings, Fitzy plan, vitals water) is never overwritten. Typical case: skipped About you → reference-body plan →
answering height + weight turns it personal. `targets_updated` lists the changed fields → **clients refetch
`GET /api/mobile/targets`** (and their cached plan / Fitzy card numbers) when it is non-empty.

### Analytics
- Card: existing `Home Feed Card Viewed / Tapped / Dismissed` (`card_type: "profile_completion"`, `card_id:
  "profile_completion"`).
- Per answer: new **`Profile Question Answered`** `{ question_key, source }` — tracking plan **v24**;
  `question_key` enum `profile_question_key` = `goal | height | weight | goal_weight | birth_year | sex | activity`,
  `source` enum `profile_question_source` = `home_card | profile`. Send after a 200 only; never the value. Generated
  constructors: iOS `AnalyticsEvents.profileQuestionAnswered(questionKey:source:)`, Android
  `AnalyticsEvents.profileQuestionAnswered(questionKey, source)`, web `AnalyticsEvents.profileQuestionAnswered(...)`.

### Storage / migrations
No migration, no new table, no stored procedure/trigger. New JSON key `profiles.preferences.about_you = { goal?,
activity?, updated_at }` (preferences pass through `withPreferenceDefaults`; shipped clients ignore unknown keys).
Snooze reads `home_feed_events` (index `user_id, created_at desc`, migration 106).

## Design brief (applies to both apps — make it delightful)
- Header row: a progress ring (the app's circular-progress language) with the % inside, title "Complete your profile",
  subtitle "Sharper plan in under a minute" (or similar), dismiss (X) top-right.
- Below: a horizontally swipeable carousel, one question per page, with page dots and a peek of the next page so it's
  obviously swipeable. Each page: the question, the fastest possible input for that question (chips/wheels/steppers —
  NO free-text keyboards where avoidable), a primary "Save" that auto-advances to the next question, and a quiet "Skip"
  that just advances.
- Pre-fill smart defaults (e.g. height/weight pickers start at a sensible value, units from the user's setting) so most
  answers are 1–2 taps.
- Delight: the ring animates up on each save, a light haptic, a subtle check/confetti micro-moment at 100%, smooth
  page transitions; respects Reduce Motion.
- Polished: aligned to the feed's card grid/padding, same corner radius/tokens as other Home cards, dark-mode correct,
  Dynamic Type / font scale safe (pages grow, nothing clips), 44pt/48dp targets, full VoiceOver/TalkBack labels
  ("Question 2 of 4, How tall are you?"), no emoji icons (SF Symbols / Material Symbols Rounded).
- Errors: save failure keeps the answer on the page with an inline "Couldn't save — try again"; offline → queued like
  other writes if the app has an outbox for that data, otherwise inline retry.
