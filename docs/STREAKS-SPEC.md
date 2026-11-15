# Streaks spec: shields (streak freezes)

Canonical spec for the streak-shield economy. Code: `apps/web/app/lib/streaks/streak-config.ts`
(code defaults, `shieldsEarnedBetween`), `apps/web/app/lib/streaks/shield-rules.ts` (remote-config
resolution), `apps/web/app/lib/services/streak-shield-service.ts` (the only owner of shield inventory).
Older docs (DAILY-STREAK-CHECKIN-SPEC, PRD-STREAK-CLAIMING, STREAK_INTEGRATION_GUIDE, ...) are
historical for shields.

Last change: 2026-11-13 (shield economy v2).

## 1. Rules

| Rule | Default | Remote-config key (Admin Tools → Free limits) | Bounds |
|---|---|---|---|
| Earn: +1 shield each time the streak reaches a multiple of N days | N = 7 | `streak_shield_earn_interval_days` | 3–60 |
| Starter: shields a new user gets when onboarding completes | 2 | `streak_shield_starter_count` | 0–3 |
| Cap: most shields a free user can bank (all types) | 3 | `streak_shield_max_balance` | 1–10 |

- **Exactly one shield per interval.** The extra +1 at 30-day multiples was retired on 2026-11-13.
  Day 30 still fires the "Monthly Master" milestone celebration. It just has no shield bonus.
- **Cap.** Shields earned while the bank is full are dropped (`capped: true` on the award).
  Lowering the cap never removes shields. A user above the new cap simply stops earning until they
  drop below it. The starter count is clamped to the cap.
- **Pro** (`premium` / `enterprise`): unlimited. Protection never decrements a balance.
- **Consumption** (unchanged): freeze, then milestone_shield, then purchased. A shield auto-covers a
  single missed day, with at most 2 consecutive auto-protects (`MAX_CONSECUTIVE_AUTO_PROTECTS`, code only).
- **XP purchase** (unchanged): 100 XP (`STREAK_SHIELD_XP_PRICE`), also capped at the max balance.
- Rules resolve **per user** through `RemoteConfigService` (rules can target platform, app
  version, country, signup date, channel, % rollout, experiment arm). On any error the code defaults apply.

### Earning details

`shieldsEarnedBetween(old, new, interval)` is pure: `floor(new/interval) - floor(old/interval)`.
`awardForStreakGrowth` anchors each boundary to the calendar day the run crossed it and pays a
calendar day **at most once, ever**. The day is the dedupe key, whatever interval paid it, so
`7:<day>` and the legacy `30:<day>` entries in `milestone_shield.metadata.paid_boundaries` both
block re-payment. This keeps break-and-repair merges from re-earning, and an admin changing the
interval cannot make a merged run re-pay old days. Changing the interval is never retroactive.
Only streak growth after the change earns at the new interval.

## 2. Starter shields

- **When:** onboarding completion, on the server:
  - `POST /api/mobile/onboarding/complete` → `AssessmentService.completeOnboarding` (iOS / Android).
  - `POST /api/onboarding/complete` → `OnboardingService.completeOnboarding` (legacy).
  - Both call `grantStarterShields` → `StreakShieldService.grantOnboardingStarter`.
- **Idempotent:** the grant is recorded once on the freeze row,
  `streak_shields.metadata.starter_grant = { reason, count, target, granted_at, grant_id }`.
  Retries, replays and concurrent calls never grant twice. The write is an optimistic-concurrency
  UPDATE guarded on `available_count`, and a lost race re-reads.
- **Top-up, not add:** if the user already has an inventory with no recorded grant (for example,
  created before this rule shipped), completion tops the balance **up to** the starter count once.
  It never adds the starter count on top and never lowers a balance. The grant is recorded even when
  it adds 0.
- **Lazy fallback:** an inventory first created any other way (`getInventory` on first touch, e.g.
  the home screen loading mid-onboarding, or the web wizard, which writes `profiles` directly from
  the browser and never calls a completion endpoint) is seeded at the same starter count and
  recorded as `reason: 'lazy_first_touch'`. Completion then sees the recorded grant and adds
  nothing, so nobody gets less and nobody gets double.
- **Retry window:** the endpoints only grant for a completion happening now. They also grant when
  `onboarding_completed_at` is within 24 h, so a retried call after a failed grant still settles it.
  A grant failure never fails onboarding completion.
- **Existing users: no retroactive grants.** Users who completed onboarding before 2026-11-13 keep
  their balance. Calling a completion endpoint again (more than 24 h later) grants nothing, and
  changing `streak_shield_starter_count` never tops anyone up.
- **Ledger:** there is no shield ledger table. The record is `metadata.starter_grant`
  (`reason: 'onboarding_starter' | 'lazy_first_touch'`) plus a server log line
  `[shields] onboarding_starter: +N`.
- **Analytics:** every grant that banks > 0 shields sends the server-side Amplitude event
  `Streak Shield Granted` (tracking plan v35, platform `server`) with `reason`
  (`onboarding_starter` | `lazy_first_touch` | `streak_earned` | `purchased`) and `count`
  (shields actually banked after the cap). Starter grants carry `insert_id`
  `shield-grant:starter:<grant_id>`, so a replay can't double-count. Starter grants are deliberately **not** written to
  `engagement_activities`: any row there counts as "checked in" for circle daily summaries.
  Earned shields keep writing `freeze_earned` from the daily check-in as before.

## 3. API: `shield_rules` (additive; old clients ignore it)

```json
"shield_rules": { "earn_interval_days": 7, "starter_count": 2, "max_balance": 3 }
```

| Endpoint | Field |
|---|---|
| `GET /api/mobile/streaks/engagement` (+ `apply-freeze`, `engagement/pause`, `engagement/resume`, which return the same object) | `shield_rules` |
| `GET /api/streaks/shields` | `shield_rules`; `cap` = `shield_rules.max_balance` |
| `GET /api/streaks/current` | `shield_rules` |
| `GET /api/streaks/engagement` (web, cookie auth) | `shield_rules`, plus live `streak_freezes_available` / `shields_unlimited` |
| `GET /api/mobile/streaks/status` (camelCase payload) | `shieldRules: { earnIntervalDays, starterCount, maxBalance }` |

Clients must render every rule sentence and cap from these fields, never from constants. For
example: "Earn a shield every {earn_interval_days} days of streak · bank up to {max_balance}".
Shared web helpers live in `lib/streaks/shield-copy.ts`. Signed-out or rule-less surfaces
(the /upgrade plan comparison) use its `DEFAULT_SHIELD_RULES_DTO`, which is the code defaults. A local constant may only be a
fallback for a response that predates the field.

`engagement_streaks.streak_freezes_available` stays a read-only legacy mirror of the total,
clamped to the user's max balance.

## 4. Copy rules

- Never say "1 per week, plus a bonus each month", "every 7 days" or "up to 3" literally. Use the rules.
- Push `shield_earned` / `shield_applied` / streak-lost copy does not state rule numbers.
- The "2 days in a row" consecutive-protect limit is a separate code constant and is not part of `shield_rules`.
