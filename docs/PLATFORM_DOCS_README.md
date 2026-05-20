# FitCircle Platform Docs

Last updated: 2026-05-19

This directory contains per-platform reference docs you'll consult when
adding features. Each platform doc covers the same shape: feature catalog,
patterns, conventions, design tokens, build commands, and a "how to add a
new feature" recipe.

## Index

| Doc | Use when |
|-----|----------|
| [`PLATFORM_DOCS_iOS.md`](./PLATFORM_DOCS_iOS.md) | Building or modifying anything in `FitCircle-iOS/` |
| [`PLATFORM_DOCS_Android.md`](./PLATFORM_DOCS_Android.md) | Building or modifying anything in `Fitcircle-Android/` |
| [`PLATFORM_DOCS_Web.md`](./PLATFORM_DOCS_Web.md) | Building or modifying anything in `FitCircleBE/apps/web/` |
| This file | Looking for cross-platform contracts (API, models, secrets) |

Companion reports (point-in-time snapshots, not living docs):

- [`IOS_FEATURE_INVENTORY_2026-05-19.md`](./IOS_FEATURE_INVENTORY_2026-05-19.md) — iOS feature inventory at parity-completion time
- [`PARITY_GAP_CONSOLIDATED_2026-05-19.md`](./PARITY_GAP_CONSOLIDATED_2026-05-19.md) — the gap analysis that drove the parity sprint
- [`ANDROID_PARITY_COMPLETE_2026-05-19.md`](./ANDROID_PARITY_COMPLETE_2026-05-19.md) — what landed during the Android parity work
- [`WEB_PARITY_COMPLETE_2026-05-19.md`](./WEB_PARITY_COMPLETE_2026-05-19.md) — what landed during the Web parity work

---

## Repository layout

```
FitCircle/
├── FitCircle-iOS/              # iOS app (Swift, SwiftUI, TCA)
├── Fitcircle-Android/          # Android app (Kotlin, Jetpack Compose, Hilt)
├── FitCircleBE/                # Web app + backend (Next.js 15, Supabase)
│   └── apps/web/               # The single deployable web bundle
└── docs/                       # ← you are here
```

Each platform is independent. The single shared dependency is the backend
exposed by `FitCircleBE/apps/web` — both mobile apps and the web frontend
call into the same Next.js API routes.

---

## The shared backend

Backend = Next.js API routes in `apps/web/app/api/` calling service classes
in `apps/web/app/lib/services/` that talk to Supabase. There is no separate
backend deployment — the web app and the API live together.

### Two route surfaces

| Route prefix | Auth | Consumer | Example |
|--------------|------|----------|---------|
| `/api/mobile/…` | Bearer JWT in `Authorization` header (via `requireMobileAuth`) | iOS, Android, web pages that use the auth-store token | `POST /api/mobile/streaks/claim` |
| `/api/…` (no `/mobile` prefix) | Supabase session cookie (via `createServerSupabase`) | Web pages using Server Components or `fetch(..., { credentials: 'include' })` | `GET /api/streaks/engagement` |

When you add a new endpoint:

1. **First write the service** in `apps/web/app/lib/services/<feature>-service.ts` as a static class.
2. **Then expose two routes** that both call the service:
   - `/api/mobile/<feature>/...` for mobile + cross-platform clients
   - `/api/<feature>/...` for web cookie-auth callers (only if needed)

Most parity-era features only have the mobile route, and the web frontend
calls it with a Bearer token from its Zustand auth-store (see
`PLATFORM_DOCS_Web.md` § "Calling mobile API routes from the web").

### Response envelope

Mobile routes return a consistent shape:

```jsonc
// Success
{
  "success": true,
  "data": { /* … */ },
  "error": null,
  "meta": { "request_time": "…" }
}

// Error
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "…",
    "details": { /* zod errors etc */ },
    "timestamp": "…"
  },
  "meta": null
}
```

Status codes: 200 (success), 400 (validation), 401 (unauthenticated),
404 (missing), 500 (server). The clients on each platform unwrap this — see
the platform docs for their specific helpers.

---

## Cross-platform data models

These types appear identically on all three platforms (with naming
adapted to local conventions). When adding a new model, define it once in
the backend service and mirror the shape on each client.

### Engagement & streaks

- `EngagementStreak` — `current_streak`, `longest_streak`, `freezes_available`, `paused`, `pause_end_date`, `last_engagement_date`
- `ClaimableDay` — `date`, `is_claimed`, `is_claimable`, `day_of_week`, `health_data_synced`, `step_count`, `is_frozen`
- `ShieldStatus` — `available`, `used`, `max`, `next_free_at`, `can_activate`
- `ClaimResult` — `success`, `streak_count` (≡ `currentStreak`), `message`, `milestone`
- `ClaimMilestone` — `days`, `title`, `badge`, `message`
- Milestones at: **7 / 30 / 60 / 100 / 365** days (define once in
  `share-card-service` + each client; if you change one, change all)

### Momentum (separate from engagement streaks)

- `MomentumStatus` — `current_momentum`, `best_momentum`, `flame_level` (1–5), `flame_label`, `grace_day_available`, `next_milestone`
- Flame levels:
  - 1 = Spark (0–6 days)
  - 2 = Flame (7–13)
  - 3 = Blaze (14–29)
  - 4 = Inferno (30–99)
  - 5 = Eternal (100+)

### Daily challenges

- `DailyChallenge` — `id`, `challenge_date`, `name`, `description`, `goal_amount`, `unit`, `participant_count`, `completion_count`, `difficulty`
- `DailyChallengeWithProgress` — extends with `user_progress`, `user_completed`, `user_joined`
- Quick-add amounts:
  - `steps` → 1000, 2500, 5000
  - `reps` → 10, 25, half-the-goal
  - `km`/`miles` → 1, 2.5, 5
  - other → 25 % / 50 % / 75 % of goal

### Share cards

- `ShareCardType` — `milestone` | `challenge_complete` | `perfect_week` | `momentum_flame` | `circle_boost`
- Per-type `card_data` shapes are defined in
  `apps/web/app/lib/services/share-card-service.ts` — keep that file as the
  authoritative shape.

### Assessment (onboarding)

- 5 questions: `exercise_frequency`, `primary_goal`, `preferred_workouts`
  (multi), `daily_time`, `fitness_self_assessment`
- See `apps/web/app/api/mobile/onboarding/assessment/route.ts` for the
  authoritative zod schema — clients should accept the same enums.

---

## Auth flow (summary)

1. **Sign up / log in** on a platform → Supabase Auth issues a JWT access
   token + refresh token.
2. The access token is stored:
   - iOS: KeychainManager (encrypted)
   - Android: TokenManager + EncryptedSharedPreferences
   - Web: Zustand `auth-store` (persisted to `localStorage`) **and** a
     Supabase httpOnly session cookie
3. The token is included in every backend call as
   `Authorization: Bearer <token>` for mobile routes, or as a cookie for
   web cookie-auth routes.
4. **Token refresh** happens silently:
   - Backend mobile routes refresh on response headers (`X-New-Access-Token`)
   - iOS: `RefreshCoordinator` + `TokenRefreshManager`
   - Android: `TokenRefreshManager` + retrofit interceptor
   - Web: Supabase auto-refresh in the middleware
5. On 401, the client re-attempts with the refreshed token; on persistent
   401 the user is signed out.

---

## Environment variables

The web app needs (in `apps/web/.env.local`):

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # server-only, never exposed
DATABASE_URL=
CRON_SECRET=                  # for cron job endpoint auth
```

Mobile apps need the same Supabase URL + anon key, plus the API base URL.

- iOS: `Core/Utilities/Config.swift` reads from `Info.plist`
- Android: `core/utils/BuildConfig` reads from `build.gradle.kts`

---

## Cron / scheduled jobs

All scheduled tasks are HTTP endpoints in `apps/web/app/api/cron/...`
authenticated by `CRON_SECRET`. **No PostgreSQL stored procedures, no
`pg_cron`** — see `apps/web/CLAUDE.md` for the project-wide rule.

`vercel.json` schedules:

```json
{
  "crons": [
    { "path": "/api/cron/cleanup-token-blacklist", "schedule": "0 0 * * *" }
  ]
}
```

---

## Design language summary

All platforms share the same visual language:

- **Forced dark mode** — slate/zinc backgrounds, white text, accent-coloured highlights
- **Brand colours:**
  - Indigo `#6366F1` — steps, info, primary CTA
  - Purple `#8B5CF6` — weight, achievements, milestone badges
  - Orange `#F97316` — streaks, energy, claim button
  - Green `#10B981` — success states, completion
  - Cyan `#06B6D4` — sync states, accents
  - Pink `#EC4899` — variety
- **Inspired by Apple Fitness / Google Fit** — circular progress rings,
  flame visuals, activity rings, gradient meters
- **Animations** — spring physics for celebrations, ease-out for transitions
- **Confetti** on milestone unlock, big achievements

Each platform doc translates these into its specific tokens.

---

## How features map across platforms

If you're looking at one platform and wondering "where's the equivalent
on the others?", here's the map for the major features ported during the
parity sprint:

| Feature | iOS path | Android path | Web path |
|---------|----------|--------------|----------|
| Streak claim hub | `Features/Streaks/StreakClaimContainerView.swift` | `features/streaks/StreakClaimScreen.kt` | `app/streaks/page.tsx` |
| Daily challenge | `Features/DailyChallenge/DailyChallengeDetailView.swift` | `features/dailychallenge/DailyChallengeScreen.kt` | `app/daily-challenge/page.tsx` |
| Momentum / flame | `Features/Momentum/MomentumDetailView.swift` | `features/momentum/MomentumScreen.kt` | `app/momentum/page.tsx` |
| Exercise log | `Features/ExerciseLog/ExerciseLogView.swift` | `features/exerciselog/ExerciseLogScreen.kt` | `app/exercise-log/page.tsx` |
| Beverage log | `Features/BeverageLog/BeverageLogView.swift` | `features/beveragelog/...` | `app/beverage-log/page.tsx` |
| Fitness assessment | `Features/Onboarding/Screens/OnboardingAssessmentView.swift` | `features/onboarding/screens/OnboardingAssessmentScreen.kt` | `app/onboarding/assessment/page.tsx` |
| Share card button | `Features/Share/ShareCardTrigger.swift` (`ShareCardButton`) | `features/share/ShareCardTrigger.kt` (`ShareCardButton`) | `components/ShareCardButton.tsx` |
| Animated flame | `Features/Momentum/MomentumFlameView.swift` | `features/momentum/MomentumFlameView.kt` | `components/MomentumFlame.tsx` |
| Milestone celebration | `Features/Momentum/MomentumMilestoneView.swift` | `features/momentum/MomentumMilestoneView.kt` | inline in `app/momentum/page.tsx` |
| Settings hub | `Features/Profile/Settings/SettingsView.swift` | `features/settings/...` | `app/settings/page.tsx` |
| Quests + Boost | `Features/FitCircles/CircleQuestsView.swift` + `CircleBoostView.swift` | `features/circles/...` (note Android calls them "circle challenges" in places) | `components/CircleQuestsSection.tsx` |

---

## When in doubt

1. **Check the platform-specific doc** first — it has the recipe.
2. **Check the corresponding iOS file** — iOS is the source of truth for UX and behaviour.
3. **Check `apps/web/CLAUDE.md`** — has project-wide rules (no stored procedures, no auto-commits, etc.).
4. **The mobile API route is the contract** — if iOS and Android disagree, the route shape wins.
