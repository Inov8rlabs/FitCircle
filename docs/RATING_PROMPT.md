# Store rating prompt (server-driven, 1.1.2)

The apps ask the OS for its rating sheet (iOS `AppStore.requestReview(in:)`,
Play In-App Review `requestReviewFlow` → `launchReviewFlow`) only when the
server says the user is eligible **and** the moment's trigger is active. Who is
eligible and when is changed in Admin Tools, without shipping the apps.

No custom "do you like the app?" pre-prompt, no review gating, no incentives
(Play policy forbids gating; Apple discourages it). The OS caps what it shows
(Apple: 3 per 365 days) and never says whether it showed the sheet or whether
the user rated.

## 1. Config

One `feature_flags` row, no migration (same pattern as `pro_lifecycle_prompts`):

| column | meaning |
|---|---|
| `name` | `rating_prompt` |
| `is_enabled` | admin master switch |
| `metadata` | `RatingPromptConfig` (`apps/web/app/lib/rating-prompt/config.ts`) |

Missing row, read error or invalid blob → `DEFAULT_CONFIG` (on, iOS + Android
≥ 1.1.2; triggers `meal_saved`, `streak_reached` [3, 7], `challenge_day_completed`;
2 days since signup; 3 meal days; 120-day cooldown; max 3 prompts per user;
internal accounts excluded; paywall-same-session and 30-minute recent-error
exclusions; 100 % rollout, all countries).

Env kill switch: `RATING_PROMPT_ENABLED=false` (also `0`, `off`, `no`).
Config is cached per instance for ~30 s.

## 2. Rules (`lib/rating-prompt/eligibility.ts`)

In order, first failure wins (`reason`): `kill_switch`, `disabled`,
`unsupported_platform`, `platform_disabled`, `app_version`, `country`,
`rollout` (stable per-user bucket), `internal_account` (`classifyTestUser`:
admins, our domains, reviewer / QA / Test Lab / Play-tester accounts),
`too_soon_after_signup`, `max_prompts`, `cooldown` (from the server ledger),
`no_active_triggers`.

`meal_saved` is only active when the user already has `minMealDays - 1`
distinct food days before today (the save that fires it makes today count).

Server-side vs client-side: the server owns everything it can see. Paywall
in the same session / day and a recent user-visible error are client-enforced
(the server has no session view); their switches are in the config and served
as `exclusions`.

## 3. API

`GET /api/mobile/rating-prompt` (mobile auth; `X-App-Platform`, `X-App-Version`;
no-store). Fetched at most once per app session.

```json
{ "eligible": true, "reason": null,
  "triggers": [{ "key": "challenge_day_completed" }, { "key": "meal_saved" },
               { "key": "streak_reached", "streakLengths": [3, 7] }],
  "cooldownUntil": null, "promptCount": 0, "maxPrompts": 3,
  "exclusions": { "paywallSameSession": true, "paywallSameDay": false, "recentErrorMinutes": 30 },
  "configVersion": "rp1-…" }
```

Any failure answers 200 with `eligible: false, reason: "unavailable"`. Clients
treat any error, a 404 (older server) or a missing field as "do not prompt".
Unknown trigger keys are ignored by clients (room for new moments).

`POST /api/mobile/rating-prompt/requested { "trigger": "meal_saved" }`: the app
asked the OS. Writes `profiles.metadata.rating_prompt`
`{ last_prompt_at, prompt_count, last_trigger, last_platform, last_app_version }`.
A repeat within 60 s is not counted twice.

Shipped clients (iOS ≤ 1.1.2) keep their local rules and never call these
routes; `minAppVersion` keeps them ineligible if they ever did.

## 4. Client local guards (not server-controlled)

Never during onboarding; never while a sheet or paywall is on screen; at most
once per app session; plus the served `exclusions`. Analytics:
`Review Prompt Requested { trigger }` (upper bound on prompts seen).

## 5. Admin Tools (FitCircle → Rating prompt)

| route | |
|---|---|
| `GET /api/admin/rating-prompt` | published config, version, defaults, kill switch, last change |
| `POST /api/admin/rating-prompt/publish` | `{ baseVersion, config, enabled, summary, note? }`; 409 `STALE_DRAFT`; audited in `experiment_audit_log` (`config:rating_prompt`) |
| `GET /api/admin/rating-prompt/changes` | publish history |
| `GET /api/admin/rating-prompt/audience` | users eligible now (each enabled platform at its min version; the country rule is per request), reasons for the rest |
| `GET /api/admin/rating-prompt/requests` | latest prompt request per user |

Changes reach the server in ~30 s and the apps at their next session.
