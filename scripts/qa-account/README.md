# QA automation account

A dedicated production account for automated tests: Maestro smoke/regression on
iOS and Android, the post-deploy smoke (`scripts/smoke/prod-smoke.mjs`) and the
always-on Mac runner. It is **not** the App Review demo account
(`scripts/demo-account/`, `fitcircle.user@gmail.com`). The seed script refuses
to touch that account or its circle, and automation must never sign in to it.

| | |
|---|---|
| Email | `qa.automation@fitcircle.ai` (admin-created, email pre-confirmed, no mail sent) |
| User id | `c2452004-ef2d-4cde-912e-08481a398e62` (prod, created 2026-10-21) |
| Profile | username `qa_automation`, "QA Automation", free tier, onboarding completed, America/Los_Angeles |
| Circle | "QA Automation Circle" `58450580-cfe7-47e5-9fca-0a2870d6711d`, invite_only, owned by the QA user only |
| Baseline | 3 complete days before today (3 meals + 2 × 500 ml water, steps, weight); **today is empty** so smoke flows start clean |
| Password | in `~/FitCircleCI/secrets.env` on the runner (`QA_EMAIL`, `QA_PASSWORD`, chmod 600). Never in git or GitHub secrets |

## Run

Needs the production service-role key in the environment. Load it without echoing:

```sh
cd FitCircleBE
(set -a; . apps/web/.env.local; set +a; node scripts/qa-account/seed.mjs)            # dry run
(set -a; . apps/web/.env.local; set +a; node scripts/qa-account/seed.mjs --apply)    # seed / reset
(set -a; . apps/web/.env.local; set +a; node scripts/qa-account/seed.mjs --apply --rotate-password)
(set -a; . apps/web/.env.local; set +a; node scripts/qa-account/seed.mjs --delete --apply)  # remove everything
```

Re-running `--apply` is idempotent: it keeps the password from the secrets
file, re-applies the profile, deletes the QA user's activity rows
(`food_log_entries`, `daily_tracking`, `exercise_logs`, `streak_claims`,
`engagement_activities`, `plate_scores`), re-inserts the baseline, zeroes the
streak summary and keeps the circle invite_only and running a year out. Every
delete is filtered by the QA user id.

The circle is created through `POST /api/mobile/circles` as the QA user, so
invite code, membership and other server defaults match a real circle.

The nightly regression on the runner re-seeds before running (see
`docs/TEST_PLAN.md`), so state written by the previous day's flows (water, a
text meal) never accumulates.

## Rate limit

`/api/mobile/auth/login` allows **5 attempts per 15 minutes per IP** (in-memory
per serverless instance). Seeding uses 2 logins (create circle + verify), each
Maestro sign-in uses 1, and smoke caches a refresh token so it normally uses 0.
Don't run seeding and both Maestro smoke suites back to back more than once per
15 minutes from the same Mac.
