# Release checklist (backend gate)

The production smoke check must pass **before every App Store or Play Store
submission** and **right after every backend deploy**. It exists because unit
tests use fake databases: on 2026-11-02 a bad PostgREST FK hint
(`profiles!challenge_participants_user_id_fkey`) shipped and broke every circle
challenge leaderboard until a user found it.

Two layers:

| Layer | What it catches | Command |
|---|---|---|
| DB contract test | a query names a table, column or FK that doesn't exist in the prod schema snapshot | `cd apps/web && npx vitest run __tests__/unit/db-contract.test.ts` |
| Prod smoke | a real endpoint 4xx/5xx-es, returns `success: false`, or drifts from the shape the iOS/Android models decode | `npm run smoke:prod` |

One command runs both (non-zero exit on any failure):

```sh
cd FitCircleBE
npm run release:preflight          # = bash scripts/release-preflight.sh
```

## Prerequisites

`apps/web/.env.local` (or the environment) must hold the **production**
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `JWT_SECRET`. In a git
worktree without its own `.env.local`, point at the main checkout:

```sh
SMOKE_ENV_FILE=../FitCircleBE/apps/web/.env.local npm run smoke:prod
```

Values are read only from those keys and never printed.

## Before submitting to the stores

### iOS (Xcode Cloud)

Xcode Cloud cannot hold the service-role key, so the gate is manual:

1. `npm run release:preflight` passes on the backend commit that is live in prod.
2. Only then submit the build for App Store review in App Store Connect.
3. Paste the `SUMMARY OK …` line into the release notes in the Releases tracker
   (Admin Tools → FitCircle → Releases).

### Android (Play)

`Fitcircle-Android/scripts/play-release.sh` runs the prod smoke automatically
before building and refuses to build if it fails. It looks for the backend at
`../FitCircleBE` next to the Android repo; override with
`FITCIRCLE_BE_DIR=/path/to/FitCircleBE`. Emergency bypass (prints a loud
warning; run the smoke by hand afterwards): `SKIP_PROD_SMOKE=1`.

Still run `npm run release:preflight` once before promoting to production, so the
DB contract test is covered too.

## After a backend deploy

Wait until the Vercel deployment is **Ready** (`vercel ls`, the dashboard, or the
Vercel MCP `get_deployment`), then:

```sh
# production (www.fitcircle.ai) after a prod deploy
npm run smoke:prod

# a specific deployment URL (preview or the immutable prod URL)
npm run smoke:prod -- --base https://<deployment>.vercel.app
```

Previews behind Vercel Deployment Protection need
`VERCEL_AUTOMATION_BYPASS_SECRET` in the environment; the smoke sends it as
`x-vercel-protection-bypass`. Previews use the same production Supabase, so the
smoke account works there too. The minted mobile token is signed with the `JWT_SECRET`
from your env file, so it only works against deployments that share that secret
(production and previews do, as long as the Preview env uses the prod value).

Some checks assert behavior, not just shape, using the smoke fixtures: the smoke circle
appears in `/profile/streak` by name, `/daily-goals/recommendations` are circle-based,
plate score uses the kcal challenge target, the challenge leaderboard lists the smoke user.

If the smoke fails right after a deploy: check it is not a smoke-script mistake
(the failure line names the route, status and missing field), then roll back with
`vercel rollback` / promote the previous deployment, or hotfix.

## What the smoke does

`scripts/smoke/prod-smoke.mjs` (`--help` for every flag):

- **Auth, no password anywhere.** With the service-role key it finds or creates the
  dedicated smoke account, calls `auth.admin.generateLink({ type: 'magiclink' })`
  (sends no email) and `auth.verifyOtp({ type: 'magiclink', token_hash })`, then
  issues the same HS256 mobile access token `/api/mobile/auth/login` issues
  (`{ userId, email, type: 'access' }`, 15-minute expiry, signed with `JWT_SECRET`)
  and calls the API with `Authorization: Bearer …` like the apps. The API rejects raw
  Supabase access tokens, which is why that last step exists. The Supabase session
  is signed out at the end of the run.
- **Read-only by default.** GETs the endpoints behind the main mobile screens:
  profile, home feed, daily goals, tracking, vitals, streaks, circles (list,
  detail, leaderboards, members), circle challenges and the challenge leaderboard,
  chats inbox and messages, food log, nutrition, plate score, entitlements, app
  update policy and more. Each asserts HTTP 2xx, `success === true` on envelope
  routes, `Cache-Control: no-store`, and the fields the iOS/Android models require.
- **Integrity health** (service role; prod `security_events`, last 24 h): each Android
  auth action (register, login, google, refresh) with ≥ 3 attempts that carried a Play
  Integrity token must have passes > 0 and an infrastructure fail-open share < 20 %
  (device-environment fail-opens never count). FAIL otherwise; SKIP ("WARN") when there
  is no data. Catches a silent fail-open like 2026-11-11 (docs/INTEGRITY_CONTRACT.md).
  The window is 24 h, so after a fix it keeps failing until the bad rows age out;
  `--skip-integrity-health` skips it (say why in the release notes).
- **`--writes`** (off by default): posts a chat message in the smoke circle,
  reads it back, deletes it, and checks it is gone. Only ever on the smoke
  account and the smoke circle.
- **Output**: one line per check with status and latency, then a summary.
  `--json` prints one JSON document for CI; `--junit <path>` writes JUnit XML.
  Exit code 1 on any failure.

### The smoke account and its data

| | |
|---|---|
| Email | `smoke-test+prod@fitcircle.ai` (admin-created, `email_confirm: true`, **no password**) |
| User id | `3416b816-5a48-411a-9826-478bd0a027de` (prod, created 2026-11-02) |
| Profile | username `fc_smoke_test`, "FitCircle Smoke Test", free tier, onboarded, America/Los_Angeles |
| Circle | "FitCircle Smoke Circle" `f283d106-7b4d-4bb6-bf88-56777fdf2687`, invite_only, smoke user is the only member |
| Challenges | "Smoke Steps Challenge" `f73ab7ce-1d4e-4bb6-8eb1-09e7877b47d0` (unit `steps`, drives the steps leaderboard) and "Smoke Calorie Challenge" `ba51c51e-cfff-401a-bde5-ed53ec2ab638` (unit `kcal`, goal 2100: plate score must use it as its target); both run a year |

How it stays out of metrics and mail:

- `@fitcircle.ai` is an internal domain in `app/lib/ads/test-users.ts`
  (`classifyTestUser` → `internal`), so the ads console, the twice-daily report and
  the growth numbers built on it exclude it.
- `profiles.metadata`, `auth.users` `user_metadata`/`app_metadata` and the circle's
  `metadata` carry `{ smoke_test: true, test_account: true }`.
- `profiles.preferences.marketingEmails = false` (campaign emails skip it); it has no
  push tokens; it never calls client analytics (Amplitude events come from the apps).
- The script refuses any email that isn't `smoke*@fitcircle.ai` and refuses the App
  Review demo account and circle by id.

Fixtures are created idempotently on each run if missing (account, profile
fields, circle, an active steps challenge, 3 days of steps/weight, one food entry,
one chat message). Nothing outside the smoke account and smoke circle is written.
To recreate from scratch, delete the auth user (cascades to the profile) and the
circle, then run `npm run smoke:prod -- --setup-only`.

### Legacy mode (always-on Mac runner)

Without the service-role key (the self-hosted runner in
`.github/workflows/self-hosted-smoke.yml`), the script falls back to
`SMOKE_ACCESS_TOKEN` or the QA account's cached refresh token, and skips
authenticated checks if neither works. It never sends a password. Release gates
pass `--require-service-role`, so they never fall back.
