# Engage: detailed implementation plan

**Status:** Ready to execute · written 2026-10-31
**Inputs:** `ENGAGE_V2_SPEC.md` (approved; §17 records every decision), `ENGAGE_MULTITENANCY.md`, `ENGAGE_TOOL_HOSTING.md`, `ENGAGE_FINISH_PLAN.md` (summary-level phases; **this document supersedes it for execution**), `ENGAGE_RESEARCH.md`.
**Audience:** whoever builds it, human or agent. Every work item lists the exact files, the interfaces, the tests and the "done" criteria. When this plan and the spec disagree, the spec wins on behaviour and this plan wins on sequencing and file layout. Fix the loser in the same PR.

---

## 0. How to use this plan

### 0.1 Work item format
Every item has an ID (`E1.04`), and every item lists:
- **Repo / path:** where the change lives.
- **Do:** numbered steps.
- **Interfaces:** exact types, routes and SQL where relevant.
- **Tests:** named test files and the cases they must cover.
- **Done when:** objective checks.
- **Depends on:** item IDs.

### 0.2 Repositories, branches and worktrees

| Repo | Local path | Branch for this work | Notes |
|---|---|---|---|
| **engage** (new) | `/Users/ani/Code/Engage` | `main` (new repo) | Private GitHub repo under the `Inov8rlabs` org. |
| FitCircleBE | worktree `/Users/ani/Code/FitCircle/FitCircleBE-engage2` | `feat/engage-v2` from `origin/main` | The parked v1 is on `feat/engage` (worktree `/Users/ani/Code/FitCircle/FitCircleBE-engage`). **Read only, never merge it.** |
| FitCircle-iOS | worktree `/Users/ani/Code/FitCircle/FitCircle-iOS-engage2` | `feat/engage-v2` from `origin/main` | v1: `feat/engage` @ `6389971`. |
| Fitcircle-Android | worktree `/Users/ani/Code/FitCircle/Fitcircle-Android-engage2` | `feat/engage-v2` from `origin/main` | v1: `feat/engage` @ `6611b10`. |
| inov8r-admin | worktree `/Users/ani/Code/inov8r-admin-engage` | `feat/engage` from `origin/main` | The main checkout is on another branch; don't touch it. |

Create the worktrees:
```bash
git -C /Users/ani/Code/FitCircle/FitCircleBE fetch origin && git -C /Users/ani/Code/FitCircle/FitCircleBE worktree add -b feat/engage-v2 ../FitCircleBE-engage2 origin/main
git -C /Users/ani/Code/FitCircle/FitCircle-iOS fetch origin && git -C /Users/ani/Code/FitCircle/FitCircle-iOS worktree add -b feat/engage-v2 ../FitCircle-iOS-engage2 origin/main
git -C /Users/ani/Code/FitCircle/Fitcircle-Android fetch origin && git -C /Users/ani/Code/FitCircle/Fitcircle-Android worktree add -b feat/engage-v2 ../Fitcircle-Android-engage2 origin/main
git -C /Users/ani/Code/inov8r-admin fetch origin && git -C /Users/ani/Code/inov8r-admin worktree add -b feat/engage ../inov8r-admin-engage origin/main
```
In FitCircleBE, link Supabase for the worktree before any `db query`: run `npx -y supabase@latest link --project-ref <ref>`, or run the queries from `/Users/ani/Code/FitCircle/FitCircleBE`, which is already linked.

### 0.3 House rules (non-negotiable)
1. **No stored procedures, functions or business-logic triggers** in any database. Logic lives in TypeScript services.
2. **Migrations are applied one at a time**, through `npx -y supabase@latest db query --linked -f <file>` plus a history insert. **Never** run `db push --include-all` (104 is unapplied by design). The next free number is **118**; check `select max(version) from supabase_migrations.schema_migrations` before writing.
3. **Every push goes through `NotificationOrchestrator.send`** (`apps/web/app/lib/services/notification-orchestrator.ts`). No second send path.
4. **Home feed cards go through `composeFeed`** (`apps/web/app/lib/home-feed/compose.ts`) and its guardrails.
5. **Authenticated responses are `Cache-Control: no-store`.**
6. **No emoji as icons.** Use icon keys from `design/icons.json` only, gated on `X-Client-Features: icon_keys`. No fabricated numbers or social proof.
7. **Commits and pushes:** commit on the feature branches listed in §0.2. Merging to `main`, pushing `main`, applying migrations to prod, store submissions and console changes each need the owner's explicit go. A merge to `main` deploys prod on Vercel and triggers Xcode Cloud.
8. **Before calling backend work "live":** run `next build` locally in a worktree with a fresh `bun install`, then confirm the Vercel production deployment is `READY`.
9. **Live-data rule:** before calling a segment, dispatcher or stats change done, run it read-only (dry run) against prod data and compare with an ad-hoc SQL count.
10. **Never print secrets.** Pipe keys to Vercel without echoing them.
11. **Commit message trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### 0.4 Global definition of done (every item)
- Typecheck is clean:
  - TS: `tsc --noEmit`;
  - Swift: builds in Xcode 27 with `-skipMacroValidation` (see memory `project_ios_xcodebuild_macro_failure`);
  - Kotlin: `./gradlew :app:compileDebugKotlin` with the JBR `JAVA_HOME`.
- New tests are written and the **whole** suite of the touched repo passes:
  - FitCircleBE: `npx vitest run` from the repo root;
  - inov8r-admin: `npx vitest run`;
  - iOS: `xcodebuild test` on the `FitCircleTests` scheme with a new simulator (create one freely);
  - Android: `./gradlew testDebugUnitTest verifyRoborazziDebug`.
- Docs are updated: the spec section if behaviour changed, plus this plan's checkbox list (§20).
- Kill switches default to **off** in prod until the rollout step in §18 turns them on.

---

## 1. Scope recap (from the approved spec §17)

| Decision | Value |
|---|---|
| Architecture | Shared **`engage`** monorepo with the protocol, server engine, web, preview, EngageKit (Swift) and engage-android. Each app hosts the Engage tables in its own Supabase database and provides adapters. |
| Tool | Built in the **inov8r-admin** code, served at **`engage.inov8rlabs.com`** with an app switcher. Linked from Admin Tools. |
| Marketing push | **Off until the user opts in** ("Tips & offers" toggle; App Review 4.5.4). |
| Build order | FitCircle first, **inside the library boundary from day one**. |
| Seasonal campaigns | **Become Engage campaigns** with an optional **experience** (`seasonal_circle`, `daily_calendar`, `spotlight`). The old Campaigns module is retired. |
| First-release channels | Push, in-app messages, feed cards, placements, **email**, **web push** and **journeys**. |
| Global control group | **Not now.** The `global_control_pct` setting is kept at 0. |
| Approvals | **Not required.** `ENGAGE_APPROVAL_THRESHOLD` is unset. Safety: dry run, `max_audience`, type-to-confirm above 5,000 or for push-to-all, caps, kill switches, audit. |
| Later apps | BuyForBaby, then TripWiz (E11, E12). |

---

## 2. Schedule and dependency graph

Parallel streams: **S** = shared library and backend, **T** = tool, **I** = iOS, **A** = Android, **W** = web.

```
Week 1   E0 (½d) ─► E0b scaffold (S) ──────────────────────────────┐
Week 2   E1 core engine + migration 118 (S)                       │  T: E4.01–E4.04 hosting/shell/roles
Week 3   E1 cont. ─► E2 delivery surfaces (S)                      │  I/A: E5.01–E5.03 / E6.01–E6.03 port SDK core
Week 4   E2 cont. ─► E3 send pipeline (S)                          │  T: E4.05–E4.10 composer, segments, assets
Week 5   E3 cont. + E7.05 web push sender (S)                      │  I/A: placements, IAM host, push
Week 6   E8 analytics (S) · E9 journeys engine (S)                 │  T: previews, test send, analytics UI, journeys editor
Week 7   E9 cont. · E7 web client (W)                              │  I/A: tests, snapshots, settings toggle
Week 8   Integration: conformance suite green on FitCircle staging; E2E matrix (§17)
Week 9   Hardening, load test, prod dry runs, docs; iOS + Android release builds
Week 10  Rollout per §18 (kill switches stepwise). E10 migration timed around Hold the Line/Advent
```

**Critical path:** E0b → E1.01 (migration) → E1.03 (segment compiler) → E2.03 (sync API) → E5/E6 client integration → E2E (§17) → mobile releases.

**Calendar constraint:** Hold the Line runs Nov 15 – Dec 15 and Advent Dec 1–24. **E10 (migrating the seasonal campaigns) must not touch them while they're live.** Either keep the old Campaigns module working until they end, or migrate only `new_year_reset` and `ramadan_2027` first.

---

## 3. E0: decisions and groundwork (½ day)

### E0.01: Freeze contract decisions
- **Do:**
  1. Confirm the §1 table (done 2026-10-31).
  2. Record the protocol version `engage@1` and the card version `promo@2`.
  3. Reserve migration **118**: create an empty placeholder `supabase/migrations/118_engage.sql` with a header comment on `feat/engage-v2`.
- **Done when:** the placeholder is committed, and §17 of the spec reads "all decisions made".

### E0.02: Create the worktrees and branches (§0.2)
- **Done when:** all four worktrees exist and `git status` is clean in each.

### E0.03: Create the GitHub repo `Inov8rlabs/engage` (private)
- **Do:**
  1. **Human step:** the owner creates the repo, or approves `gh repo create Inov8rlabs/engage --private`.
  2. Add the default branch protection: PRs into `main` require CI to pass.
- **Done when:** `git clone` works locally at `/Users/ani/Code/Engage` (`~/Code/Engage`).

---

## 4. E0b: shared monorepo scaffold (3–4 days)

### E0b.01: Repo skeleton (exact tree)
```
engage/
├── package.json                 # private workspace root (bun workspaces)
├── bun.lock
├── tsconfig.base.json           # strict, ES2022, moduleResolution bundler
├── vitest.workspace.ts
├── .github/workflows/
│   ├── ci.yml                   # TS: typecheck+test (Node 22, matrix next@14.2 / next@15.5); Swift: swift test (macOS); Kotlin: gradle test
│   └── release.yml              # tag v* → publish npm (GitHub Packages), Maven (GitHub Packages); SwiftPM uses the git tag
├── protocol/
│   ├── package.json             # @inov8r/engage-protocol
│   ├── schemas/                 # JSON Schema 2020-12, one file per type (list in E0b.02)
│   ├── openapi/engage.yaml      # mobile + admin APIs (E0b.03)
│   ├── fixtures/                # golden payloads (E0b.04)
│   ├── src/index.ts             # generated TS types (json-schema-to-typescript) + zod validators
│   └── scripts/gen.mjs          # regenerates TS types, Swift Codable models, Kotlin @Serializable models
├── packages/
│   ├── server/                  # @inov8r/engage-server (E1–E3, E8, E9)
│   ├── adapters/                # @inov8r/engage-adapters (supabase-users, fcm-push, apns-push, resend-email, webpush)
│   ├── web/                     # @inov8r/engage-web (React renderers + WebEngage runtime)
│   └── preview/                 # @inov8r/engage-preview (iOS/Android device-frame renderers for the tool)
├── ios/EngageKit/               # Swift Package (Package.swift at ios/EngageKit/Package.swift)
├── android/                     # Gradle project: :engage-core, :engage-compose, :engage-push
└── tools/
    ├── conformance/             # @inov8r/engage-conformance CLI
    └── migrate/                 # `engage migrate` → writes SQL into an app's supabase/migrations
```
- **Root `package.json`:** `"workspaces": ["protocol","packages/*","tools/*"]`. Scripts: `typecheck`, `test`, `gen`, `build`.
- **TS packages** are published as ESM with `exports` maps and `types`. **No Node-only APIs in the route factories**: Web `Request`/`Response` only, so they work on Next 14 and 15.
- **Done when:** `bun install && bun run typecheck && bun run test` pass on an empty scaffold, and CI is green on the first PR.

### E0b.02: Protocol JSON Schemas (`protocol/schemas/*.json`)
Write one schema per type, with these exact names:

| File | Type | Key fields / constraints |
|---|---|---|
| `content.v1.json` | `EngageContent` | `eyebrow≤24`, `title≤60` (required), `body≤240`, `badge≤20`, `icon{key}`, `image{assetId,darkAssetId?,aspect∈[16:9,1:1,4:5,9:16],focal?{x,y},alt?,decorative?}`, `countdown{to,label≤24,hide_after}`, `theme` enum + `experience:<slug>` pattern, `primary?/secondary?: Button`, `dismissible` (required), `footnote≤120`. `additionalProperties: false` on write, ignored on read. |
| `button.v1.json` | `Button` | `label≤24`, `action: Action`, `style∈[primary,secondary,link]` |
| `action.v1.json` | `Action` (oneOf, discriminator `type`) | `open_screen{screen,params?}`, `paywall{context}`, `invite`, `start_circle`, `join_campaign{slug}`, `log_water`, `enable_notifications`, `request_push_permission`, `open_url{url (https), }`, `dismiss`, `track{event}`, `fitzy{prompt?}`, `experience{campaign}` |
| `asset-ref.v1.json` | `AssetRef` | `url, variants[{width,url,format}], width, height, dominantColor (#RRGGBB), alt?` |
| `layout.v1.json` | enums | `FeedLayout = hero\|banner\|compact\|captioned_image\|image_only\|carousel`, `PlacementLayout = banner\|card`, `InAppLayout = modal\|slideup\|fullscreen\|sheet`, `PushLayout = standard\|image\|actions` |
| `sync-response.v1.json` | `SyncResponse` | See E2.03 |
| `events-request.v1.json` | `EventsRequest` | See E2.04 |
| `session-request.v1.json` | `SessionRequest` | See E1.07 |
| `promo-card.v2.json` | `PromoCardV2Props` | Superset of promo@1 props (see E2.02) |
| `push-payload.v1.json` | `EngagePushData` | `engageSendId, engageCampaignId, variantId?, screen?, params?(string map), image_url?, buttons?[{id,label,action}]` |
| `audience.v1.json` | `Audience` | The tree from spec §5.1 (`all`/`any`/`not`/condition) |
| `campaign.v1.json` | `Campaign` | Spec §3.1 + `experience` (§3.4) |
| `message.v1.json` | `Message` | Spec §3.2 |
| `journey.v1.json` | `Journey` | Steps `message`/`delay`/`branch`/`split`/`exit` (§9) |

- **Codegen** (`protocol/scripts/gen.mjs`):
  - TS types plus zod;
  - **Swift** `Codable` structs into `ios/EngageKit/Sources/EngageKit/Generated/`;
  - **Kotlin** `@Serializable` classes into `android/engage-core/src/main/kotlin/com/inov8r/engage/generated/`.
  - Generated code is committed. CI fails if `gen` produces a diff.
- **Done when:** the schemas validate every fixture in E0b.04, and codegen output compiles on all three platforms.

### E0b.03: OpenAPI `protocol/openapi/engage.yaml`
- **Mobile endpoints:** `GET /engage/sync`, `POST /engage/events`, `POST /engage/session`.
- **Admin endpoints:** the full list in E4.03. Paths are **relative**; each app mounts them under its own prefix (FitCircle: `/api/mobile/engage`, `/api/admin/engage`).
- **Done when:** `npx @redocly/cli lint protocol/openapi/engage.yaml` passes.

### E0b.04: Golden fixtures (`protocol/fixtures/`)
- **Minimum set:**
  - `sync/empty.json`;
  - `sync/full.json` (every in-app layout, every placement, prefetch, control);
  - `sync/unknown-fields.json` (unknown layout and field, which clients must ignore);
  - `promo-card/v2-hero.json`, `promo-card/v2-carousel.json`, `promo-card/v1-downconverted.json`;
  - `push/standard.json`, `push/image-actions.json`, `push/legacy-android-safe.json` (only keys allowlisted on shipped Android vc40);
  - `events/batch-50.json`;
  - `session/ios.json`, `session/android.json`, `session/web.json`.
- **Done when:** the fixtures are used by tests in TS (E2), Swift (E5.02) and Kotlin (E6.02).

### E0b.05: Conformance CLI (`tools/conformance`)
- **Command:**
  ```
  npx @inov8r/engage-conformance --base https://staging.example/api/mobile/engage --token <test-user-bearer> --admin-base … --admin-secret-env ENGAGE_ADMIN_SECRET
  ```
- **Checks:**
  1. `/session` accepts every session fixture (204).
  2. `/sync` responds with a schema-valid body, `Cache-Control: no-store`, and **no layout or action the request didn't declare** (it sends restricted `X-Engage-Layouts` and asserts the response respects it).
  3. `/events` is idempotent: resending the same `client_event_id` doesn't double count, which is verified through the admin stats endpoint.
  4. Spoof protection: an impression for an undelivered message gets 202, but it is not counted.
  5. Admin auth: a missing or wrong bearer gets 401.
- **Done when:** it runs against a local FitCircleBE (`next dev`), and its exit code is used in FitCircleBE CI (`.github/workflows` or a vitest wrapper).

### E0b.06: Publishing and consumption
- **npm** (`@inov8r/*`): GitHub Packages registry `https://npm.pkg.github.com`.
  - FitCircleBE `.npmrc`: `@inov8r:registry=https://npm.pkg.github.com` and `//npm.pkg.github.com/:_authToken=${NPM_TOKEN}`.
  - **Human step:** create a fine-grained token with `read:packages` and set **Vercel env `NPM_TOKEN`** on the `fit-circle-web` and `inov8r-admin` projects.
- **SwiftPM:** `https://github.com/Inov8rlabs/engage.git`, product `EngageKit`, from the tag `engage-ios-v0.x.y`. The `Package.swift` sits at `ios/EngageKit/Package.swift`; tag the root, using a root `Package.swift` that points at `ios/EngageKit/Sources`.
  - **Human step:** grant Xcode Cloud access to the repo in App Store Connect → Xcode Cloud → Settings → Repositories.
- **Maven:** GitHub Packages `https://maven.pkg.github.com/Inov8rlabs/engage`, group `com.inov8r.engage`, artifacts `engage-core`, `engage-compose`, `engage-push`.
  - Android `settings.gradle.kts` adds the repository with credentials from `gradle.properties` (`gpr.user`, `gpr.key`) or the env vars `GITHUB_ACTOR`/`GITHUB_TOKEN`.
  - **Fallback** if credentials are a problem in CI: a Gradle **composite build** from a git submodule at `Fitcircle-Android/engage` (`includeBuild("engage/android")`).
- **During development:** the FitCircle repos consume local paths:
  - FitCircleBE: `"@inov8r/engage-server": "file:../../../../Engage/packages/server"`;
  - iOS: a local package reference;
  - Android: `includeBuild`.

  Switch to the published versions before merging to `main`.
- **Done when:** a `v0.0.1` tag publishes all three, and each FitCircle repo resolves it in a throwaway build.

---

## 5. E1: server engine and FitCircle backend core (8–9 days)

### E1.01: Migration `118_engage.sql` (FitCircleBE `supabase/migrations/118_engage.sql`)
- **Source of truth:** `engage/tools/migrate/templates/engage_v1.sql`. `engage migrate --app fitcircle --number 118` writes the file. Hand edits are forbidden; change the template instead.
- **Exact DDL.** Idempotent, tables, indexes and constraints only, row-level security enabled with **no policies** (service role only):

```sql
-- 118: Engage v2 (docs/engage/ENGAGE_V2_SPEC.md §12). Schema only.

create table if not exists public.engage_campaigns (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name text not null,
  description text not null default '',
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','in_review','approved','scheduled','live','paused','completed','archived')),
  kind text not null check (kind in ('one_off','scheduled','recurring','triggered','api','journey')),
  category text not null default 'marketing' check (category in ('marketing','lifecycle','transactional')),
  experience_id uuid references public.campaigns(id) on delete set null,
  audience jsonb not null default '{"all":[]}'::jsonb,
  schedule jsonb not null default '{}'::jsonb,
  trigger jsonb,
  goal jsonb,
  experiment jsonb,            -- {variants:[{id,weight}], control_pct, experiment_key}
  frequency jsonb not null default '{}'::jsonb,
  priority int not null default 50 check (priority between 1 and 100),
  max_audience int check (max_audience is null or max_audience > 0),
  system boolean not null default false,
  version int not null default 1,
  launched_at timestamptz, paused_at timestamptz, completed_at timestamptz, archived_at timestamptz,
  created_by text, updated_by text,          -- admin emails (X-Admin-Actor)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists engage_campaigns_status_idx on public.engage_campaigns (status) where archived_at is null;

create table if not exists public.engage_campaign_versions (
  campaign_id uuid not null references public.engage_campaigns(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,                    -- campaign + messages at launch
  launched_by text, launched_at timestamptz not null default now(),
  primary key (campaign_id, version)
);

create table if not exists public.engage_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.engage_campaigns(id) on delete cascade,
  journey_step_id text,                       -- null unless part of a journey
  surface text not null check (surface in ('push','in_app','feed','placement','email','web_push')),
  placement_id text,
  layout text not null,
  variants jsonb not null,                    -- [{id,weight,content,locales?,platform_overrides?}]
  fallback jsonb,                             -- {layout?,content?} | {"skip":true}
  rules jsonb not null default '{}'::jsonb,   -- in_app_rules | card_rules | push_rules | email_rules
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (surface <> 'placement' or placement_id is not null)
);
create index if not exists engage_messages_campaign_idx on public.engage_messages (campaign_id);

create table if not exists public.engage_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text not null default '',
  audience jsonb not null,
  materialized boolean not null default false,
  estimated_count int, estimated_at timestamptz,
  created_by text, updated_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table if not exists public.engage_segment_members (
  segment_id uuid not null references public.engage_segments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (segment_id, user_id)
);

create table if not exists public.engage_assets (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  name text not null,
  mime text not null check (mime in ('image/png','image/jpeg','image/webp','image/gif')),
  width int not null check (width > 0), height int not null check (height > 0), bytes int not null check (bytes > 0),
  url text not null, variants jsonb not null default '[]'::jsonb,
  dominant_color text not null default '#1f2937', tags text[] not null default '{}', alt text,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);

create table if not exists public.engage_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id uuid not null,
  platform text not null check (platform in ('ios','android','web')),
  app_version text, app_build text, os_version text, device_model text,
  locale text, timezone text, country text,
  push_token_id uuid references public.push_tokens(id) on delete set null,
  push_permission text check (push_permission in ('granted','provisional','denied','not_determined')),
  channels_enabled jsonb not null default '{}'::jsonb,
  att_status text, client_features text[] not null default '{}',
  layouts text[] not null default '{}', actions text[] not null default '{}', placements text[] not null default '{}',
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  primary key (user_id, install_id)
);
create index if not exists engage_devices_last_seen_idx on public.engage_devices (last_seen_at desc);
create index if not exists engage_devices_platform_version_idx on public.engage_devices (platform, app_version);

create table if not exists public.engage_user_facts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_active_at timestamptz, sessions_7d int not null default 0,
  meals_logged_total int not null default 0, meals_logged_7d int not null default 0,
  checked_in_today boolean not null default false, current_streak int not null default 0, longest_streak int not null default 0,
  streak_at_risk boolean not null default false, water_logged_today boolean not null default false, workouts_7d int not null default 0,
  has_circle boolean not null default false, circle_count int not null default 0, in_circle_with_friend boolean not null default false,
  invites_sent_total int not null default 0, referral_qualified_count int not null default 0,
  sub_state text not null default 'free' check (sub_state in ('free','trial','pro','lapsed','grace','complimentary')),
  trial_ends_at timestamptz, pro_since timestamptz,
  fitzy_opened boolean not null default false, meals_ever int not null default 0, health_connected boolean not null default false,
  acq_channel text, acq_campaign_id text,
  computed_at timestamptz not null default now()
);

create table if not exists public.engage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id uuid,
  client_event_id text,                       -- idempotency from clients
  type text not null check (type in ('impression','click','dismiss','trigger_fired','push_opened','conversion','app_event','delivered')),
  name text,                                  -- app_event name (tracking-plan allowlist)
  campaign_id uuid, message_id uuid, variant_id text, send_id uuid,
  props jsonb not null default '{}'::jsonb,
  platform text, occurred_at timestamptz not null, received_at timestamptz not null default now()
);
create unique index if not exists engage_events_client_dedupe on public.engage_events (user_id, install_id, client_event_id) where client_event_id is not null;
create index if not exists engage_events_user_name_time on public.engage_events (user_id, name, occurred_at desc);
create index if not exists engage_events_campaign_time on public.engage_events (campaign_id, occurred_at) where campaign_id is not null;
create index if not exists engage_events_received on public.engage_events (received_at);

create table if not exists public.engage_exposures (
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null, message_id uuid not null, version int not null,
  variant_id text,                             -- null = control
  in_control boolean not null default false,
  first_at timestamptz not null default now(), impressions int not null default 0, last_impression_at timestamptz,
  primary key (user_id, message_id, version)
);
create index if not exists engage_exposures_campaign on public.engage_exposures (campaign_id, first_at);

create table if not exists public.engage_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null, message_id uuid not null, user_id uuid not null references public.profiles(id) on delete cascade,
  occurrence_key text not null,                -- '' one-off; 'YYYY-MM-DD' recurring; 'j:<entry_id>:<step>' journeys
  channel text not null check (channel in ('push','email','web_push')),
  variant_id text,
  status text not null default 'pending' check (status in ('pending','sent','suppressed','failed','skipped_control')),
  reason text,                                 -- quiet_hours | daily_cap | marketing_cap | consent | no_token | provider_error:<code> …
  retry_at timestamptz, attempts int not null default 0,
  provider_ids jsonb, notification_log_id uuid,
  created_at timestamptz not null default now(), sent_at timestamptz, updated_at timestamptz not null default now(),
  unique (campaign_id, message_id, user_id, occurrence_key)
);
create index if not exists engage_sends_user_channel_time on public.engage_sends (user_id, channel, sent_at desc);
create index if not exists engage_sends_retry on public.engage_sends (retry_at) where status = 'suppressed' and retry_at is not null;

create table if not exists public.engage_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null, dismissed_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create table if not exists public.engage_schedule (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.engage_campaigns(id) on delete cascade,
  message_id uuid not null references public.engage_messages(id) on delete cascade,
  occurrence_key text not null,
  run_at timestamptz not null,                 -- UTC; for local-time sends one row per tz bucket
  tz_bucket text,                              -- IANA tz or null
  cursor jsonb,                                -- {last_user_id, processed, enqueued}
  status text not null default 'due' check (status in ('due','running','done','cancelled','failed')),
  locked_until timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (message_id, occurrence_key, tz_bucket)
);
create index if not exists engage_schedule_due on public.engage_schedule (run_at) where status in ('due','running');

create table if not exists public.engage_journey_state (
  entry_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.engage_campaigns(id) on delete cascade,
  version int not null,
  step_id text not null, next_run_at timestamptz,
  entered_at timestamptz not null default now(), exited_at timestamptz, exit_reason text,
  context jsonb not null default '{}'::jsonb
);
create index if not exists engage_journey_due on public.engage_journey_state (next_run_at) where exited_at is null;
create unique index if not exists engage_journey_active_once on public.engage_journey_state (user_id, campaign_id) where exited_at is null;

create table if not exists public.engage_stats_daily (
  day date not null, campaign_id uuid not null, message_id uuid not null, variant_id text not null default '', platform text not null default '',
  sends int not null default 0, suppressed int not null default 0, failed int not null default 0,
  impressions int not null default 0, unique_viewers int not null default 0, clicks int not null default 0,
  dismissals int not null default 0, push_opens int not null default 0, conversions int not null default 0, exposed int not null default 0,
  revenue_net numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, campaign_id, message_id, variant_id, platform)
);

create table if not exists public.engage_audit_log (
  id bigint generated always as identity primary key,
  actor text not null, action text not null, entity text not null, entity_id text,
  before jsonb, after jsonb, at timestamptz not null default now()
);
create index if not exists engage_audit_entity on public.engage_audit_log (entity, entity_id, at desc);

create table if not exists public.engage_roles (
  email text primary key, role text not null check (role in ('viewer','editor','approver','admin')),
  updated_at timestamptz not null default now()
);

create table if not exists public.engage_settings (
  key text primary key, value jsonb not null, updated_by text, updated_at timestamptz not null default now()
);

-- Existing tables
alter table public.notification_preferences add column if not exists marketing_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists marketing_opt_in_at timestamptz;
alter table public.notification_preferences add column if not exists marketing_consent_version text;
alter table public.notification_preferences add column if not exists marketing_consent_source text;
alter table public.promo_user_state add column if not exists campaign_id uuid;
alter table public.promo_user_state add column if not exists variant_id text;
alter table public.campaigns add column if not exists platforms text[] not null default '{}';
alter table public.push_tokens add column if not exists invalidated_at timestamptz;
alter table public.push_tokens add column if not exists web_subscription jsonb;   -- {endpoint, keys:{p256dh, auth}}

-- Consent view (a view, not a function: allowed)
create or replace view public.engage_consent_v as
select p.id as user_id,
  coalesce(np.marketing_enabled, false) as marketing_push,
  ( coalesce((p.preferences->>'marketingEmails')::boolean, true)
    and not exists (select 1 from public.user_consent uc where uc.user_id = p.id and uc.consent_type = 'marketing' and uc.withdrawn_at is not null)
    and coalesce(ps.marketing_enabled, true)
    and not exists (select 1 from public.referral_email_optouts o where lower(o.email) = lower(p.email)) ) as marketing_email
from public.profiles p
left join public.notification_preferences np on np.user_id = p.id
left join public.privacy_settings ps on ps.user_id = p.id;

-- RLS on, no policies
alter table public.engage_campaigns enable row level security;
alter table public.engage_campaign_versions enable row level security;
alter table public.engage_messages enable row level security;
alter table public.engage_segments enable row level security;
alter table public.engage_segment_members enable row level security;
alter table public.engage_assets enable row level security;
alter table public.engage_devices enable row level security;
alter table public.engage_user_facts enable row level security;
alter table public.engage_events enable row level security;
alter table public.engage_exposures enable row level security;
alter table public.engage_sends enable row level security;
alter table public.engage_dismissals enable row level security;
alter table public.engage_schedule enable row level security;
alter table public.engage_journey_state enable row level security;
alter table public.engage_stats_daily enable row level security;
alter table public.engage_audit_log enable row level security;
alter table public.engage_roles enable row level security;
alter table public.engage_settings enable row level security;

-- Storage bucket (public, limited)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('engage-assets', 'engage-assets', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
```

- **Before writing it**, verify the exact column names of `user_consent`, `privacy_settings`, `referral_email_optouts`, `profiles.preferences`, `notification_preferences` and `push_tokens.id` on prod:
  ```sql
  select table_name, column_name from information_schema.columns
  where table_name in ('user_consent','privacy_settings','referral_email_optouts','notification_preferences','push_tokens')
  ```
  Adjust the view to match.
- **Tests:** `apps/web/app/lib/engage/__tests__/migration.test.ts` parses the file and asserts that there is no `create function`, `create trigger` or `language plpgsql`, that every `create table` is followed by `enable row level security`, and that the file is idempotent (applying it twice to a local pg succeeds when Docker is available).
- **Done when:**
  1. Applied on **staging/local** twice without error.
  2. **Prod apply is a separate gated step (§18.R2):** apply alone, then `insert into supabase_migrations.schema_migrations(version,name) values ('118','engage')`.
- **Depends on:** E0b.06.

### E1.02: Adapter interfaces (`packages/server/src/adapters.ts`)
```ts
export interface EngageAppAdapters {
  appId: 'fitcircle' | 'buyforbaby' | 'tripwiz' | string;
  db: SqlExecutor;                         // (sql: string, params: unknown[]) => Promise<{ rows: any[] }>, service role
  users: UserFactsAdapter;
  push: PushSender;
  webPush?: WebPushSender;
  email: EmailSender;
  consent: ConsentAdapter;
  screens: ScreensRegistry;
  theme: ThemeProvider;
  adminAuth: AdminAuth;
  experiments?: ExperimentBucketer;        // FitCircle: wraps lib/experiments/bucket
  clock?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}
export interface UserFactsAdapter {
  /** SQL fragments per field (spec §5.2) so the compiler can generate one query. */
  fields: Record<string, FieldDef>;        // { sql: 'f.current_streak', type: 'int'|'bool'|'text'|'version'|'timestamp'|'text[]', source: 'facts'|'profile'|'device'|'consent'|'custom' }
  baseFrom: string;                        // 'public.profiles p left join public.engage_user_facts f on f.user_id = p.id'
  excludeTestUsersSql: string;             // FitCircle: reuse lib/ads/test-users.ts predicates
  refreshFacts(opts: { userIds?: string[]; since?: Date }): Promise<{ updated: number }>;
  personalization(userId: string): Promise<Record<string, string | number | null>>; // first_name, streak, circle_name, …
}
export interface PushSender {             // MUST enforce the app's own caps/quiet hours
  send(input: { userId: string; category: 'marketing'|'lifecycle'|'transactional'; title: string; body: string;
    subtitle?: string; data: EngagePushData; imageUrl?: string; interruptionLevel?: 'passive'|'active';
    androidChannel?: string; collapseKey?: string; ttlSeconds?: number; dedupeKey: string; platforms?: Array<'ios'|'android'> }):
    Promise<{ status: 'sent'|'suppressed'|'failed'; reason?: string; retryAt?: Date; notificationLogId?: string; providerIds?: Record<string,string> }>;
}
export interface WebPushSender { send(input: { userId: string; title: string; body: string; url: string; icon?: string; image?: string; tag?: string; dedupeKey: string }): Promise<{ status: 'sent'|'suppressed'|'failed'; reason?: string }>; }
export interface EmailSender { send(input: { userId: string; to: string; subject: string; preheader?: string; html: string; text: string; unsubscribeUrl: string; dedupeKey: string; category: 'marketing'|'lifecycle'|'transactional' }): Promise<{ status: 'sent'|'suppressed'|'failed'; reason?: string; providerId?: string }>; }
export interface ConsentAdapter { marketingPush(userIds: string[]): Promise<Set<string>>; marketingEmail(userIds: string[]): Promise<Set<string>>; categoryEnabled(userIds: string[], category: string): Promise<Set<string>>; unsubscribeEmail(userId: string, source: string): Promise<void>; }
export interface ScreensRegistry { screens: Array<{ id: string; label: string; params?: Record<string, 'string'|'uuid'|'int'> }>; urlHostsAllowlist: string[]; experienceTemplates: Array<'seasonal_circle'|'daily_calendar'|'spotlight'|string>; placements: Array<{ id: string; label: string; maxShown: number; layouts: string[] }>; }
export interface ThemeProvider { tokens(): ThemeTokens; icons(): string[]; fonts(): { ios: string; android: string; web: string }; }
export interface AdminAuth { resolve(req: Request): Promise<{ actor: string; role: 'viewer'|'editor'|'approver'|'admin' } | null>; }
```
- **Done when:** the interfaces are exported from `@inov8r/engage-server`, with JSDoc on every member and a `fakeAdapters()` test helper in `packages/server/src/testing.ts`.

### E1.03: Segment compiler (`packages/server/src/segments/compile.ts`)
- **Signature:**
  ```ts
  compileAudience(audience, adapters.users.fields, { limitUserIds?, afterUserId?, pageSize?, countOnly? })
    → { sql: string, params: unknown[] }
  ```
- **Rules:**
  - Fully parameterized (`$1…`). Field SQL comes **only** from the adapter's registry, never from user input. Unknown field → `SegmentError('UNKNOWN_FIELD')`.
  - Operators (spec §5.1): `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between`, `exists`, `not_exists`, `contains` (for `text[]`: `= any(...)`), `version_gte` / `version_lt` / `version_between`, `within_last` / `not_within_last` (an ISO 8601 duration such as `P7D`, as `col >= now() - $n::interval`), and `count_gte` / `count_lte`.
  - **Version comparison** uses `string_to_array(regexp_replace(v,'[^0-9.]','','g'),'.')::int[]` compared as arrays. This is an expression, not a function. Covered by tests for `1.10.0 > 1.9.9` and `1.1 = 1.1.0`.
  - **Device fields** support `scope: 'any_device' | 'latest_device'` (default `latest_device`):
    - `latest_device` uses a lateral join: `left join lateral (select * from engage_devices d where d.user_id = p.id order by last_seen_at desc limit 1) d on true`;
    - `any_device` uses `exists (select 1 from engage_devices d where d.user_id = p.id and <cond>)`.
  - **Event counts:** `count_gte {event, window, filters}` becomes
    ```sql
    (select count(*) from engage_events e
     where e.user_id = p.id and e.name = $x and e.occurred_at >= now() - $w::interval [and e.props @> $f::jsonb]) >= $n
    ```
  - **Engage history:** `received(campaign)` → `exists engage_sends(status='sent')`; `clicked(campaign)` → `exists engage_events(type='click')`; `converted`; `in_control` → `engage_exposures.in_control`.
  - `random_bucket` is computed as `('x' || substr(md5($salt || p.id::text), 1, 8))::bit(32)::int & 2147483647 % 100`. It must equal the TS `bucket(userId, salt)` from `lib/experiments/bucket.ts`; a parity test covers it.
  - **Test-user exclusion** is always ANDed unless `{ includeTestUsers: true }` (test mode).
  - **Paging** is by keyset: `where p.id > $after order by p.id limit $page`.
- **Tests:**
  - `packages/server/src/segments/__tests__/compile.test.ts`: a snapshot of the SQL for every operator, plus injection attempts (field names, values).
  - `…/compile.pg.test.ts`: runs against a local Postgres (Docker or `pg-mem` fallback) with seeded rows. For every operator, the expected user set must match.
- **Done when:** all operators are covered, and estimating a 100k-user synthetic dataset takes under 2 s locally.

### E1.04: FitCircle field registry (`FitCircleBE apps/web/app/lib/engage-adapter/fields.ts`)
- Map **every** field in spec §5.2 to SQL. Examples:

  | Field | SQL |
  |---|---|
  | `platform` | `d.platform` (device) |
  | `app_version` | `d.app_version` (version) |
  | `days_since_signup` | `(current_date - p.created_at::date)` |
  | `sub_state` | `f.sub_state` |
  | `current_streak` | `f.current_streak` |
  | `country` | `coalesce(d.country, p.country_code)` |
  | `acq_channel` | `f.acq_channel` |
  | `marketing_push_opt_in` | `c.marketing_push` (joining `engage_consent_v c`) |
  | `experience_joined:<campaign>` | `exists (select 1 from campaign_participants cp where cp.user_id = p.id and cp.campaign_id = $x)` |
  | `experiment_arm:<key>` | `exists (select 1 from experiment_assignments ea join experiments ex on ex.id = ea.experiment_id where ea.user_id = p.id and ex.key = $k and ea.arm = $a)` |

  **Check every referenced column on prod before coding.**
- **Done when:** each field has a pg test with a seeded positive and negative user.

### E1.05: Facts refresh (`FitCircleBE lib/engage-adapter/facts.ts` + `apps/web/app/api/cron/engage-facts/route.ts`)
- **Behaviour:**
  - An **incremental** run every 5 minutes for users with `engage_devices.last_seen_at > now() - interval '24 hours'` or with domain activity since the last run.
  - A **full** run nightly at 03:15 UTC.
- **Implementation:** set-based `insert … select … on conflict (user_id) do update`. Each fact comes from its domain tables:
  - meals from the food log entries table;
  - streak from `profiles.current_streak` / `longest_streak`;
  - `streak_at_risk` using the same rule as `home-feed/context.ts`;
  - circles from membership tables;
  - `sub_state` from `profiles.subscription_*` plus `complimentary_grants` plus trial columns (migration 112);
  - acquisition from `user_attribution`.

  **Reuse the existing helpers** instead of duplicating rules: import the predicates from `lib/home-feed/context.ts` and `lib/promos/journey-context.ts` where they are pure.
- **`vercel.json` crons:**
  ```json
  { "path": "/api/cron/engage-facts", "schedule": "*/5 * * * *" }
  { "path": "/api/cron/engage-facts?full=1", "schedule": "15 3 * * *" }
  ```
- **Auth:** `Authorization: Bearer ${CRON_SECRET}`. **Kill switch:** `ENGAGE_ENABLED` (when false, return `{ skipped: true }`).
- **Tests:** `lib/engage-adapter/__tests__/facts.test.ts` for every fact on seeded data, plus a parity test showing `streak_at_risk` equals the home feed's value for the same fixture.
- **Done when:** a dry run on prod (`?dryRun=1`, which returns counts only) matches ad-hoc SQL for `meals_logged_7d` and `sub_state` across all users.

### E1.06: Engine core modules (`packages/server/src/`)

| File | Exports / responsibility |
|---|---|
| `schema.ts` | Zod validators generated from the protocol, plus a `launchCheck(campaign, messages, adapters)` that returns `{ ok, errors[] }`. Errors cover spec §3.3: per-platform content or fallback, token defaults, allowlisted screens and hosts, image sizes, consent rules, `max_audience` present, dry run within the last 24 h, and the type-to-confirm requirement flag. |
| `assignment.ts` | `assignVariant(userId, message, salt?)` returns a variant or `CONTROL`. Delegates to `adapters.experiments` when present, otherwise `sha256(userId:messageId) % 100` (v1 logic, ported from `feat/engage` `lib/engage/assignment.ts`). |
| `render.ts` | `renderContent(content, vars, { abortIfMissing })` for Liquid-subset `{{name \| default: "x"}}` tokens. HTML-escapes for email, leaves plain text for push. Throws `AbortMessage` when a required variable is missing. |
| `eligibility.ts` | `eligibleForUser(userId, ctx)` returns the in-app messages and placement cards for the sync response. Applies status, schedule, platform, the cached audience match (5 min), dismissals, max impressions, minimum hours, control, platform overrides, capability filtering and fallback. |
| `caps.ts` | Global cap evaluation for push, email, in-app and marketing (spec §10.2). Counts come from `engage_sends` per **local calendar day** using `profiles.timezone` (fallback `America/New_York`). |
| `localtime.ts` | Timezone bucketing for local-time sends; `nextWindow(tz, hh:mm)`. |
| `audit.ts` | `audit(actor, action, entity, id, before, after)`. |
| `errors.ts` | Typed errors mapped to HTTP status in the route factories. |
| `routes/*.ts` | `createMobileHandlers(adapters)` and `createAdminHandlers(adapters)`. Each returns `{ GET, POST, PATCH, DELETE }` keyed by path, using Web `Request`/`Response` only. |

**Port from v1** (read from the worktree `/Users/ani/Code/FitCircle/FitCircleBE-engage`), then adapt:

| v1 file | Target | Changes |
|---|---|---|
| `apps/web/app/lib/engage/assignment.ts` | `packages/server/src/assignment.ts` | Delegate to the adapter bucketer |
| `apps/web/app/lib/engage/schema.ts` (`launchCheck`) | `schema.ts` | Expand to the v2 checklist |
| `apps/web/app/lib/engage/render.ts` | `render.ts` | Add `abort_if_missing`, escaping |
| `apps/web/app/lib/engage/policy.ts` | `caps.ts` + `eligibility.ts` | Time-bounded queries (fixes B6) |
| `apps/web/app/lib/engage/attributes.ts` | **Discard** | Replaced by the SQL compiler (B4) |
| `apps/web/app/lib/services/engage-asset-service.ts` | `packages/server/src/assets.ts` | Storage via `adapters.storage` (Supabase Storage); SQL `usage` |
| `apps/web/app/lib/engage/client/asset-pipeline.ts` | `packages/preview/src/asset-pipeline.ts` | Used by the tool upload UI |
| `apps/web/app/lib/services/engage-delivery-service.ts` | `eligibility.ts` + `routes/sync.ts` | Remove `heroCampaignSlug`; feed cards go to the home feed (E2) |
| `apps/web/app/lib/services/engage-send-service.ts` | **Rewrite** as `dispatcher/*` (E3) | Ledger state machine (B1) |
| `apps/web/app/lib/services/engage-stats-service.ts` | **Rewrite** as `stats/*` (E8) | SQL rollups (B5) |
| `apps/web/app/lib/engage/stats.ts` (significance) | `stats/significance.ts` | Keep the math; add confidence intervals |
| Tests `engage.test.ts`, `routes.test.ts`, `preview/*`, `client/*` | Matching `__tests__` | Port the cases that still apply |

- **Done when:** the module tests pass, and coverage on `schema`, `assignment`, `render`, `eligibility` and `caps` is ≥ 90% (`vitest --coverage`).

### E1.07: Device session endpoint
- **Route:** `POST {mobilePrefix}/session`, mounted in FitCircleBE at `apps/web/app/api/mobile/engage/session/route.ts`:
  ```ts
  import { handlers } from '@/app/lib/engage-adapter/handlers';
  export const POST = handlers.mobile.session;
  ```
- **Request** (`session-request.v1.json`):
  ```json
  { "installId":"8f5c…uuid", "platform":"ios", "appVersion":"1.2.0", "appBuild":"80", "osVersion":"27.1", "deviceModel":"iPhone18,3",
    "locale":"en-CA", "timezone":"America/Toronto", "pushPermission":"granted", "pushToken":"…optional…",
    "channelsEnabled":{"marketing":true,"social":true}, "attStatus":"authorized",
    "clientFeatures":["icon_keys","engage@1"], "layouts":["modal@1","slideup@1","fullscreen@1","sheet@1"],
    "actions":["open_screen@1","paywall@1","invite@1","open_url@1","dismiss@1"], "placements":["circles_top","profile_top","post_checkin","food_log_top","fitzy_top"] }
  ```
- **Behaviour:**
  1. Authenticate with the existing mobile auth helper (`getMobileUser(request)`, the same one the other `/api/mobile` routes use).
  2. Upsert `engage_devices` on `(user_id, install_id)`. `country` comes from `x-vercel-ip-country`.
  3. Link `push_token_id` by looking up the `push_tokens` row for that token.
  4. Update `profiles.last_active_at = now()`, throttled to once per 15 minutes per user.
  5. Return `204` with `Cache-Control: no-store`.
- **Rate limit:** 1 per 60 s per install, through the existing rate-limit helper if one exists; otherwise an in-memory LRU guard is acceptable.
- **Tests:** `routes/__tests__/session.test.ts` covers validation, upsert, country from the header, the throttle, and 401 when unauthenticated.

### E1.08: Admin auth, roles and audit (FitCircle adapter)
- **`lib/engage-adapter/admin-auth.ts`:**
  - Accept `Authorization: Bearer ${FITCIRCLE_ADMIN_API_SECRET}` together with `X-Admin-Actor: <email>`, which is how Admin Tools calls today.
  - Look up the role in `engage_roles`. **Bootstrap:** if `engage_roles` is empty, an actor whose profile has `is_admin` is treated as `admin`.
  - Also accept a cookie session from a user with `profiles.is_admin`, for local testing.
- **Role enforcement matrix**, used by the admin route factory:

  | Action | Minimum role |
  |---|---|
  | List and view | `viewer` |
  | Create and edit drafts, segments, assets, test sends | `editor` |
  | Launch, pause, resume, archive | `editor` (approvals are off) |
  | `respect_global_caps=false`, `transactional` category, settings, roles | `admin` |

- **Done when:** the route tests assert a 403 for every under-privileged action.

### E1.09: Retention crons
- **`/api/cron/engage-retention`:** daily at 04:10 UTC.
  - Delete `engage_events` older than 90 days, in batches of 10k (`delete … where id in (select id … limit 10000)`, looping until fewer than 10k rows remain or 250 s pass).
  - Delete `engage_sends` older than 400 days.
  - Delete `home_feed_decisions` and `home_feed_events` older than 90 days (fixes G6).
- **Tests:** batch looping, and the time budget stopping the loop.

### E1.10: Settings
- **`engage_settings` keys:**

  | Key | Default |
  |---|---|
  | `caps` | `{ push_daily: 3, marketing_push_daily: 1, marketing_push_weekly: 2, iam_session: 1, iam_daily: 2, iam_min_interval_s: 30, email_marketing_weekly: 2 }` |
  | `quiet_hours_default` | `{ start: "21:00", end: "08:00" }` |
  | `approval_threshold` | `null` |
  | `global_control_pct` | `0` |
  | `type_to_confirm_threshold` | `5000` |
  | `test_devices` | `[]` |

- **Read path:** cached in memory for 60 s. Env vars override where they exist (`ENGAGE_IAM_MIN_INTERVAL_S` and so on).

---

## 6. E2: delivery surfaces (6 days)

### E2.01: Engage card source in the home feed (FitCircleBE)
- **Files:**
  - `apps/web/app/lib/home-feed/candidates.ts`: add `engageCandidates(ctx)`.
  - `apps/web/app/lib/home-feed/catalog.ts`: register card type `promo` version `2` in the same `promo` category.
  - `apps/web/app/lib/home-feed/compose.ts`: merge the Engage candidates **before** ranking.
  - `apps/web/app/lib/services/home-feed-service.ts`: load the Engage `feed` messages through the engine's `eligibleForUser(... surface:'feed')`, within the 250 ms budget (with a 120 ms internal timeout; on timeout, skip the Engage cards and record the trace `engage_timeout`).
- **Rules:**
  1. A candidate is `{ id: 'promo:eng_<messageId>', type: 'promo', version: client supports 2 ? 2 : 1, props, priority, slotHint }`.
  2. `slot_hint` maps to the existing ranker hints: `top` = position right after the header, `upper` = within the first 4, `any` = normal.
  3. **The guardrails in `guardrails.ts` stay authoritative.** At most 2 promo-category cards, at most 1 in the first 4, none adjacent. If a guardrail drops an Engage card, record `dropped_by_guardrail` in `home_feed_decisions.applied_rules`.
  4. **Exposure:** when an Engage card is placed, upsert `engage_exposures` (bulk, once per decision).
  5. **Impressions and taps:** clients already post `home_feed_events` with `promo_key`/`creative_id`. **Also** write `engage_events` when `promo_key` starts with `eng_`. This is done server-side in `api/mobile/home-feed/events`, so no client change is needed for analytics.
- **Tests:** `home-feed/__tests__/engage-source.test.ts` covers:
  - guardrail interaction (an Engage card never breaks density);
  - timeout fallback;
  - version selection (`cards=promo@1` gets v1, or the fallback when it can't down-convert);
  - exposure written once.

### E2.02: The `promo@2` card
- **Schema:** `protocol/schemas/promo-card.v2.json` is the promo@1 props **plus** these fields:
  - `layout` gains `captioned_image`, `image_only` and `carousel`;
  - `items[]` for carousel (2–5 items, each with `image`, `title≤40`, `action`);
  - `countdown.hide_after`;
  - `footnote`;
  - `engage: { campaignId, messageId, variantId }`.
- **Down-conversion to promo@1** (`packages/server/src/feed/downconvert.ts`):
  - `captioned_image` → `banner` with the image;
  - `image_only` → `hero` with an empty body (only if the title exists; otherwise skip);
  - `carousel` → `hero` using the first item;
  - unknown actions → that action's fallback chain (`lib/promos/actions.ts`), else skip the button, else skip the card.
- **Tests:** `downconvert.test.ts` over the fixtures `v2-*.json` produces `v1-downconverted.json`.

### E2.03: `GET {mobilePrefix}/sync`
- **Mount:** `apps/web/app/api/mobile/engage/sync/route.ts`.
- **Request headers:**
  - `Authorization`;
  - `X-App-Platform`, `X-App-Version`, `X-App-Build` (already sent globally by iOS `AppClientHeaders` and Android `ClientInfoInterceptor`);
  - `X-Client-Features: icon_keys,engage@1`;
  - `X-Engage-Layouts: modal@1,slideup@1,fullscreen@1,sheet@1,banner@1,card@1`;
  - `X-Engage-Actions: …`;
  - `X-Engage-Placements: circles_top,profile_top,post_checkin,food_log_top,fitzy_top`.
- **Response 200** (`sync-response.v1.json`):
  ```json
  {
    "schema": 1, "fetched_at": "2026-11-20T15:04:05Z", "ttl_seconds": 900,
    "in_app": [{
      "campaign_id": "…", "message_id": "…", "variant_id": "a", "version": 3,
      "layout": "modal", "content": { "title": "…", "body": "…", "primary": { "label": "Try it", "action": { "type": "open_screen", "screen": "fitzy" } }, "dismissible": true, "theme": "fitzy" },
      "trigger": { "event": "meal_logged", "filters": { "count_today": { "gte": 2 } }, "delay_ms": 1500 },
      "priority": 70, "expires_at": "2026-11-27T05:00:00Z",
      "frequency": { "max_per_user": 1, "min_hours_between": 0, "max_per_session": 1 }
    }],
    "placements": { "circles_top": [{ "campaign_id": "…", "message_id": "…", "variant_id": "b", "layout": "banner", "content": { … }, "priority": 40, "dismissible": true, "expires_at": null }] },
    "prefetch": [{ "url": "…", "variants": [{ "width": 480, "url": "…", "format": "webp" }], "width": 1440, "height": 810, "dominantColor": "#1f2937" }],
    "caps": { "iam_daily": 2, "iam_min_interval_s": 30, "iam_session": 1 },
    "control": ["<message_id>", "…"]
  }
  ```
- **Behaviour:**
  - Personalization is rendered on the server, except client tokens such as `{{plan_price:…}}`.
  - Every exposure (including control) is upserted in **one** bulk statement.
  - The response is `Cache-Control: no-store`.
  - **p95 < 250 ms:**
    - cache each user's audience-match results for 5 minutes in memory, keyed by user and campaign version;
    - precompute the per-campaign "candidate" list every minute (live campaigns only);
    - evaluate audiences with one compiled query per request: `where p.id = $user and (<aud1>) as c1, (<aud2>) as c2 …` as a single SELECT returning booleans.
- **Tests:** `routes/__tests__/sync.test.ts` covers:
  - capability filtering (an undeclared layout gets the fallback or is skipped);
  - the control list;
  - expiry;
  - dismissal suppression;
  - platform overrides;
  - locale fallback;
  - `no-store`;
  - a 401.

  Also a performance test: 50 live campaigns at 100k seeded users, p95 under 250 ms locally.

### E2.04: `POST {mobilePrefix}/events`
- **Request:** `{ "events": [ { "client_event_id": "uuid", "type": "impression", "campaign_id": "…", "message_id": "…", "variant_id": "a", "send_id": null, "name": null, "props": {}, "occurred_at": "…" } ] }`, with at most 50 events.
- **Validation:**
  - `type` must be in the enum.
  - App event `name` must be in the tracking-plan allowlist (`packages/server/src/events/allowlist.ts`, generated from FitCircleBE `analytics/tracking-plan.json`, version ≥ 17, at build time).
  - `occurred_at` is clamped to now ± 24 h; events older than 7 days are dropped.
- **Anti-spoofing (fixes B2):** `impression`/`click`/`dismiss` are accepted only if:
  - an `engage_exposures` row exists for (user, message) and the variant matches, **or**
  - for push events, the `send_id` belongs to this user.

  Otherwise the event is dropped silently (still 202) and the counter `engage_events_rejected{reason}` is logged.
- **Side effects:**
  - `dismiss` on a card upserts `engage_dismissals`;
  - `impression` increments `engage_exposures.impressions` and sets `last_impression_at`;
  - `push_opened` sets `notification_log.opened_at` for `send.notification_log_id`;
  - `app_event`: if any live campaign is `triggered` on this event (server-side push or email), the dispatcher enqueues a job (E3.04);
  - journey entry and exit checks (E9).
- **Response:** `202 { "accepted": n }`.
- **Tests:** idempotency (same `client_event_id`), the anti-spoof cases, clamping, the allowlist, and every side effect.

### E2.05: Capability negotiation and the compatibility report
- **`packages/server/src/compat.ts`:**
  - `supports(device, message)` returns `native | fallback | skip`.
  - `compatReport(campaignId)` aggregates `engage_devices` (last seen ≤ 30 days) by `platform × app_version`, giving the counts and the outcome per message.
- **Admin endpoint:** `GET /campaigns/:id/compat` returns `{ rows: [{ platform, app_version, devices, outcome: { "<message_id>": "native"|"fallback"|"skip" } }] }`.

### E2.06: Contract replay tests against shipped clients
- **Fixtures:** in `FitCircleBE apps/web/app/lib/engage-adapter/__tests__/shipped-clients/`, capture the **exact request headers and query strings** that these clients send to `/api/mobile/home-feed`:
  - iOS 1.0.9 (b71), iOS 1.1.0 (b75);
  - Android vc36, Android vc40.

  Take them from the client code at those tags, or from Vercel logs.
- **Asserts:**
  1. The response for those clients contains **no** `promo@2` card.
  2. Any promo card is valid promo@1.
  3. Push payloads sent to those builds use only keys those builds already handle (Android `ALLOWED_DATA_KEYS` at vc40: `type, circleId, challengeId, entryId, questId, streakId, messageId, screen, campaignSlug, fitzyTip, mealType`).
- **Done when:** these tests run in CI. Breaking them blocks the merge.

---

## 7. E3: send pipeline (6 days)

### E3.01: Dispatcher cron (`/api/cron/engage-dispatch`, every minute)
- **`vercel.json`:** `{ "path": "/api/cron/engage-dispatch", "schedule": "* * * * *" }` (`maxDuration` 300; exits at 250 s).
- **Algorithm** (`packages/server/src/dispatcher/run.ts`):
  1. **Planning** (new campaigns):
     - For every campaign with status `scheduled` and `schedule.send_at <= now() + 5 min`, create the `engage_schedule` rows:
       - **one-off:** one row with `run_at = send_at` and `occurrence_key = ''`;
       - **local time:** one row per **distinct `timezone`** among the audience, computed with `select distinct coalesce(p.timezone,'America/New_York')` from the compiled audience. `run_at` is that timezone's local `HH:MM` converted to UTC, and `tz_bucket` is the timezone;
       - **recurring:** expand the RRULE to the next 2 occurrences, with `occurrence_key = local date`.
     - Then set the status to `live`.
  2. **Claim:**
     ```sql
     update engage_schedule set status='running', locked_until = now() + interval '5 minutes'
     where id in (select id from engage_schedule where status in ('due','running') and run_at <= now() and (locked_until is null or locked_until < now()) order by run_at limit 5 for update skip locked)
     returning *
     ```
  3. **Process each claimed row** in pages of 1,000 users, using keyset paging from `cursor.last_user_id`:
     1. Compile the audience, plus `tz_bucket` when set, plus "no existing `engage_sends` row for (message, occurrence)".
     2. Assign variant or control. **Control** inserts an `engage_sends` row with status `skipped_control` and writes the exposure.
     3. **Consent** (`adapters.consent.*` bulk). If it fails, insert status `suppressed` with reason `consent` and no retry.
     4. **Caps** (`caps.ts` bulk). On failure, insert `suppressed` with reason `daily_cap|marketing_cap` and `retry_at = start of the next local day + jitter`, but only if the campaign sets `retry_suppressed` (the default for scheduled sends) and `retry_at < end_at`.
     5. **Insert** status `pending` (`on conflict do nothing`). Only the rows actually inserted continue, which is the idempotency guarantee.
     6. **Render** per user, with `AbortMessage` giving status `skipped` and reason `abort`.
     7. **Send** through the adapter (push, web push or email), at a rate of at most `ENGAGE_PUSH_RATE_PER_MIN` (default 2,000) per run, shared across rows.
     8. **Update the ledger** from the adapter result:
        - `sent` → `sent_at`, `notification_log_id`, `provider_ids`;
        - `suppressed` with reason `quiet_hours` → `retry_at` from the adapter, plus ±20 min jitter;
        - `failed` → `attempts++`. Retry up to 3 times with backoff of 5, 30 and 120 minutes, unless the reason is a permanent token error.
     9. **Save the cursor** after each page. Stop at 250 s.
     10. When a page returns fewer than 1,000 rows, set `status='done'`.
  4. **Retries:** claim `engage_sends` rows where `status='suppressed' and retry_at <= now()` (limit 2,000), then re-check consent and caps and resend. The `occurrence_key` stays the same.
  5. **Journeys:** advance `engage_journey_state` where `next_run_at <= now()` (E9.02).
- **Kill switches:** `ENGAGE_ENABLED`, `ENGAGE_SENDS_ENABLED`, and per campaign (`status='paused'` stops processing at the next page boundary).
- **Tests** (`dispatcher/__tests__/*.test.ts`, with a fake adapter and a pg fixture):
  1. Idempotency: running twice sends once.
  2. Quiet-hours suppression gets `retry_at`, and the retry sends. **This regression test is required for B1.**
  3. Consent suppression is never retried.
  4. Control rows are skipped and exposures written.
  5. Local-time buckets send at the right UTC times for `America/Toronto`, `Asia/Kolkata` and `Europe/London`, including a DST transition date.
  6. Paging resumes from the cursor after a simulated timeout.
  7. Rate limiting.
  8. Pausing mid-run stops at the next page.
  9. `max_audience` is enforced: launch is rejected if the estimate exceeds it, and the run stops at `max_audience` sends.
- **Load test:** `dispatcher/__tests__/load.pg.test.ts` with 100k seeded users and a mock adapter at about 2 ms each. The broadcast must complete within the §15 target (100k in under 60 min at the default rate). Assert no duplicates.

### E3.02: Orchestrator integration (FitCircle `PushSender`)
- **File:** `apps/web/app/lib/engage-adapter/push.ts` implements `PushSender` by calling `NotificationOrchestrator.send(userId, type, data)`.
- **Changes to `notification-orchestrator.ts`:**
  1. Add `NotificationType` values `engage_marketing`, `engage_lifecycle` and `engage_transactional`.
     - Templates take free-form `data.title`/`data.body` (like the `campaign` type) and strip emoji.
     - Their categories map to:

       | Type | Category | Daily cap | Extra checks |
       |---|---|---|---|
       | `engage_marketing` | `marketing` (new) | Counts toward the daily cap | Requires `notification_preferences.marketing_enabled`; also the weekly marketing cap from `engage_settings.caps` |
       | `engage_lifecycle` | Per message (`journey`, `momentum`, `coach`, `circle`, `challenge`, `social` or `celebration`), honouring the existing toggles | Counts toward the daily cap | |
       | `engage_transactional` | Cap-exempt (added to `CAP_EXEMPT_TYPES`) | Exempt | Still respects quiet hours, **except** for account or security messages |

  2. **Return a structured result.** `send` currently resolves without a reason. Extend it (backwards compatible) to return `{ status, reason, retryAt?, notificationLogId? }`. Existing callers ignore the return value.
  3. **Push payload additions:** `engageSendId`, `engageCampaignId`, `variantId`, `params` (JSON string), and `buttons` (iOS category id). `image_url` already exists.
  4. **iOS:** `interruption-level` from `push_rules` (marketing never `time-sensitive`). **Android:** `android_channel` from `push_rules`, with defaults `marketing` → channel `marketing` and lifecycle → the existing category channel.
- **Tests:** extend `notification-orchestrator` tests to cover the marketing consent block, the weekly cap, the exemption, the structured return, the payload keys, and **no regression** in existing types (the existing suite must pass unchanged).

### E3.03: Token hygiene
- **In `push-service.ts`:**
  - APNs `410` or `BadDeviceToken`, or FCM `UNREGISTERED`/`INVALID_ARGUMENT` for the token, sets `push_tokens.is_active=false` and `invalidated_at=now()`.
  - A nightly cron (inside `engage-retention`) deactivates tokens with `last_used_at < now() - 270 days`.
- **Tests:** each provider error code maps to the right action.

### E3.04: Triggered push and email
- When `/events` ingests an `app_event` and a live `triggered` campaign matches (event plus filters plus audience), insert an `engage_schedule` row with:
  - `run_at = occurred_at + trigger.delay_seconds`;
  - `occurrence_key = 't:<client_event_id>'`.
- The dispatcher handles it at the next run (a ≤ 60 s delay is acceptable).
- **Re-eligibility:** use `frequency.reeligible_after_hours` against previous `engage_sends` for the campaign.
- **Tests:** trigger → send within the next tick, the re-eligibility window, and filters.

### E3.05: Email through Resend
- **`lib/engage-adapter/email.ts`** reuses the existing Resend client and the referral/campaign shell template. Add a template `shell_v1` that takes `{ preheader, title, bodyHtml, ctaLabel, ctaUrl, footerAddress }`.
- **Unsubscribe:**
  - an HMAC token at `/api/campaigns/unsubscribe?t=` (reuse the existing route), plus the `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers;
  - unsubscribing writes **all four** consent stores (spec §10.1) through `ConsentAdapter.unsubscribeEmail`.
- **CAN-SPAM:** a physical address in the footer, from `ENGAGE_EMAIL_POSTAL_ADDRESS`. **Human step:** the owner provides the address.
- **Rate:** `ENGAGE_EMAIL_RATE_PER_MIN` (default 200).
- **Tests:** HTML and text rendering, the unsubscribe token round-trip, the four stores updated, and the rate limit.

### E3.06: Web push sender (FitCircleBE)
- **Dependency:** `web-push` (npm) in FitCircleBE, or a minimal VAPID JWT plus aes128gcm implementation in `@inov8r/engage-adapters/webpush` if the dependency is unwanted. Recommended: `web-push`.
- **Env vars:**
  - `ENGAGE_VAPID_PUBLIC_KEY` (also exposed as `NEXT_PUBLIC_ENGAGE_VAPID_PUBLIC_KEY`);
  - `ENGAGE_VAPID_PRIVATE_KEY`;
  - `ENGAGE_VAPID_SUBJECT=mailto:team@fitcircle.ai`.

  Generate them with `npx web-push generate-vapid-keys`; **pipe straight into `vercel env add`, never print**.
- **Adapter:** `lib/engage-adapter/webpush.ts` sends to every `push_tokens` row with `platform='web'`, `is_active=true` and a non-null `web_subscription`. The payload is
  ```json
  { "title", "body", "url", "icon": "/icons/icon-192.png", "image"?, "tag", "data": { "engageSendId", "engageCampaignId" } }
  ```
  - `404`/`410` → deactivate the token.
  - Consent and caps are applied by the dispatcher **and** by a thin web wrapper. Web push has no orchestrator path today, so add `WebPushOrchestrator.send` that reuses `notification_preferences` quiet hours, the marketing consent and the daily cap counting (`notification_log` with `channel='web'`).
- **Tests:** VAPID headers present, deactivation on 404/410, consent and cap enforcement.

---

## 8. E4: the tool (`inov8r-admin` + `engage.inov8rlabs.com`) (9–10 days)

### E4.01: App registry and module (`lib/apps/registry.ts`, `lib/apps/modules.ts`)
- Add `'engage'` to the `ModuleId` union.
- Add `engage` to FitCircle's `modules` list in `registry.ts`.
- **Whitelist** in `modules.ts`: method plus path regex, with no catch-alls:
  ```
  GET    /api/admin/engage/overview
  GET    /api/admin/engage/campaigns                 POST /api/admin/engage/campaigns
  GET    /api/admin/engage/campaigns/:id             PATCH /api/admin/engage/campaigns/:id
  POST   /api/admin/engage/campaigns/:id/(launch|pause|resume|archive|duplicate|dry-run|test-send|submit|approve|reject)
  GET    /api/admin/engage/campaigns/:id/(preview|stats|compat|versions)
  GET    /api/admin/engage/segments                  POST /api/admin/engage/segments
  GET|PATCH /api/admin/engage/segments/:id           POST /api/admin/engage/segments/estimate
  GET    /api/admin/engage/segments/:id/sample
  GET    /api/admin/engage/assets                    POST /api/admin/engage/assets (multipart ≤ 4.5 MB)  PATCH /api/admin/engage/assets/:id
  GET    /api/admin/engage/feed-rules                POST|PATCH /api/admin/engage/feed-rules(/:key)?   GET /api/admin/engage/feed/preview
  GET    /api/admin/engage/(placements|events/catalog|screens|theme|settings|audit|roles)
  PATCH  /api/admin/engage/(settings|roles)
  POST   /api/admin/engage/experiences/:id/(art|app-store-sync|app-store-submit)
  ```
- **Tests:** update `tests/lib/apps/modules.test.ts`, which pins the list. Add positive and negative cases for every route, and for a path-traversal attempt.

### E4.02: The `engage.inov8rlabs.com` host
- **`middleware.ts`:**
  - When `host === 'engage.inov8rlabs.com'`, rewrite `/` to `/apps/<lastAppId or 'fitcircle'>/engage` and `/<appId>/...` to `/apps/<appId>/engage/...`.
  - Set the cookie `engage_host=1` so the layout renders the Engage shell.
  - Block non-Engage modules on that host (redirect them to `admintools.inov8rlabs.com`).
- **Shell:** `components/modules/engage/EngageShell.tsx`:
  - left navigation: Overview, Campaigns, Journeys, Segments, Assets, Feed, Analytics, Settings, Audit;
  - an app switcher (FitCircle; BuyForBaby and TripWiz greyed out until registered);
  - a header link "Admin Tools ↗".
- **Admin Tools:** add an "Engage ↗" tile on `/apps/[appId]` that links to `https://engage.inov8rlabs.com/<appId>`.
- **Auth:**
  - Preferred: set `cookies.sessionToken.options.domain = '.inov8rlabs.com'` in `auth.ts`, so one sign-in covers both hosts.
  - Alternative (**human step**): add the redirect URI `https://engage.inov8rlabs.com/api/auth/callback/google` to the existing OAuth client in the GCP project `inov8r-admin`.
- **Human steps:**
  1. Vercel → `inov8r-admin` project → Domains → add `engage.inov8rlabs.com`.
  2. DNS: a CNAME `engage` → `cname.vercel-dns.com`, at the inov8rlabs.com registrar.
  3. Keep Vercel SSO **off** for that domain (as for admintools).
- **Tests:** middleware rewrite tests per host, and blocked module access on the engage host.

### E4.03: Per-module roles
- **Env var:** `ADMIN_MODULE_ROLES` as JSON, for example
  ```json
  { "ani@inov8rlabs.com": { "*": "admin" }, "anki@inov8rlabs.com": { "ads": "admin", "engage": "editor" } }
  ```
- **`lib/auth/roles.ts`:** `roleFor(email, appId, module)` returns a role, or `null` (no access). The default for emails on `ADMIN_ALLOWED_EMAILS` without an entry is `viewer`.
- **Enforcement:**
  - The UI hides actions above the user's role.
  - The proxy forwards `X-Admin-Actor`; the backend re-checks the role (E1.08).
  - The tool UI's role is a convenience. **The backend is the gate.**
- **Sync:** the tool writes `engage_roles` in each app's database through `PATCH /api/admin/engage/roles`, from Settings → Roles, admin only. The env var only bootstraps it.
- **Tests:** a role matrix covering hidden buttons and the 403 passthrough.

### E4.04: Shared UI building blocks
- **Reuse:**
  - `components/ui/kit.tsx`: Btn, Panel, Callout, Segmented, Toggle, Pill, Field, TextField, TextAreaField, SelectField, Sheet;
  - `toast.tsx`;
  - `components/modules/experiments/AudienceEditor.tsx`. Generalize it into `components/modules/engage/audience/AudienceBuilder.tsx`, which renders the spec §5.1 tree, gets its field catalogue from `/api/admin/engage/events/catalog` plus the field registry, and shows a debounced **live estimate** (500 ms) with 20 sample users.
- **Done when:** AudienceBuilder supports nested all/any/not, every operator, and event-count conditions, and has unit tests.

### E4.05: Campaigns list (`/engage/campaigns`)
- **Columns:** name, status pill, kind, surfaces (icons), experience (template badge), audience estimate, sends today, CTR (7 days), last edited by and when.
- **Filters:** status, surface, tag, "has experience". **Search** covers name and key.
- **Row actions:** open, duplicate, pause or resume, archive.

### E4.06: The composer (`/engage/campaigns/new` and `/:id`)
Steps, shown as a left rail with progress:
1. **Basics:**
   - name, key (auto slug), description, tags;
   - category (marketing, lifecycle or transactional; transactional is admin only);
   - kind (one-off, scheduled, recurring, triggered or journey).
2. **Audience:** AudienceBuilder, saved segments (include and exclude), platforms, a **required** `max_audience` (prefilled at estimate × 1.2), and a test-mode toggle that targets only preview users.
3. **Experience** (optional; the "Add experience" button):
   - choose a template, then the template's form, ported from `components/modules/campaigns/*`: copy, dates (teaser, start, end in local days), circle template, calendar doors editor, marks, palette, art (ring-art generator `lib/art/ring-art.ts` plus upload);
   - App Store event fields with a "Sync to App Store" button, and the Play export pack.
4. **Messages:** one tab per surface, with "Add message" for push, in-app, feed card, placement, email and web push.
   - **Editors:**
     - layout picker (only layouts valid for the surface or placement);
     - content fields with character counters matching the schema limits;
     - an image picker from Assets;
     - an icon key picker;
     - an action picker (screens from `/screens`, URLs validated against the allowlist);
     - variants as tabs with a weight slider;
     - per-platform override tabs (iOS, Android, Web);
     - locale tabs;
     - the fallback selector.
   - **Rules per surface:**

     | Surface | Rules |
     |---|---|
     | In-app | Trigger event plus filters, delay |
     | Card | Dismissible, pinned, expiry |
     | Push | Interruption level, Android channel, TTL, image, buttons |
     | Email | Subject, preheader |

   - **Linter warnings:** health data in push text, numbers that aren't tokens (the no-fake-data rule), emoji, and a title over the recommended length.
5. **Schedule or trigger:**
   - one-off: send now or at a time, plus the local-time toggle;
   - recurring: an RRULE builder (daily or weekly with days and time);
   - triggered: event, filters and delay;
   - start and end window;
   - frequency: max per user, minimum hours between, re-eligible after.
6. **Goal and experiment:** goal event (from the catalogue), window (hours), exit on goal (journeys), and the per-campaign control % (0–50).
7. **Review:**
   - the launch checklist from `POST /campaigns/:id/dry-run`, which returns `{ estimate, sample:[{userId, platform, rendered:{…}, wouldSee, reasons[]}], checklist:{ok, errors[]}, compat }`;
   - the compatibility table;
   - the **Launch** button. If the estimate is over `type_to_confirm_threshold` or the campaign is a push-to-all, show a modal that requires **typing the audience size**.

- **Autosave:** every 2 s of inactivity, as a PATCH of the draft. Optimistic concurrency uses `version`, and a 409 shows a merge prompt.
- **Port the v1 React components** from the `feat/engage` worktree (`apps/web/app/components/admin/engage/*`): `MessageComposer` (1,108 lines), `ContentEditor` (330), `ActionPicker` (108), `PreviewPane` (443), `FilterBuilder` (150), `AssetsPage` (409), `AssetPicker` (201). Restyle them onto the Admin Tools kit and split them per step.
- **Tests:** a component test per step, a full-flow test (create → dry run → launch, against a mocked API), and the type-to-confirm modal.

### E4.07: Preview (tier 1, instant)
- **`@inov8r/engage-preview`:**
  - `<DevicePreview platform="ios|android|web" device="phone|duo-inner|fold-inner|desktop" theme="dark|light" textSize="default|large|xxl" layout=… content=… appTheme=… />`.
  - It extends and moves `components/modules/campaigns/preview/native/{DeviceFrame,ios,android,system}.tsx` into the package.
- **Web** uses the **production** `@inov8r/engage-web` components, so it's exact.
- **iOS and Android are faithful approximations:**
  - tokens from `/api/admin/engage/theme`;
  - SF Pro and Roboto stacks;
  - safe areas;
  - widths: phone 393 pt, iPhone Duo inner ≥ 600 pt with the pane layout, Android foldable 840 dp with the sidebar shell.
- **"Render as user":** a user search through `/segments/:id/sample` or by ID. `GET /campaigns/:id/preview?user=…&platform=…&locale=…&variant=…` returns the rendered content plus the eligibility trace (`wouldSee`, `reasons[]` such as `audience:false (sub_state=pro)` or `cap:iam_daily`).
- **Label:** "Approximation · use Test send for the real render".

### E4.08: Test send (tier 2)
- **The test devices list:** Settings → Test devices picks rows from `engage_devices` belonging to admin accounts, or any user ID (admin only).
- **`POST /campaigns/:id/test-send { messageId, variantId, installIds[] }`:**
  - **Push and web push:** a real send to those devices, bypassing caps and consent. Logged with `test=true`. The title is prefixed `[Test] ` (server-side).
  - **In-app and cards:** the server writes a 5-minute forced delivery (`engage_settings` key `force:<userId>` with `[{messageId, variantId, expiresAt}]`), then sends a **silent push**:
    - iOS: `content-available: 1`, `apns-push-type: background`, `apns-priority: 5`, data `{"engage":"refresh"}`;
    - Android: an FCM data message `{"engage":"refresh"}`.

    The app calls `/sync` and shows it with a "Test" ribbon.
  - **Email:** sent to the actor's email.
- **Tests:** caps are bypassed only with `test=true`, forced deliveries expire, and the silent push payload shape is correct.

### E4.09: Segments, Assets and Feed pages
- **Segments:** a list with use sites (campaigns referencing each one), the builder, the estimate, a sample, and the materialized toggle (admin only).
- **Assets:** port the v1 `AssetsPage`/`AssetPicker`. Drag-drop runs the browser pipeline: SHA-256, dimensions, dominant colour, and WebP 480/960/1440 variants. Upload uses multipart **≤ 4.5 MB per request** (the Vercel body limit), so upload the variants in separate requests if needed. Archiving is blocked while an asset is used.
- **Feed:** the `home_feed_rules` editor (move, hide, show, variant, boost, with the audience language) and "preview the feed as a user" (wrapping `GET /api/admin/home-feed/preview?userId=` with its trace).

### E4.10: Overview, Settings and Audit
- **Overview:** live campaigns, today's sends, opens and clicks, failed-send rate, suppressed by reason, cap hits, devices by app version (adoption of Engage-capable builds), and the last dispatcher run with queue depth.
- **Settings:** caps, quiet hours default, `type_to_confirm_threshold`, approval threshold (off), global control % (0), test devices, roles.
- **Audit:** a filterable log from `engage_audit_log`.

### E4.11: Retire the old Campaigns module (with E10)
- Keep `components/modules/campaigns/*` **read-only** until E10 is complete for the live campaigns. Then remove the `campaigns` module from `registry.ts` and `modules.ts`, and delete the components that have moved to Engage.

---

## 9. E5: iOS (`FitCircle-iOS`, EngageKit + host integration) (7–8 days)

### E5.01: EngageKit package (`engage/ios/EngageKit`)
- **`Package.swift`:** `platforms: [.iOS(.v17)]`, `swift-tools-version: 6.0`, no dependencies.
- **Targets:** `EngageKit` and `EngageKitTests`.
- **Sources** (port from FitCircle-iOS `feat/engage`, `Core/Engage/*` and `Features/Engage/*`):

  | File | Contents | Port notes |
  |---|---|---|
  | `Generated/*.swift` | Codable models (E0b.02) | Replaces `EngageModels.swift` (590 lines). Keep its forgiving decoding: unknown enums become `.unknown`, which is dropped. |
  | `EngageClient.swift` | `actor EngageClient`: `sync()`, `postEvents(_:)`, `postSession(_:)` | Transport protocol `EngageTransport` (the host supplies auth headers) |
  | `EngageStore.swift` | Disk cache (Application Support/engage/sync.json), 15-min foreground refresh, event queue persisted to `events.jsonl`, dismissals, local caps (session, daily, min interval), `reset()` on logout | Port from `EngageStore.swift` (406 lines); remove the TCA dependency and expose an `@Observable` class |
  | `TriggerEngine.swift` | Matches `EngageAppEvent` against `in_app[].trigger`, with priority, delay, the calm-moment wait (60 s) and the one-at-a-time rule | New, from the v1 store logic |
  | `CalmMoments.swift` | `public protocol CalmMomentProvider { var isCalm: Bool { get }; var calmChanges: AsyncStream<Bool> { get } }` | New |
  | `EngageImageCache.swift` | Memory and disk cache, variant picking, dominant-colour placeholder | Port (156 lines) |
  | `Views/PlacementView.swift` | `PlacementView(id:)`: impression counted at ≥ 50% visible for ≥ 1 s | Port (155) |
  | `Views/CardViews.swift` | `banner`, `card` (placements) | Port from `EngageCardViews.swift` (306) |
  | `Views/InAppMessageHost.swift` | `modal`, `slideup`, `fullscreen`, `sheet`; on a large layout it uses the host-provided pane presenter | Port (362) and add `sheet` |
  | `Theme.swift` | `public struct EngageTheme { colors, fonts, iconImage: (String) -> Image?, gradient }` | Host-injected |
  | `ActionRouting.swift` | `public protocol EngageActionRouter { func perform(_ action: EngageAction) async }` | Host implements it |
  | `Push.swift` | `EngagePush.handle(userInfo:)` handles opened events and the silent `engage: refresh` | New |
  | `Debug/EngagePreviewHost.swift` | Fixtures-driven gallery | Port (297) |

- **Tests (`EngageKitTests`):**
  - decode every fixture in `protocol/fixtures` (copied into the test bundle at build time by a script);
  - unknown fields;
  - cap logic;
  - trigger priority and delay;
  - calm-moment wait and drop after 60 s;
  - persisted queue survives a relaunch;
  - `reset()` clears everything.
- **Done when:** `swift test` passes on macOS CI.

### E5.02: Host integration in FitCircle-iOS (`feat/engage-v2`)
- **Add the package:** local reference during development, then the git tag (E0b.06). Add `EngageKit` to the `FitCircle` target.
- **New files in `FitCircle/Core/Engage/`:**
  - `FitCircleEngage.swift`: configures `EngageClient` with the existing `APISession`/`APIClient` auth. The base URL is `/api/mobile/engage`. It sends the `X-Engage-*` headers and appends `engage@1` to `X-Client-Features` in `AppClientHeaders` (`Core/Network/APISession.swift`).
  - `FitCircleEngageTheme.swift`: maps `AppTheme.Colors` and `AppTheme.Typography`, and icon keys through the existing icon-key → SF Symbol map.
  - `FitCircleEngageRouter.swift`:
    - `open_screen` → `DeepLinkRouter.navigateFromApp(...)`;
    - `paywall` → `PaywallPresenter`, respecting `PaywallAutoThrottle`;
    - `invite`/`start_circle` → the existing referral entry points;
    - `open_url` → `SFSafariViewController`;
    - `fitzy` → the Fitzy presenter;
    - `experience` → `CampaignPresenter`;
    - `enable_notifications`/`request_push_permission` → `PushNotificationService`;
    - `log_water` → the hydration action.
  - `FitCircleCalmMoments.swift`: derives `isCalm` from `AppFeature.State`. It is **not** calm when:
    - onboarding is active;
    - the paywall is presented;
    - Meet Fitzy, the post-aha paywall, `CampaignInfoSheet`, a referral sheet or celebration, the review prompt, the ATT prompt or the biometric lock is showing;
    - the camera is open, or meal analysis review is presented;
    - a text field is focused (through a focus tracker environment value).
  - `EngageAppEventBridge.swift`: forwards `Analytics.track` events in the allowlist to `EngageStore.record(.appEvent(name, props))`. Port from v1 (54 lines), with names from tracking plan v17.
- **Wiring points** (exact files on main):

  | Where | Change |
  |---|---|
  | `FitCircle/Features/AppFeature.swift` | Mount `InAppMessageHost` at the root overlay. On the **Duo large layout** (`DuoLayout.largeLayoutMinimumWidth = 600`), modal, fullscreen and sheet present through `PaneCover` (`Core/Utilities/PaneNavigation.swift`), never as a sheet. Call `store.reset()` on logout. |
  | `FitCircle/Features/Dashboard/HomeFeed/HomeFeedLayout.swift` + `PromoCard.swift` | Render `promo@2`: the new layouts `captioned_image`, `image_only` and `carousel`, `footnote`, `countdown.hide_after`. Add `promo@2` to the `cards=` declaration in `HomeFeedClient.swift`. Keep promo@1 rendering. |
  | `FitCircle/Features/FitCircles/CirclesListFeature.swift` (view) | `PlacementView(id: "circles_top")` above the list |
  | `FitCircle/Features/Profile/ProfileFeature.swift` (view) | `PlacementView(id: "profile_top")` |
  | `FitCircle/Features/Streaks/DailyCheckInView.swift` | `PlacementView(id: "post_checkin")` under the celebration |
  | Food log day view (`Features/FoodLog/*`; find the day screen) | `PlacementView(id: "food_log_top")` |
  | Fitzy chat empty state (`Features/Fitzy*/…`) | `PlacementView(id: "fitzy_top")` |
  | `FitCircle/Core/Services/PushNotificationService.swift` | On open: `EngagePush.handle(userInfo)` posts `push_opened` with `send_id`. In `didReceiveRemoteNotification` (background): if `engage == "refresh"`, call `EngageStore.syncNow()` and complete with `.newData`. **Requires the Background Modes → Remote notifications capability.** Check `Info.plist` `UIBackgroundModes` contains `remote-notification`, and add it if missing. |
  | `FitCircle/FitCircleApp.swift` / scene phase | On `.active`: `EngageStore.onForeground()`, which syncs if the TTL has expired and posts the session (throttled to 30 min). Post the session immediately when push permission changes. |
  | `Features/Profile/Settings/NotificationSettingsView.swift` | New **"Tips & offers"** toggle, with the footnote "Occasional updates about new features and offers from FitCircle. You can turn this off any time." It PATCHes `/api/mobile/notifications/preferences` `{ marketing_enabled, consent_version: "2026-11", source: "settings" }`. The backend also accepts these fields (E1.01 columns; extend the preferences route in E3.02). |

- **Tests (`FitCircleTests`):**
  - `EngageIntegrationTests.swift`: router mapping for every action, calm-moment derivation from fixture states, header composition (`X-Client-Features` contains `engage@1`), and logout reset.
  - **Snapshot tests** (existing harness) for every placement and in-app layout × dark/light × default/XXL × phone/Duo inner, named `testEngage<Layout><Variant>`.
  - The promo@2 card snapshots.
- **Done when:**
  - the full suite passes;
  - a manual run on the simulator ("FitCircle Duo Redesign" or a new one) against local `next dev` shows a test modal, a placement and a promo@2 card;
  - a silent-push test send works on a **physical** device. Silent pushes don't arrive on the simulator reliably, so use a test device with a test account, never the owner's personal devices.

### E5.03: Release
- Bump `MARKETING_VERSION` to the next version after the latest approved one, and check App Store Connect state through the API first.
- **Review notes** mention the "Tips & offers" opt-in and its location.
- Build through Xcode Cloud, never a local upload. Start the run via the ASC API if the push webhook doesn't trigger.

---

## 10. E6: Android (`Fitcircle-Android`, engage-android + host integration) (7–8 days)

### E6.01: The engage-android libraries (`engage/android`)
- **`:engage-core`:**
  - Kotlin 2.x, `kotlinx.serialization`, coroutines; minSdk 26.
  - **No OkHttp or Retrofit dependency.** It uses an `EngageTransport` interface with a default `HttpURLConnection` implementation, plus an optional `OkHttpTransport` in `:engage-okhttp` with an OkHttp `compileOnly` dependency, so it works with both OkHttp 4 and 5.
  - **Port from `feat/engage`:**

    | v1 file | Target |
    |---|---|
    | `features/engage/EngageRepository.kt` (242 lines) | `EngageStore` (file cache, refresh, dismissals, caps) |
    | `EngageEvents.kt` (196) | `EngageEventQueue` (persisted to a file, retried) |
    | `EngageRules.kt` (276) | `Rules`, `TriggerEngine` |
    | `core/model/Engage.kt` | Replaced by the generated models |

- **`:engage-compose`:**
  - `PlacementSlot(id)`, card layouts, and `InAppMessageHost(calm: StateFlow<Boolean>, presenter: PanePresenter?)`;
  - `EngageTheme` supplied by the host;
  - port from `EngageLayouts.kt` (425) and `InAppMessageHost.kt` (413), and add `sheet`.
- **`:engage-push`:** `EngagePush.handle(data: Map<String,String>)` handles opened and refresh events, plus a helper to build a BigPicture notification.
- **Tests:**
  - JVM unit tests: port `EngageRulesTest` (18 tests) and add fixture decoding for all `protocol/fixtures`;
  - Roborazzi snapshots in a sample app module `:engage-sample`.

### E6.02: Host integration in Fitcircle-Android (`feat/engage-v2`)
- **Gradle:** add `engage-core`, `engage-compose` and `engage-push` to `FitCircle/app/build.gradle.kts`, through `includeBuild` during development and then the published version (E0b.06).
- **New package `com.fitcircle.app.core.engage`:**
  - `EngageModule.kt` (Hilt): provides `EngageClient` with an OkHttp transport reusing the app's `OkHttpClient`, which already has `AuthInterceptor` and `ClientInfoInterceptor`. Add the `X-Engage-*` headers, and add `engage@1` to `X-Client-Features` in `core/network/ClientInfoInterceptor.kt`.
  - `FitCircleEngageTheme.kt`: from the app's `MaterialTheme` and color tokens, plus the icon key → Material Symbol map.
  - `FitCircleEngageRouter.kt`:
    - `open_screen` → `core/services/DeepLinkRouter.kt`;
    - `paywall` → `features/paywall/PaywallScreen` with a `PaywallContext`;
    - `invite`/`start_circle` → the referral flows;
    - `open_url` → Custom Tabs (add `androidx.browser:browser`);
    - `fitzy`;
    - `experience` → the campaign screens;
    - notification permission → `NotificationPermissionManager.kt`.
  - `FitCircleCalmMoments.kt`: combines the `features/journey/JourneyHost.kt` state, the paywall visible state, `CampaignInfoSheet`, `AiConsentDialog`, the camera and review routes, and IME visibility.
  - `EngageAppEventBridge.kt`: forwards the allowlisted `Analytics` events.
- **Wiring points:**

  | File | Change |
  |---|---|
  | `navigation/MainScreen.kt` | Mount `InAppMessageHost` above the NavHost. On `AppShell` RAIL or SIDEBAR (`core/adaptive/AppShell.kt`, `appShellFor`), present modal, fullscreen and sheet **inside the content pane** using the existing pane scaffolds (`core/adaptive/PaneScaffolds.kt`). Dialogs only for small confirmations. |
  | `features/dashboard/feed/PromoCard.kt` + `HomeFeedRenderContext.kt` + `core/network/HomeFeedApi.kt` | Render `promo@2`; declare `promo@2` in `cards=` |
  | Circles list screen, `features/profile/ProfileScreen.kt`, `features/dashboard/DailyCheckinBottomSheet.kt`, the food log day screen, the Fitzy empty state | `PlacementSlot("circles_top" \| "profile_top" \| "post_checkin" \| "food_log_top" \| "fitzy_top")` |
  | `core/services/NotificationDeepLink.kt` | Add `engageSendId`, `engageCampaignId`, `variantId` and `params` to `ALLOWED_DATA_KEYS`. Validate `params` (a JSON object of string values, at most 1 KB). |
  | `core/services/PushNotificationService.kt` | If `data["engage"] == "refresh"`, call `EngageStore.syncNow()` and show nothing. If `image_url` is present, use `NotificationCompat.BigPictureStyle` (download at most 1 MB with a 5 s timeout, falling back to text). Channel choice: `marketing` for marketing pushes (**create the channel `marketing`**: name "Tips & offers", importance DEFAULT), otherwise the existing `channelFor(category)`. |
  | `FitCircleApplication.kt` / process lifecycle | Session post on foreground (throttled to 30 min); reset on logout in `core/data/SessionManager.kt` |
  | `features/settings/NotificationSettingsView(Model).kt` | The **"Tips & offers"** toggle, with the same PATCH as iOS |

- **Tests:**
  - unit tests for the router mapping, calm-moment combination, header composition, the deep-link allowlist (new keys accepted, oversized `params` rejected), and the notification builder choosing BigPicture or channel;
  - Roborazzi for every layout × theme × font scale (1.0 and 2.0) × phone/foldable.
- **Done when:**
  - the full suite plus `verifyRoborazziDebug` pass;
  - a manual run on a **new** AVD (never emulator-5554 or 5584) against local dev;
  - a test send arrives on a test device.

### E6.03: Release
- `versionCode` comes from the `VERSION_CODE` env var (the default in `build.gradle.kts` is the next number).
- Sign with the upload key. The keystore is copied temporarily and then deleted, as in previous releases.
- Upload to Play internal, then production after review.
- **Play Data safety:** no new data types. Engage events stay first-party, and the attribution user ID is already declared by the GA4 attribution release. Verify before sending for review.

---

## 11. E7: web (FitCircleBE `apps/web`) (4–5 days)

### E7.01: `@inov8r/engage-web`
- `<EngageProvider fetcher=… theme=…>`, `<PlacementSlot id>`, `<InAppHost>`, and the layout components shared with the tool preview.
- **Port from v1** `components/engage/WebEngage.tsx` (301 lines) and `layouts.tsx` (403).

### E7.02: Mount in FitCircleBE
- `app/providers.tsx`: wrap signed-in pages in `EngageProvider`. It calls `/api/mobile/engage/sync` with the cookie session; the route must accept cookie auth, as the home feed already does.
- `dashboard/page.tsx` / `lib/home-feed/feed-layout.ts`: declare `promo@2` (and promo@1) in the web `cards=` list, and render promo cards through `@inov8r/engage-web`.
- Add placements where the pages exist (circles, profile).

### E7.03: Web push client
- `public/sw.js`:
  ```js
  self.addEventListener('push', e => { const d = e.data?.json() ?? {}; e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: d.icon, image: d.image, tag: d.tag, data: d })); });
  self.addEventListener('notificationclick', e => { e.notification.close(); const d = e.notification.data || {}; e.waitUntil((async () => { await fetch('/api/mobile/engage/events', { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify({ events: [{ client_event_id: crypto.randomUUID(), type:'push_opened', send_id: d.data?.engageSendId, campaign_id: d.data?.engageCampaignId, occurred_at: new Date().toISOString() }] }) }).catch(()=>{}); const c = await clients.matchAll({ type:'window', includeUncontrolled:true }); const url = d.url || '/dashboard'; for (const w of c) { if ('focus' in w) { await w.navigate(url); return w.focus(); } } return clients.openWindow(url); })()); });
  ```
  Keep the existing caching handlers.
- **Subscription UI:** `components/engage/WebPushPrompt.tsx` is a soft-ask card in Settings and after a meaningful action. On a click:
  ```js
  Notification.requestPermission()
  registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: NEXT_PUBLIC_ENGAGE_VAPID_PUBLIC_KEY })
  ```
  followed by `POST /api/mobile/push/register { platform: 'web', subscription }`. Extend the register route to store `web_subscription`.
- **Manifest:** confirm `display: "standalone"` for iOS home-screen web apps.
- **Tests:** a Playwright test (Chromium) for the soft ask, subscription and register. Mock the push service and check the notification click posts the event.

---

## 12. E8: analytics (3 days)

### E8.01: Rollups
- **`/api/cron/engage-stats`** every 15 minutes. It upserts `engage_stats_daily` for **today and yesterday** with set-based SQL from `engage_sends`, `engage_events` and `engage_exposures`:
  - **conversions:** distinct users with goal events within `goal.window_hours` after their first exposure or send;
  - **revenue:** from `subscription_events` (net) within the window.
- **Stats endpoint:** `GET /campaigns/:id/stats?from&to&platform` reads the rollups and **never** raw rows (fixes B5).

### E8.02: Significance
- `stats/significance.ts`:
  - two-proportion z-test against control;
  - χ² test across variants;
  - Wilson 95% confidence intervals.
- Show "Not enough data" until each arm has at least 100 conversions. **Never auto-promote** a winner.

### E8.03: Tracking plan v17+ (FitCircleBE `analytics/tracking-plan.json`)
- Add `Engage Message Viewed`, `Engage Message Clicked`, `Engage Message Dismissed`, `Engage Push Opened` and `Engage Conversion`, with the properties `campaign_id`, `message_id`, `variant_id`, `surface`, `layout` and `placement`.
- Regenerate with `node analytics/codegen.mjs` for iOS, Android and web.
- **The client SDKs emit these through the host's analytics facade**, via `EngageAnalyticsSink`. The host maps them to Amplitude.

### E8.04: Analytics UI
- **Per campaign:** a funnel (sent → delivered → opened or viewed → clicked → converted), a variant table with confidence intervals, a per-platform split, a daily chart (Recharts), and suppressed sends by reason.

---

## 13. E9: journeys (5 days, in the first release)

### E9.01: Model and editor
- **Schema:** `journey.v1.json`.
  - Steps: `{ id, type: 'message', messageId }`, `{ id, type: 'delay', duration?: 'PT24H', untilLocalTime?: '09:00' }`, `{ id, type: 'branch', condition: Audience | { did: event, since: 'entry' }, yes: stepId, no: stepId }`, `{ id, type: 'split', arms: [{ pct, next }] }`, `{ id, type: 'exit' }`.
  - Each step has an implicit `next`.
  - Journey-level settings: entry (`event` / `segment_enter` / `api` / `schedule`), `exit_on_goal`, `exit_conditions[]`, `max_duration`, `reentry_after_hours`.
- **Editor:** `components/modules/engage/journeys/JourneyEditor.tsx` is a vertical list with indented branches, plus add, move and delete. Messages are edited inline with the same message editors.

### E9.02: Runtime
- **Entry:**
  - **Event:** in `/events` ingestion, when the event matches, insert an `engage_journey_state` row if there's no active entry and the re-entry window has passed. The unique index stops duplicate active entries.
  - **Segment enter:** the materialized segment refresh computes the newly added members and inserts entries.
- **Advance** (in the dispatcher), per due row:

  | Step type | What the dispatcher does |
  |---|---|
  | `message` | Push, email or web push: enqueue an `engage_sends` job with `occurrence_key 'j:<entry_id>:<step>'`. In-app, card or placement: write a per-user forced eligibility record (`engage_journey_state.context.active_messages[]`) that `/sync` includes until it's shown or expires. |
  | `delay` | Set `next_run_at` |
  | `branch` | Evaluate the condition with a compiled single-user query |
  | `split` | Hash of `entry_id` |
  | `exit` | Set `exited_at` |

- **Goal and exit conditions:** checked during event ingestion and **at the end of each delay** (Braze semantics).
- **Tests:** every step type, exit-on-goal during a delay, re-entry, the split distribution (±2% over 10k), and time zones for `untilLocalTime`.

### E9.03: Seed journeys
These replace the dead ladder in `lib/cron/notification-crons.ts`. Seed them as **drafts**; the owner reviews the copy and launches them.

| Journey | Entry | Steps |
|---|---|---|
| Day 1, nothing logged | Signup | Delay 24 h → branch "did `meal_logged` since entry" → no: push "Log your first meal" → exit |
| Day 3, circle invite | Signup | Delay 72 h → branch `has_circle = false` → push and in-app modal suggesting a circle |
| Dormant | Segment enter `last_active_days >= 7` | Push → delay 7 d → push (the second, only if still dormant) → exit when `app_open` happens |
| Win-back at 60 days | Segment enter `last_active_days >= 60` | Email |
| Weekly summary | Recurring, Sunday 18:00 local | Push with personalization |

- After the journeys launch, delete `lib/cron/notification-crons.ts` and its unused templates.

---

## 14. E10: migrations and cleanup (4–5 days, timed around live campaigns)

### E10.01: `SYSTEM_PROMOS` → Engage campaigns
- **Seed script:** `FitCircleBE scripts/engage/seed-system-promos.ts` creates 4 campaigns with `system: true`, `kind: 'triggered'` (feed surface), with audiences translated from `lib/promos/system-promos.ts`:
  - `first_meal` ↔ `meals_ever = 0`;
  - `log_meal_now` ↔ open slot not logged (a journey field);
  - `pro_value` ↔ `sub_state = 'free'` and activated;
  - `meet_fitzy` ↔ `fitzy_opened = false` and activated.

  Content and creatives come from the code.
- **Parity test:** for 1,000 sampled prod users (read-only), the old engine (`lib/promos/engine.ts`) and the Engage feed source must pick the **same** promo set. Only then switch `home-feed-service.ts` to Engage for promos, behind `ENGAGE_PROMOS_SOURCE=engage|code` (default `code`). Delete the code path two weeks later.

### E10.02: Seasonal campaigns → Engage campaigns with an experience
- **For each of** `hold_the_line`, `advent_2026`, `new_year_reset` and `ramadan_2027`:
  1. Create an `engage_campaigns` row with `experience_id = campaigns.id`. The experience content stays in the `campaigns` row.
  2. Convert `campaigns.notifications[]` and `emails[]` into Engage messages with equivalent schedules. The audiences become segments:
     - `all` → all users;
     - `participants` → `experience_joined`;
     - `reminders` → the matching segment.
  3. Mark the old notification entries `migrated: true`, so the campaign cron skips them. **Change `campaign-delivery-service.ts` to skip any campaign that has a linked Engage campaign.**
- **Timing:** do **not** migrate a campaign while it is live:
  - Hold the Line (Nov 15 – Dec 15) and Advent (Dec 1–24) stay on the old system until they end, unless they're migrated before Nov 15 and fully verified.
  - `new_year_reset` and `ramadan_2027` are migrated first.
- **Remove the old editors** after the last migration: the FitCircleBE `app/admin/campaigns/*` and `components/admin/campaigns/*`, and the Admin Tools campaigns module (E4.11).

### E10.03: Feed rules UI replaces curl
Done in E4.09. Remove the curl instructions from `HOME_FEED_SPEC.md`.

---

## 15. E11 and E12: BuyForBaby and TripWiz (about 2 weeks each, after the FitCircle release)
These follow `ENGAGE_MULTITENANCY.md` §4.2 and §6.

**BFB:**
- **Admin auth:** add a bearer-secret path (`BFB_ADMIN_API_SECRET` plus `X-Admin-Actor`) beside the existing `is_admin` check.
- **Push:** a `PushSender` over `lib/notifications/push.ts` `sendPushToUser`, which already does direct APNs and FCM.
- **Targeting:** a `market` field (IN/CA/US) from domain detection.
- **Migration** into BFB's Supabase project.
- **EngageKit as BFB iOS's first package.** It has zero dependencies, which suits BFB's iOS 26 floor. **Owner sign-off is needed** because BFB has a no-packages policy.
- **Android:** the OkHttp 5 transport.
- **Prefix:** `/api/v1/engage`.

**TripWiz:**
- **Admin auth:** align `x-admin-secret` with the bearer header plus `X-Admin-Actor`.
- Runs on Next 14.2; the route factories already work on it, and CI covers it.
- **Push:** a `PushSender` over `src/lib/push.ts`.
- **Capability header:** alias `X-TripWiz-Features` to `X-Client-Features`.
- **Prefix:** `/api/engage`.

**Both:**
- registry entries in Admin Tools;
- the conformance suite green on staging;
- theme tokens (BFB rose `#BD3255` with SF Pro Rounded and Quicksand; TripWiz pink with Poppins).

---

## 16. Environment variables (complete)

| Var | Project | Value / default | When |
|---|---|---|---|
| `ENGAGE_ENABLED` | fit-circle-web | `false` → `true` at R3 | Master kill switch |
| `ENGAGE_SENDS_ENABLED` | fit-circle-web | `false` → `true` at R5 | Push, email and web push |
| `ENGAGE_PROMOS_SOURCE` | fit-circle-web | `code` → `engage` at R7 | Promo source |
| `ENGAGE_PUSH_RATE_PER_MIN` | fit-circle-web | `2000` | |
| `ENGAGE_EMAIL_RATE_PER_MIN` | fit-circle-web | `200` | |
| `ENGAGE_IAM_MIN_INTERVAL_S` | fit-circle-web | `30` | Optional override |
| `ENGAGE_APPROVAL_THRESHOLD` | fit-circle-web | **unset** (approvals off) | |
| `ENGAGE_EMAIL_POSTAL_ADDRESS` | fit-circle-web | Owner provides | CAN-SPAM |
| `ENGAGE_VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_ENGAGE_VAPID_PUBLIC_KEY` / `ENGAGE_VAPID_PRIVATE_KEY` / `ENGAGE_VAPID_SUBJECT` | fit-circle-web | Generated; never printed | Web push |
| `NPM_TOKEN` | fit-circle-web, inov8r-admin | GitHub `read:packages` token | Package install |
| `ADMIN_MODULE_ROLES` | inov8r-admin | JSON (E4.03) | Roles |
| `FITCIRCLE_ADMIN_API_SECRET` | inov8r-admin | Already set | Proxy |
| `CRON_SECRET` | fit-circle-web | Already set | Crons |

**New crons in `apps/web/vercel.json`:**

| Path | Schedule |
|---|---|
| `/api/cron/engage-dispatch` | `* * * * *` |
| `/api/cron/engage-facts` | `*/5 * * * *` |
| `/api/cron/engage-facts?full=1` | `15 3 * * *` |
| `/api/cron/engage-stats` | `*/15 * * * *` |
| `/api/cron/engage-retention` | `10 4 * * *` |

**Check the Vercel plan's cron limits** before adding them: there are 24 cron entries today, and this adds 5.

---

## 17. Test matrix and end-to-end acceptance

### 17.1 Automated (CI)

| Layer | Suite | Gate |
|---|---|---|
| Protocol | Schema validation of fixtures; codegen produces no diff | engage CI |
| Server engine | Unit tests and pg integration tests (compiler, dispatcher, eligibility, caps, journeys, stats) | engage CI |
| FitCircleBE | Full vitest suite, including the shipped-client replay (E2.06), migration lint, and orchestrator regression | FitCircleBE CI + local before merge |
| Conformance | `engage-conformance` against `next dev` | FitCircleBE CI |
| Tool | vitest (modules whitelist, roles, middleware, composer flows) | inov8r-admin CI |
| iOS | EngageKit `swift test`; FitCircle `xcodebuild test` including snapshots | Local + Xcode Cloud |
| Android | engage-android tests; app `testDebugUnitTest verifyRoborazziDebug` | Local + CI |
| Web | Playwright web push flow | FitCircleBE CI |

### 17.2 Manual end-to-end (staging, then prod with test accounts)
Use the test accounts from `~/Downloads/FitCircle-test-accounts.csv`; never print the passwords.

| # | Scenario | Devices | Expected |
|---|---|---|---|
| 1 | Create a campaign with a modal triggered on `meal_logged`, then test send | iPhone, iPhone Duo (inner), Android phone, Android foldable, web | The modal appears after the next meal log, with a Test ribbon. On Duo and foldable it presents in the pane. |
| 2 | Placement banner `circles_top` with variants A/B and a 20% control | All | Assignment is sticky. Control users see nothing, and the exposure is recorded. |
| 3 | promo@2 carousel feed card | iOS 1.2 (new) and iOS 1.1.0 (old) | New: carousel. Old: down-converted hero. |
| 4 | Scheduled marketing push at 9:00 local, with the test user in quiet hours from 21:00 to 08:00 | iPhone | Not delivered before 08:00. Delivered at 9:00 local. Ledger `sent`. |
| 5 | Marketing push to a user with "Tips & offers" off | Android | Ledger `suppressed:consent`; no notification. |
| 6 | Image push | Android, iOS | BigPicture on Android; attachment on iOS. |
| 7 | Email with unsubscribe | Mail client | One-click unsubscribe sets all four stores, and the next email is suppressed. |
| 8 | Web push | Desktop Chrome and Safari, an iOS home-screen web app | Notification shown; the click opens the deep link and is recorded. |
| 9 | Journey "Day 1, nothing logged" in test mode, with the delay shortened to 5 minutes | Test account | Push after 5 minutes. A meal log before then means an exit and no push. |
| 10 | Pause mid-broadcast | — | Sending stops within a page (under 1 minute). |
| 11 | Kill switch `ENGAGE_ENABLED=false` | All | `/sync` returns empty; no sends. |
| 12 | Type-to-confirm above 5,000 | Tool | Launch is blocked until the number is typed. |
| 13 | Stats | Tool | Impressions, clicks and conversions match ad-hoc SQL within 1%. |

### 17.3 Performance

| Check | Target |
|---|---|
| `/sync` | p95 < 250 ms at 100k users and 50 live campaigns (local load test plus prod observation) |
| Segment estimate | < 2 s |
| Broadcast | 100k in under 60 min, no duplicates |

---

## 18. Rollout runbook (prod)
Each step needs the owner's go. Verify before moving to the next.

| Step | Action | Verify |
|---|---|---|
| R1 | Merge `feat/engage-v2` to `main` in FitCircleBE with every flag **off** | Vercel `READY`; existing suites pass; no behaviour change (shipped-client replay) |
| R2 | Apply migration **118** alone, plus the history row | `select count(*) from information_schema.tables where table_name like 'engage_%'` = 18; the view exists; the bucket limits are set |
| R3 | `ENGAGE_ENABLED=true` (sends still off); facts cron running | Facts dry run vs SQL; `/sync` returns empty for all users (no live campaigns) |
| R4 | Deploy the tool (inov8r-admin merge) plus the domain `engage.inov8rlabs.com` | Sign-in works on both hosts; roles enforced |
| R5 | `ENGAGE_SENDS_ENABLED=true`; launch a **test-mode** campaign for test accounts only | Scenarios 1–13 pass |
| R6 | Mobile releases: iOS (E5.03) and Android (E6.03) | Adoption visible in the compatibility report |
| R7 | `ENGAGE_PROMOS_SOURCE=engage` after the parity test passes | The feed is unchanged for a sample of users |
| R8 | First real campaign to a small segment (≤ 500), lifecycle category | Stats sane, no complaints, suppression reasons as expected |
| R9 | Journeys launched, one at a time | Entry counts as expected |
| R10 | E10.02 seasonal migration, per its timing rule | The old cron skips migrated campaigns |

**Rollback:** set `ENGAGE_ENABLED=false`, which empties all surfaces within one sync (≤ 15 minutes, or immediately on the next fetch). The tables stay; no data is lost.

---

## 19. Human steps checklist (owner or console)
- [ ] Create the GitHub repo `Inov8rlabs/engage` (E0.03).
- [ ] Create the GitHub token `read:packages`, then set `NPM_TOKEN` on `fit-circle-web` and `inov8r-admin` (E0b.06).
- [ ] Give Xcode Cloud access to the `engage` repo (E0b.06).
- [ ] Android CI credentials for GitHub Packages, or approve the submodule fallback (E0b.06).
- [ ] Add the Vercel domain `engage.inov8rlabs.com` plus the DNS CNAME, with SSO off (E4.02).
- [ ] Add the OAuth redirect URI for the engage host (only if not using the shared cookie domain) (E4.02).
- [ ] Provide the postal address for email footers (E3.05).
- [ ] Approve each rollout step R1–R10.
- [ ] Review the seed journey copy (E9.03) and the system-promo parity results (E10.01).
- [ ] App Store and Play submissions for the E5 and E6 releases (the owner clicks Submit).
- [ ] BFB: sign off on EngageKit as BFB iOS's first Swift package (E11).

---

## 20. Progress checklist

- [ ] **E0:** E0.01 · E0.02 · E0.03
- [ ] **E0b:** E0b.01 · E0b.02 · E0b.03 · E0b.04 · E0b.05 · E0b.06
- [ ] **E1:** E1.01 · E1.02 · E1.03 · E1.04 · E1.05 · E1.06 · E1.07 · E1.08 · E1.09 · E1.10
- [ ] **E2:** E2.01 · E2.02 · E2.03 · E2.04 · E2.05 · E2.06
- [ ] **E3:** E3.01 · E3.02 · E3.03 · E3.04 · E3.05 · E3.06
- [ ] **E4:** E4.01 · E4.02 · E4.03 · E4.04 · E4.05 · E4.06 · E4.07 · E4.08 · E4.09 · E4.10 · E4.11
- [ ] **E5:** E5.01 · E5.02 · E5.03
- [ ] **E6:** E6.01 · E6.02 · E6.03
- [ ] **E7:** E7.01 · E7.02 · E7.03
- [ ] **E8:** E8.01 · E8.02 · E8.03 · E8.04
- [ ] **E9:** E9.01 · E9.02 · E9.03
- [ ] **E10:** E10.01 · E10.02 · E10.03
- [ ] **Rollout:** R1 · R2 · R3 · R4 · R5 · R6 · R7 · R8 · R9 · R10
- [ ] **E11** BuyForBaby · **E12** TripWiz

---

## Appendix A: v1 port map (complete)

| Repo | v1 path (`feat/engage`) | Destination | Action |
|---|---|---|---|
| BE | `supabase/migrations/104_engage.sql` | `tools/migrate/templates/engage_v1.sql` → FitCircle `118_engage.sql` | Rewrite per E1.01 (v1 tables reused: assets, exposures, dismissals) |
| BE | `apps/web/app/lib/engage/{assignment,schema,render,policy,model,platform,image}.ts` | `packages/server/src/*` | Port + adapt (E1.06) |
| BE | `apps/web/app/lib/engage/attributes.ts` | — | Discard (SQL compiler) |
| BE | `apps/web/app/lib/engage/client/*` | `packages/preview/src/*`, `packages/web/src/*` | Port |
| BE | `apps/web/app/lib/engage/preview/*` | `packages/preview/src/*` | Port |
| BE | `apps/web/app/lib/services/engage-{asset,message,segment,delivery,send,stats}-service.ts` | `packages/server/src/{assets,campaigns,segments,eligibility,dispatcher,stats}` | Asset and message: port. Segment, delivery and send: rewrite (B1, B4, B6). Stats: rewrite (B5). |
| BE | `apps/web/app/api/{admin,mobile,cron}/engage/**` | FitCircleBE thin routes over `@inov8r/engage-server` factories | Rewrite as thin mounts |
| BE | `apps/web/app/admin/{assets,messages,segments}`, `components/admin/engage/*`, `EngageShell.tsx` | inov8r-admin `components/modules/engage/*` | Port UI onto the kit; **drop** `EngageShell`'s takeover of FitCircleBE `/admin` (B10) |
| BE | `components/engage/{WebEngage,layouts}.tsx` | `packages/web/src/*` | Port |
| BE | `components/admin/campaigns/sections/EngageMessagesSection.tsx` | — | Discard (campaigns are now Engage campaigns) |
| BE | Edits to `campaign-service.ts`, `notification-orchestrator.ts`, `push-service.ts`, `tracking-plan.json`, `dashboard/page.tsx`, `providers.tsx` | — | Discard; re-implement against current main (E2, E3, E7, E8) |
| iOS | `Core/Engage/{EngageModels,EngageStore,EngageImageCache,EngageAppEventBridge}.swift` | EngageKit (models generated) + host bridge | Port |
| iOS | `Features/Engage/{PlacementView,EngageCardViews,InAppMessageHost,EngageActionRouter}.swift` | EngageKit Views + host router | Port |
| iOS | `Debug/EngagePreviewHost.swift`, `EngageSampleImages.swift`, `FitCircleTests/EngageTests.swift` | EngageKit Debug + tests | Port |
| iOS | `APIClient`, `RefreshCoordinator`, `TokenRefreshManager`, `KeychainManager`, `CampaignHomeCard`, `AppFeature` auth edits | — | **Discard** (stale; shipped on main) |
| Android | `features/engage/{EngageRepository,EngageEvents,EngageRules,EngageLayouts,InAppMessageHost}.kt` | engage-android modules | Port |
| Android | `core/model/Engage.kt`, `core/network/EngageApi.kt` | Generated models + transport | Replace |
| Android | `debug/EngagePreview.kt`, `src/debug/assets/engage_fixtures/*`, `test/.../EngageRulesTest.kt` | `:engage-sample`, protocol fixtures, tests | Port |
| Android | `AuthInterceptor` header edit | `ClientInfoInterceptor` | Re-implement |
| Android | `MainScreen`, `DashboardScreen`, `ProfileScreen`, `DailyCheckinBottomSheet`, `NotificationDeepLink`, `FitCircleApplication`, `SessionManager` edits | — | Re-implement against current main (E6.02) |

## Appendix B: endpoint inventory (FitCircle mounts)

| Method | Path | Auth | Item |
|---|---|---|---|
| GET | `/api/mobile/engage/sync` | Bearer or cookie | E2.03 |
| POST | `/api/mobile/engage/events` | Bearer or cookie | E2.04 |
| POST | `/api/mobile/engage/session` | Bearer or cookie | E1.07 |
| GET | `/api/mobile/home-feed` (promo@2 source) | Existing | E2.01 |
| PATCH | `/api/mobile/notifications/preferences` (+ `marketing_enabled`) | Existing | E5.02 / E6.02 |
| POST | `/api/mobile/push/register` (+ web subscription) | Existing | E7.03 |
| * | `/api/admin/engage/*` (list in E4.01) | Bearer admin secret + `X-Admin-Actor` | E1.08, E4 |
| GET | `/api/cron/engage-{dispatch,facts,stats,retention}` | `CRON_SECRET` | E3.01, E1.05, E8.01, E1.09 |

## Appendix C: app events allowlist (initial; from tracking plan v17)
`app_open`, `screen_viewed{screen}`, `meal_logged`, `water_logged`, `workout_logged`, `checkin_completed`, `streak_milestone{days}`, `paywall_viewed{context}`, `paywall_dismissed`, `purchase_completed{product}`, `trial_started`, `circle_created`, `circle_joined`, `invite_shared`, `fitzy_opened`, `push_permission_responded{granted}`, `ai_limit_reached`, `experience_joined{campaign}`.

Server-emitted (no client change):
- `purchase_completed` / `trial_started` (from the RevenueCat and Stripe webhooks);
- `streak_milestone` (from the streak claim);
- `referral_qualified`.
