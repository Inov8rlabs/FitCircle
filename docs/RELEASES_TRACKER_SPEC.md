# Releases tracker

One place to see every FitCircle release: iOS, Android and backend/web. For each release it records the version/build, track, status history with dates, rollout, the store's "What's New" text, internal notes, and linked commits and migrations. It also shows what is live, in review and in testing right now.

- UI: Admin Tools → FitCircle → **Releases** (https://admintools.inov8rlabs.com/apps/fitcircle/releases)
- API: `/api/admin/releases/*` (this repo)
- Data: migration `111_releases_tracker.sql`
- Code: `apps/web/app/lib/releases/*`

The design copies the Ads Console (docs/ADS_CONSOLE_SPEC.md): service-role tables, read-only store connectors, an hourly cron with one sync-run row per source, and admin routes proxied by Admin Tools.

## 1. Model (migration 111)

| table | what |
|---|---|
| `releases` | One row per `(platform, track, version/build)`, unique on `release_key`. |
| `release_events` | Append-only status history. A row is written only when the status changes. Unique on `(release_id, to_status, occurred_at)`, so re-runs are no-ops. |
| `release_sync_runs` | One row per store sync attempt (`source`, `trigger`, `ok`, `rows_releases`, `rows_events`, `error`). |

All three tables have RLS on with no policies, so only the service role can use them. There are no functions or triggers, and `updated_at` is set by the application.

**`release_key`** (`lib/releases/status.ts#releaseKey`):

| platform / track | key |
|---|---|
| iOS App Store version | `ios:app_store:1.0.9` |
| iOS TestFlight build | `ios:testflight:1.1.0(72)` (build numbers can repeat across versions) |
| Android Play track release | `android:play_production:36`, `android:play_internal:37` (highest versionCode) |
| Android Firebase dev build | `android:firebase_dev:37` |
| Backend / web deploy | `backend:production:517d8e1` (short SHA) |

**Tracks.** Store tracks are `app_store`, `play_production` and `production` (backend). Every other track is a testing track: `testflight`, `play_internal`, `play_alpha`, `play_beta`, `play_<custom>`, `firebase_dev`, `preview`.

**Statuses** (`types.ts#RELEASE_STATUSES`):

`draft`, `processing`, `in_testing`, `waiting_for_review`, `in_review`, `pending_release`, `rejected`, `developer_rejected`, `rolling_out`, `live`, `halted`, `superseded`, `expired`, `removed`.

The store's raw state is kept in `store_status`, and the raw API payload is in `raw`.

**Column ownership:**
- **Store-owned** (the sync overwrites these): status, store_status, build, release_type, rollout_fraction, countries, whats_new, source/source_id, store_created_at, uploaded_at, submitted_at, raw, synced_at.
- **Set once:** approved_at, released_at and superseded_at are stamped when the sync sees the status change. A row the sync sees for the first time never gets invented dates.
- **Admin-owned** (the sync never overwrites these): internal_notes, known_issues, commits, migrations, links, notes_updated_by/at.
  - The sync never writes internal_notes, known_issues, migrations or notes_updated_by/at.
  - **Fill-if-empty:** the sync writes `commits` only while the stored list is empty, and adds a `links` key only when the key is absent. It never changes existing commits or links (`status.ts#planFill`).
  - These writes are separate compare-and-set updates (`sync-service.ts#applyFill`): `commits` is set only `where commits = '[]'`, and `links` only where they still equal what the sync read. An admin edit made mid-sync always wins.
  - Clearing `commits` back to `[]` lets the next sync fill it again.

**Commits** have the shape `{ sha, subject, repo, date }`:
- `sha` is the full 40-character SHA.
- `subject` is the first line of the commit message.
- `repo` is `FitCircleBE`, `FitCircle-iOS` or `Fitcircle-Android`.
- `date` is `YYYY-MM-DD`.

How each platform gets its SHA:

| platform | source | written when |
|---|---|---|
| iOS (App Store + TestFlight) | Xcode Cloud build run with the same number as the build (§3.1) | hourly ASC sync |
| Android (every Play track, Firebase) | `releases/<versionCode>/COMMIT` from `scripts/play-release.sh` (§3.2.1) | next `play-release.sh` run, or the recorder script. New track rows copy it from a sibling with the same versionCode. |
| Backend | the running deployment's `VERCEL_GIT_COMMIT_SHA` (§3.3) | hourly cron, admin Sync now, first admin list per instance |

## 2. "Live now"

`model.ts#computeLiveNow` works out three things per platform (ios, android, backend, plus web when it has rows):
- **live:** the highest version/build on a store track with status `live` or `rolling_out`.
- **inReview:** the highest store-track row in `waiting_for_review`, `in_review` or `pending_release` that is newer than live.
- **inTesting:** the highest testing-track row in `in_testing` that is newer than live.

## 3. Sync (hourly, `GET /api/cron/releases/sync` at :35)

`services/sync-service.ts` runs each configured connector. One failing store never blocks the other, and an unconfigured store is skipped (`not_configured`, no run row).

For each store, a sync run:
1. Reads the snapshot.
2. Loads existing rows by key.
3. Runs `planRelease` per release. This merges store-owned columns and plans an event only on a status change.
4. Upserts on `release_key`.
5. Upserts the events.
6. For tracks the store lists completely (Google Play), marks any current row (`live`, `rolling_out`, `in_testing`, `halted`) that dropped off the list as `superseded`.

Admin "Sync now" (`POST /api/admin/releases/sync`) is debounced: it does nothing for a source that finished less than 2 minutes ago.

### 3.1 App Store Connect (`connectors/app-store.ts`), read-only GETs

It reuses the campaigns ASC client. Env vars: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`, `ASC_APP_ID` (defaults to 6811432467).

What it reads:
- `apps/{id}/appStoreVersions` with `include=build,appStoreVersionPhasedRelease`:
  - `appVersionState` → status.
  - Apple keeps every old version in READY_FOR_SALE, so only the highest live version stays `live` and the older ones become `superseded`.
  - An active phased release becomes `rolling_out`, with the fraction taken from Apple's 1/2/5/10/20/50/100% day schedule. A paused one becomes `halted`.
- `reviewSubmissions` with `include=appStoreVersionForReview` → `submitted_at`, the latest submittedDate for the version.
- `appStoreVersionLocalizations` per version → en-US `whatsNew`.
- `builds` with `include=preReleaseVersion,buildBetaDetail,betaBuildLocalizations` → one `testflight` row per build:
  - Status: processing, in_testing, expired or removed.
  - The en-US TestFlight "What to Test" text.

- **Xcode Cloud commit** (Xcode Cloud stamps build number = ciBuildRun number):
  - Reads `ciProducts?filter[app]=<appId>`, then one page of `ciProducts/{id}/buildRuns?sort=-number&limit=200` with fields `number, startedDate, finishedDate, sourceCommit, completionStatus`.
  - For each iOS row (`app_store` and `testflight`) whose build number matches a `SUCCEEDED` run, it fills `commits` with `[{ sha: sourceCommit.commitSha, subject: first line of sourceCommit.message, repo: 'FitCircle-iOS', date: run startedDate (UTC day) }]` when `commits` is empty. Apple gives no commit date.
  - It also sets `links.xcode_cloud` to `sourceCommit.webUrl` (the GitHub commit page) when that key is absent.
  - Build numbers have collided: some 1.0.4–1.0.6 builds were uploaded from a Mac, reusing numbers before the cloud run with that number existed. So a match also requires the build's `uploadedDate` to fall between the run's start and 6 hours after it finished. Otherwise nothing is filled.
  - A failing Xcode Cloud read only logs a warning. The store sync still succeeds.

Apple exposes no "approved at" or "released at" timestamps. The sync records them when it observes the change, to within an hour.

### 3.2 Google Play (`connectors/google-play.ts`), read-only

Env vars:
- `GOOGLE_PLAY_SA_KEY`: the service-account key JSON, raw or base64. The account is release-tracker@fitcircle-fitness-app.iam.gserviceaccount.com, invited in Play Console with view-only permissions.
- `GOOGLE_PLAY_PACKAGE_NAME`: defaults to `com.inov8rlabs.apps.fitcircle`.

Tracks can only be read inside an edit. Each sync calls `POST edits`, then `GET edits/{id}/tracks`, then `DELETE edits/{id}`. The DELETE runs in a `finally` block, and the edit is **never committed**.

Status mapping:

| Play release status | production track | testing tracks |
|---|---|---|
| `completed` | `live` | `in_testing` |
| `inProgress` | `rolling_out` (`userFraction`) | `in_testing` |
| `halted` | `halted` | `halted` |
| `draft` | `draft` | `draft` |

The version comes from the release name ("36 (1.0.9)"). Release notes come from `releaseNotes` (en-US), and countries from `countryTargeting`.

The Play API has no "in review" state, so review shows up only as a gap before a release appears on the track.

#### 3.2.1 Android commits

Play does not know commits. The Android repo is private, and the Vercel project has no GitHub token, so the SHA is recorded at build time:
- `Fitcircle-Android/scripts/play-release.sh <versionCode>` refuses to build from a dirty tree. `ALLOW_DIRTY=1` overrides it loudly.
- It captures HEAD before the build. With the bundle, it writes `releases/<versionCode>/COMMIT`:
  - line 1: the full SHA
  - line 2: the commit date (`%cs`)
  - line 3: the subject
  - line 4: `dirty`, only with ALLOW_DIRTY. The recorded subject then ends with "(built from a dirty tree)".
- By convention the release commit is "Android X.Y.Z versionCode N".
- `apps/web/scripts/releases-record-android-commits.ts --env <.env.local> --releases-dir <Fitcircle-Android/releases> [--dry-run]` (`services/android-commits.ts`) fills `commits` on every android row with that build (any track) where it is empty. It is re-runnable.
- `play-release.sh` runs the recorder after the prod smoke gate, for all earlier builds, whose Play rows exist by then. A failure there never blocks the release.
- When the Play sync first sees a new track row for a versionCode (e.g. `play_production:49` after `play_internal:49`), it copies the commits of a sibling android row with the same build. Android versionCodes are unique; iOS build numbers are not, so this applies to Android only.

### 3.3 Backend / web: self-registration (`services/backend-release.ts`)

The running production deployment registers itself. `ensureRunningBackendRelease()` runs on:
- the hourly releases cron
- admin "Sync now"
- the first `GET /api/admin/releases` per server instance (memoized, never throws)

It uses Vercel's system env vars. "Automatically expose System Environment Variables" is on for `fit-circle-web` (checked 2026-11-03).

| env | use |
|---|---|
| `VERCEL_ENV` | must be `production`, else skipped (preview, local) |
| `VERCEL_GIT_COMMIT_SHA` | full SHA. The key is `backend:production:<first 7>` |
| `VERCEL_GIT_COMMIT_MESSAGE` | first line becomes the commit subject |
| `VERCEL_GIT_COMMIT_REF` | `store_status` and `raw.gitRef` |
| `VERCEL_DEPLOYMENT_ID` | `source_id` and `raw.vercelDeploymentId` |

**New SHA:** it inserts a row in the same format as the hand-made rows:
- version = UTC date
- build = 7-character SHA
- status `live`
- source `git`
- `released_at` = the first time this SHA is seen running
- `commits` = `[{ sha, subject, repo: 'FitCircleBE', date: that UTC day }]`
- `links.commit` = the GitHub commit URL
- `migrations` = `[]`

It writes a `null → live` event. Each previous `live`/`rolling_out` backend row becomes `superseded`, with `superseded_at` and an event.

Rules:
- The time is first-seen, not the deploy time. Vercel exposes no deploy time without an API token, so the time can be up to an hour after the deploy unless someone opens Releases first.
- Migrations are not detected: `supabase/migrations` is not in the serverless bundle. Add them on the row by hand.
- **Known SHA** (e.g. added by hand): it only fills empty `commits` and a missing `links.commit`. Status, dates and notes are left alone.
- A rollback to an older, superseded SHA is not re-marked live automatically. Set it by hand.
- Concurrent instances race on the `release_key` unique constraint, and the loser does nothing.
- It never runs at build time or cold start. Vercel sets the same env during `next build`, and that build may still fail.

Rows can still be added or edited by hand with `POST /api/admin/releases` or Admin Tools → Releases → New release (e.g. web-only deploys). Creating a `live` row on a store track automatically supersedes the previous live row of that platform and track.

### 3.4 Running the sync from a laptop

```
cd apps/web
ASC_KEY_ID=… ASC_ISSUER_ID=… bun scripts/releases-sync-local.ts --env <path to .env.local with prod SUPABASE_*> --asc-key ~/Downloads/AuthKey_<id>.p8 [--source app_store_connect]
```

## 4. Admin API (`/api/admin/releases/*`)

Auth is the same gate as `/api/admin/ads`: `ADMIN_API_SECRET` plus `X-Admin-Actor` from Admin Tools, or an `is_admin` session. Mutations made with the secret must carry `X-Admin-Actor`. Responses use the standard envelope.

| method | path | body / query | returns |
|---|---|---|---|
| GET | `releases` | `?platform&track&status&from&to&includeTesting&limit` | `ReleasesList { releases (newest first), liveNow, sync }`. Testing tracks are listed only with `includeTesting=1` or an explicit `track`. |
| POST | `releases` | `{ platform, track, version, build?, status, releasedAt?, submittedAt?, whatsNew?, internalNotes?, knownIssues?, commits?, migrations?, links? }` | 201 `ReleaseDetail`. 409 `DUPLICATE` if the key exists. |
| GET | `releases/:id` | | `ReleaseDetail { release, events (newest first) }` |
| PATCH | `releases/:id` | `{ internalNotes?, knownIssues?, whatsNew?, links?, commits?, migrations?, releasedAt?, status?, note? }` (strict) | `ReleaseDetail`. A status change appends a `manual` event. |
| GET / POST | `releases/sync` | POST `{ source? }` | `{ results, status }` |

Validation: links must be http(s) URLs (at most 30). Commits are `{ sha (hex), subject, repo?, date? }`.

The Admin Tools proxy whitelists exactly these routes: GET/POST `releases`, POST `releases/sync`, GET/PATCH `releases/:id`. It does not whitelist DELETE.

## 5. Adding notes at release time

1. **iOS / Android:** submit as usual. Within an hour the sync creates the row (`draft` → `waiting_for_review` → … → `live`) with the store's What's New. Open it in Admin Tools → Releases and fill in:
   - **Internal notes** (markdown): what shipped and key fixes.
   - **Known issues.**
   - **Commits:** filled automatically (§1 "How each platform gets its SHA"). Add the range since the previous version if useful; the sync never overwrites it.
   - **Migrations:** any backend migrations the release depends on.
   - **Links:** PRs, the Firebase build, crash dashboards.
2. **Backend:** the row creates itself (§3.3); add migrations and notes on it. To add one by hand (e.g. before the cron runs), use **New release** with platform `backend`, track `production`, version = the date, build = the short SHA, status `live`, migrations, and notes. Over the API:
   ```
   curl -X POST https://www.fitcircle.ai/api/admin/releases -H "Authorization: Bearer $ADMIN_API_SECRET" -H "X-Admin-Actor: you@inov8rlabs.com" -H 'Content-Type: application/json' \
     -d '{"platform":"backend","track":"production","version":"2026-10-27","build":"abcdef1","status":"live","migrations":["111_releases_tracker"],"internalNotes":"- …"}'
   ```
3. **Firebase App Distribution** (Android dev) builds are not synced. Add them manually with track `firebase_dev`, build = versionCode, status `in_testing`.

## 6. Backfill (2026-10-27)

`apps/web/scripts/releases-backfill.ts <json> --env <.env.local> [--dry-run]` writes only to `releases` and `release_events`, and is re-runnable:
- **New key:** inserts the row and its events.
- **Existing row:** fills only empty admin fields and null dates. It never changes status.

The first backfill used `apps/web/scripts/releases-data/releases-backfill-2026-10-27.json`:
- iOS: App Store versions 1.0 → 1.0.9, plus TestFlight 1.0.6(62) and 1.1.0(72).
- Android Play: production vc8, 12, 15, 16, 19 and 36; internal vc9, 10, 11, 12, 14 and 36; Firebase dev vc37.
- 28 backend production deploys from 2026-09-29 to 517d8e1.

The backfill was built from read-only git history and release notes. Uncertain items are marked "(unverified)" or "day only", and dates known only to the day are stored as 12:00 UTC. The ASC sync then filled the iOS store fields and every TestFlight build. The Google Play sync reconciles the Android rows once it has access.

## 7. Limits / follow-ups

- Approval and release times are only as precise as the hourly sync. Backfilled ones are day-precision.
- Play review state is not visible through the API.
- Backend `released_at` is first-seen, not the Vercel ready time, and backend migrations are not detected (§3.3). A Vercel API token or deploy hook could fix both.
- Android commits depend on `play-release.sh`. A bundle built another way has no COMMIT file; fill its commits in Admin Tools.
- iOS builds not made by Xcode Cloud (local uploads) get no commit automatically.
