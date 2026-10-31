# FitCircle Engage v2 — in-house Braze replacement

**Status:** Draft for approval · 2026-10-30
**Supersedes:** `ENGAGE_SPEC_V1_PARKED.md` (2026-10-16, parked on branch `feat/engage`)
**Companion docs (this folder):**
- `ENGAGE_FINISH_PLAN.md`: phases, work breakdown, porting map, bugs to fix, test plan.
- `ENGAGE_TOOL_HOSTING.md`: whether Engage is a standalone tool or part of Admin Tools.
- `ENGAGE_RESEARCH.md`: Braze/competitor research, platform policy, and the code audits behind this spec.
- `ENGAGE_MULTITENANCY.md`: how one Engage serves FitCircle, BuyForBaby and TripWiz (shared protocol, engine and SDKs, plus per-app adapters).

**Where the code lives** (see `ENGAGE_MULTITENANCY.md` §4):
- **Shared:** the `inov8r-engage` monorepo:
  - the protocol;
  - `@inov8r/engage-server`;
  - `@inov8r/engage-web` / `-preview`;
  - EngageKit (Swift);
  - engage-android (Kotlin).
- **Per app** (FitCircle first): adapters and host integration in `FitCircleBE`, `FitCircle-iOS` and `Fitcircle-Android`.
- **Tool:** `inov8r-admin` at `engage.inov8rlabs.com` (multi-app).

This spec describes the FitCircle tenant. Anything marked "FitCircle" in a table (fields, placements, screens, the feed) is that app's adapter configuration. The engine is generic.

---

## 0. Goal and non-goals

**Goal.** The team runs every user-facing marketing and lifecycle message from one tool, with **no app code changes and no app release per campaign**:
- push notifications (iOS, Android, later web);
- in-app messages (modal, slide-up, full screen, bottom sheet);
- in-app content cards (home feed cards and placement banners);
- email;
- multi-step journeys;
- seasonal campaigns (Hold the Line, Advent and so on).

Any of these can span iOS, Android and web in a single campaign. The tool also covers:
- **Targeting:** platform, app version and build, OS version, locale, country, timezone, subscription state, behaviour, events, attribution, consent and random buckets.
- **Preview:** for iOS, Android and web, plus test sends to real devices.
- **Experiments:** A/B tests and control groups.
- **Analytics:** results per campaign.

**What "no app code changes" means precisely.** Apps ship a **fixed library of native layouts, components and actions** (§6), described by a versioned schema. After that, everything else is data authored in the tool: copy, images, targeting, timing, triggers, frequency, variants and priority. New layouts, components or actions need an app release, and they reach users through capability negotiation (§6.4) without breaking older apps.

**Non-goals for v2:**
- SMS.
- HTML/JavaScript in-app messages (see App Review 2.5.2 / 4.7 in `ENGAGE_RESEARCH.md` §4).
- Braze-style Connected Content and Catalogs.
- A drag-and-drop journey graph editor. v2 journeys are linear with branches (§9).
- Real-time streaming segments. Near-real-time via SQL plus a five-minute refresh is enough at 10k–100k users.

---

## 1. Vocabulary

The existing `campaigns` table means seasonal experiences, so the UI renames that concept to **Experience**. The database table name stays.

| Engage term | What it is | Braze equivalent |
|---|---|---|
| **Campaign** | The unit you launch. It has an audience, a schedule or trigger, and one or more **messages**, one per channel, sharing a goal and analytics. It can optionally attach to an **Experience**. | Campaign |
| **Message** | Content for one channel inside a campaign: push, in-app message, card, email or web push. It has variants. | Message / step |
| **Journey** | A multi-step flow. Users enter on a trigger or segment and pass through steps (message, delay, branch, exit). | Canvas |
| **Experience** | The existing seasonal campaign (`campaigns` table): calendar, circle template, art, and the App Store and Play events. | (none) |
| **Surface** | Where a message renders: `push`, `in_app`, `feed` (home feed card), `placement:<id>` (fixed slot), `email`, `web_push`. | Channel |
| **Placement** | A named native slot outside the home feed, for example `circles_top`, `profile_top`, `post_checkin`, `food_log_top`, `fitzy_top`. | Banner placement |
| **Layout** | The native component a message renders with (§6). | Message type |
| **Segment** | A saved audience: a tree of filters (§5). | Segment |
| **Trigger** | An event that starts an in-app message, journey entry, or triggered push or email (§7). | Action-based delivery |
| **Variant / control** | Content alternatives with weights. The control group receives nothing and is used to measure lift. | A/B test |
| **Goal** | A conversion event within a window, used for analytics and for exiting journeys. | Conversion event |
| **Asset** | An image or animation in the content-addressed CDN library. | Media library |

---

## 2. Architecture

```
            inov8r-admin  (Engage tool UI, see ENGAGE_TOOL_HOSTING.md)
                  │  whitelisted proxy · Bearer FITCIRCLE_ADMIN_API_SECRET · X-Admin-Actor
                  ▼
FitCircleBE  /api/admin/engage/*   (authoring, preview, test sends, stats, approvals, audit)
   │
   ├── Engage core (apps/web/app/lib/engage/*)
   │     schema + validation · segment compiler (filter tree → SQL) · variant assignment
   │     (lib/experiments/bucket) · personalization renderer · eligibility · capping
   │
   ├── Delivery: pull surfaces
   │     GET /api/mobile/home-feed            Engage cards join composeFeed as a source (§4.2)
   │     GET /api/mobile/engage/sync          in-app messages + placements + triggers + prefetch
   │     POST /api/mobile/engage/events       impression · click · dismiss · trigger_fired · conversion
   │     POST /api/mobile/engage/session      device registry upsert (§5.3)
   │
   ├── Delivery: push surfaces (send pipeline, §8)
   │     /api/cron/engage-dispatch (every minute) → due campaign batches / journey steps
   │       → engage_sends (idempotent ledger) → NotificationOrchestrator.send('engage', …)
   │       → PushService (APNs / FCM) · Resend (email) · web push (P2)
   │
   └── Postgres (Supabase): engage_* tables (§12), existing push_tokens, notification_log,
       experiments, promo_user_state (absorbed), campaigns (Experiences)
```

**Rules that carry over from the rest of the stack:**
- **No stored procedures or triggers.** All logic lives in TypeScript services. Segment SQL is generated and parameterized in TypeScript.
- **Every push goes through `NotificationOrchestrator.send`.** That path already handles dedupe, category toggles, the daily cap of 3 with exemptions, quiet hours, burst limits, Fitzy's reserved slot and `notification_log`. Engage adds a new `NotificationType` family; it never adds a second send path.
- **Home feed cards go through `composeFeed`** and its guardrails: promo density, adjacency, the `first_meal` pin, the 250 ms context budget, and `decision_id` events. Engage never builds a parallel home layout.
- **Authenticated responses are `no-store`.** See the account-switch cache leak incident.
- **Migrations are applied one at a time.** The next free number is 117 at the time of writing; check before starting. Never run `db push --include-all`.

---

## 3. Campaigns

### 3.1 Campaign record

`engage_campaigns`:

| Field | Notes |
|---|---|
| `id`, `key` (slug), `name`, `description`, `tags[]` | Tags drive frequency rules and the global control exclusions. |
| `status` | `draft → in_review → approved → scheduled → live → paused → completed → archived`. Edits to a live campaign create a new **version**. |
| `kind` | `one_off` · `scheduled` · `recurring` (RRULE, local time) · `triggered` (event) · `api` (server call) · `journey` (§9) |
| `experience_id` | Optional link to an Experience (`campaigns.id`). |
| `audience` | `{ segment_ids[], filters (inline tree), exclude_segment_ids[], platforms[], max_audience }` |
| `schedule` | `{ start_at, end_at, send_at, local_time: bool, rrule, timezone_fallback }` |
| `trigger` | `{ event, filters (event props), delay_seconds, window_seconds }`, for triggered campaigns. |
| `goal` | `{ event, filters, window_hours (default 72, max 720), exit_on_goal }` |
| `experiment` | `{ variants: [{id, weight}], control_pct (0–50), experiment_id → experiments }`. Reuses `lib/experiments`. |
| `frequency` | `{ max_per_user, min_hours_between, reeligible_after_hours, respect_global_caps (default true) }` |
| `priority` | 1–100. Breaks ties between in-app messages and between cards in a placement. |
| `category` | `marketing` · `lifecycle` · `transactional`. Drives consent and caps (§10). |
| `messages[]` | One per surface (§3.2). |
| `created_by`, `approved_by`, `version`, timestamps | |

### 3.2 Messages

`engage_messages`, one row per campaign and surface:

| Field | Notes |
|---|---|
| `campaign_id`, `surface` | `push` · `in_app` · `feed` · `placement` · `email` · `web_push` |
| `placement_id` | When `surface = placement` (§4.3). |
| `layout` | Must be valid for the surface (§6.2). |
| `variants[]` | `[{ id, weight, content, platform_overrides: { ios?, android?, web? } }]`. Content follows §6.3. |
| `fallback` | `{ layout?, content? }` or `skip`, for clients that don't support the layout (§6.4). |
| `in_app_rules` | `{ trigger: {event, filters}, delay_ms, calm_moment: true, max_per_session: 1 }` |
| `card_rules` | `{ dismissible, pinned, expires_at, show_after_dismiss_hours: null }` |
| `push_rules` | `{ interruption_level: passive\|active (marketing never time_sensitive), android_channel, collapse_key, ttl_hours, image, buttons[] (pre-registered categories only) }` |
| `email_rules` | `{ from_name, subject, preheader, template: 'shell_v1' }` |

### 3.3 Lifecycle and safety

- **Launch checklist** (server-side, blocking):
  - every variant passes schema validation;
  - every platform the audience targets has content, or the fallback is `skip`;
  - personalization tokens have defaults;
  - deep links resolve to allowlisted screens;
  - images meet the size rules;
  - push has consent rules satisfied for its category;
  - `max_audience` is set;
  - a dry run has been done (audience count plus 20 sample users with their rendered content).
- **Approval:**
  - Required when the estimated audience exceeds `ENGAGE_APPROVAL_THRESHOLD` (default 1,000), the campaign pushes to "everyone", or it's an email campaign.
  - The approver must be a different person from the editor.
  - Any edit after approval resets it.
- **Kill switches:**
  - `ENGAGE_ENABLED` turns off all Engage delivery; clients get empty payloads.
  - `ENGAGE_SENDS_ENABLED` turns off push, email and web push only.
  - Each campaign has a **Pause** button that takes effect within one sync, about 15 minutes, or immediately on the next fetch.
- **Audit log:** every create, update, launch, pause, approval and test send goes to `engage_audit_log`, recording the actor from `X-Admin-Actor`.

---

## 4. Surfaces

### 4.1 Push
See §8 (send pipeline) and §10 (consent and caps).

**Content:** title (≤ 50 chars recommended, 110 maximum), body (≤ 178), optional subtitle (iOS), image (iOS through the existing `FitCircleNotificationService`; Android rendering needs a new BigPicture style, see the plan), a deep link to an allowlisted screen with parameters, optional action buttons (only pre-registered categories), `interruption_level`, and an Android channel.

### 4.2 Feed cards: the home feed (absorbs promo@1)
- An Engage `feed` message becomes a **card source inside `composeFeed`**. It is emitted as card type `promo`, version 2 (`promo@2`), which is a superset of `promo@1` (§6.3). Clients that support only promo@1 receive a version down-converted to promo@1 when the layout and actions allow it; otherwise the fallback applies.
- **Priority and position.** An Engage card enters with `priority` and an optional `slot_hint`: `top` (directly under the header), `upper` (within the first 4 cards) or `any`. The existing feed guardrails always win: at most 2 promo-category cards, at most 1 in the first 4, and none adjacent.
- **System promos become Engage campaigns.** The four in-code `SYSTEM_PROMOS` (`first_meal`, `log_meal_now`, `pro_value`, `meet_fitzy`) are migrated into Engage campaigns marked `system: true`. They're editable in the tool; their audience predicates move into the segment language (§5.2, journey fields). `promo_user_state` stays the per-user state store for feed cards. It's renamed in the UI only and gains `campaign_id` and `variant_id` columns.
- **The existing campaign card** (Experience) stays a first-party feed card. An Experience can be promoted or suppressed from the tool through feed rules (§4.4).

### 4.3 Placements (outside the home feed)
- These are fixed native slots. Each declares `max_shown`, its allowed layouts and the size class (§6.2).
- Placements in v2:

| Placement | Where | Max shown | Layouts |
|---|---|---|---|
| `circles_top` | Circles tab, above the list | 2 | banner, card |
| `profile_top` | Profile tab | 1 | banner, card |
| `post_checkin` | Check-in celebration | 1 | banner |
| `food_log_top` | Food log, above the day | 1 | banner |
| `fitzy_top` | Fitzy chat empty state | 1 | card |
| `paywall_footer` | Under the plan list, only for contexts whitelisted in code | 1 | banner (text only) |

- **Large layouts** (iPhone Duo inner screen ≥ 600 pt; Android rail or sidebar ≥ 600 dp): placements render inside the content pane at readable width. They never open as a sheet.
- Delivered by `GET /api/mobile/engage/sync` (§11.1). Impressions count when at least 50% of the item is visible for at least 1 second.

### 4.4 Home feed rules UI (absorbed)
The tool gets a **Feed** page that edits `home_feed_rules`: move, hide, show, variant and boost, with the same audience language. Today these rules are curl-only. Rules and Engage cards share the preview (§13).

### 4.5 In-app messages
- **Layouts:** `modal`, `slideup`, `fullscreen` and `sheet` (a native bottom sheet on phones; on large layouts it renders as a pane cover on iOS and a dialog in the content pane on Android).
- **Triggers are evaluated on the device** against the triggers listed in `/engage/sync`, so they work offline. The server re-checks eligibility on the next sync. Display rules:
  - Only one in-app message at a time.
  - At most `max_per_session` per message (default 1).
  - At least 30 seconds between any two in-app messages (`ENGAGE_IAM_MIN_INTERVAL_S`).
  - At most 2 per 24 hours globally (`ENGAGE_IAM_DAILY_CAP`).
  - The highest `priority` wins when several messages match the same trigger.
- **Calm moments.** A message never shows over:
  - onboarding;
  - the paywall;
  - Meet Fitzy, the post-aha paywall, or the campaign info sheet;
  - referral celebrations;
  - ATT, the review prompt or the biometric lock;
  - the camera or meal analysis review;
  - an active text field.

  If the trigger fires during a blocked moment, the message waits up to 60 seconds for a calm one, then drops. iOS gets its signal from `AppFeature` presentation state plus `PaywallPresenter`; Android from `JourneyHost` plus a new `EngageBusy` registry.
- **Paywall throttle.** An in-app message whose primary action is `paywall` respects the existing `PaywallAutoThrottle` and the journey `autoEligible` gate.

### 4.6 Email
- Sent through Resend (`RESEND_API_KEY` is already set), from `FitCircle <team@fitcircle.ai>`.
- Uses the shared shell template (`shell_v1`, the referral and campaign shell), with `List-Unsubscribe` and one-click unsubscribe (HMAC token, reusing `/api/campaigns/unsubscribe`).
- Consent is checked through the unified consent view (§10.1).
- Limited to `ENGAGE_EMAIL_RATE_PER_MIN`.

### 4.7 Web
- **Web dashboard:** renders the `feed` cards (promo@2 web renderer) and the `profile_top` and `circles_top` placements where those pages exist, plus in-app messages (modal, slideup) through `WebEngage`. The tool's preview uses the same React renderers (§13), so the web preview is exact.
- **Web push is P2.** It needs VAPID keys, a real `sw.js` push handler, `push_tokens.platform = 'web'` registration, and iOS Safari home-screen web app support. Declarative Web Push is possible on Safari 18.4+.

---

## 5. Targeting

### 5.1 Audience language
A single tree replaces the three existing audience formats: feed-rule `audience`, promo `audience` and experiment `audience`. Each of those gets an adapter during migration.

```
Audience := { all: Node[] } | { any: Node[] } | { not: Node } | Condition
Condition := { field, op, value? }
op ∈ eq, neq, in, not_in, gt, gte, lt, lte, between, exists, not_exists,
     contains (lists), version_gte, version_lt, version_between,
     within_last (duration), not_within_last, count_gte / count_lte (events: {event, window, filters})
```

### 5.2 Fields (v2 catalogue)

| Group | Fields | Source |
|---|---|---|
| Device / app | `platform`, `app_version`, `app_build`, `os_version`, `device_model`, `locale`, `language`, `timezone`, `push_permission` (granted/provisional/denied/not_determined), `android_channel_enabled.<id>`, `att_status`, `client_features` | `engage_devices` (§5.3); "any device" or "most recent device" semantics are selectable |
| Geo | `country` (IP at last session; profile override), `region` | `engage_devices.country`, `profiles.country_code` |
| Account | `days_since_signup`, `signup_platform`, `signup_method`, `email_verified`, `is_test`, `is_internal` | `profiles`, test-user list |
| Subscription | `sub_state` (free/trial/pro/lapsed/grace/complimentary), `sub_platform`, `sub_product`, `trial_ends_in_days`, `pro_since_days`, `will_renew` | `profiles.subscription_*`, `complimentary_grants`, trials (migration 112) |
| Activity | `last_active_days`, `sessions_7d`, `meals_logged_total`, `meals_logged_7d`, `checked_in_today`, `current_streak`, `longest_streak`, `streak_at_risk`, `water_logged_today`, `workouts_7d` | `engage_user_facts` (§5.4) |
| Social | `has_circle`, `circle_count`, `in_circle_with_friend`, `invites_sent_total`, `referral_qualified_count` | facts |
| Journey | `fitzy_opened`, `meals_ever`, `slots_logged_today`, `onboarding_goal`, `persona`, `health_connected` | `profiles` and journey fields (promo@1 parity) |
| Experiences | `experience_joined:<slug>`, `experience_phase:<slug>` | `campaign_participants` |
| Attribution | `acq_channel` (apple_ads/google_ads/meta/organic/invite), `acq_campaign_id` | `user_attribution` |
| Consent | `marketing_push_opt_in`, `marketing_email_opt_in`, `category_enabled.<cat>` | §10.1 |
| Events | `count(event, window, prop filters)`, `last(event)` | `engage_events` plus domain tables (§7) |
| Engage history | `received(campaign)`, `clicked(campaign)`, `converted(campaign)`, `in_control(campaign)` | `engage_sends`, `engage_events` |
| Experiments | `experiment_arm:<key>` | `experiment_assignments` |
| Buckets | `random_bucket` (0–99, salted per campaign or global), `user_ids[]` | hash |

### 5.3 Device registry (new; required for version and OS targeting)
- `engage_devices`:
  - columns: `user_id`, `install_id` (a random client UUID, stable for the install), `platform`, `app_version`, `app_build`, `os_version`, `device_model`, `locale`, `timezone`, `country`, `push_token_id`, `push_permission`, `channels_enabled jsonb`, `att_status`, `client_features[]`, `first_seen_at`, `last_seen_at`;
  - unique key on (`user_id`, `install_id`).
- **Written by** `POST /api/mobile/engage/session`, on app foreground at most once per 30 minutes and whenever the push permission changes. Country comes from `x-vercel-ip-country`.
- **Also replaces two gaps:** `push_tokens` has no version information, and `profiles.last_active_at` isn't maintained. The session endpoint also updates `profiles.last_active_at`.

### 5.4 Facts table (fast segments)
- `engage_user_facts (user_id PK, … columns from §5.2 Activity/Social/Journey, updated_at)`.
- **Recomputed** every 5 minutes for users active in the last 24 hours, and fully every night (cron `engage-facts`), by set-based SQL in TypeScript services. No triggers.
- **Segment compiler.** Turns the audience tree into one parameterized SQL query over `profiles ⨝ engage_user_facts ⨝ latest engage_devices`, with event-count conditions as `EXISTS` / `COUNT` subqueries on indexed `engage_events (user_id, name, occurred_at)`. Replaces v1's evaluation in Node memory.
- **Estimates** are an exact `COUNT(*)` up to 200k users (a few hundred milliseconds with indexes), debounced at 500 ms in the editor.
- **Materialized segments** (P1): `engage_segment_members(segment_id, user_id, added_at)`, refreshed on a schedule for heavy segments. Joining or leaving a segment can trigger journeys.

### 5.5 Test and internal users
- Test accounts (the existing test-user list and the `is_test` attribution flag) are excluded from every audience unless the campaign is in test mode.
- **Preview users:** a per-campaign list (replacing `preview_user_ids` and the experiment overrides for Engage) who see the message regardless of targeting, caps or schedule. Shown with a "Preview" ribbon in debug builds only.

---

## 6. Content schema and native layouts

### 6.1 Principles
- **Native rendering only.** Content is structured data, never markup or code (App Review 2.5.2).
- **Design language.** Icon keys, never emoji, through `X-Client-Features: icon_keys`. Colour comes from **semantic tokens** (`surface`, `accent`, `pro_gold`, `fitzy`), never hex. The brand gradient is allowed only on the single primary CTA. Sentence case. Dynamic Type and the M3 type scale. Dark-first. No fabricated stats or social proof: the tool blocks numeric claims that aren't personalization tokens.
- **Accessibility:**
  - every image needs alt text, or must be marked decorative;
  - the slide-up never auto-dismisses while VoiceOver or TalkBack is running;
  - Reduce Motion is respected;
  - minimum touch target is 44 pt / 48 dp.

### 6.2 Layout catalogue (engage@1)

| Surface | Layouts | Notes |
|---|---|---|
| feed (promo@2) | `hero`, `banner`, `compact`, `captioned_image`, `image_only`, `carousel` (P1) | hero, banner and compact are promo@1-compatible |
| placement | `banner`, `card` | Per-placement allowlist (§4.3) |
| in_app | `modal`, `slideup`, `fullscreen`, `sheet` | Large layout uses pane presentation |
| push | `standard`, `image`, `actions` | |
| email | `shell_v1` | |

### 6.3 Content object (one shape for all layouts; each layout uses a subset)
```
content = {
  eyebrow?: ≤ 24, title: ≤ 60, body?: ≤ 240, badge?: ≤ 20,
  icon?: { key },                                  // design/icons.json key
  image?: { assetId, darkAssetId?, aspect: '16:9'|'1:1'|'4:5'|'9:16', focal?: {x,y}, alt?, decorative? },
  countdown?: { to: ISO, label?: ≤ 24, hide_after: bool },
  theme: 'default'|'accent'|'pro'|'fitzy'|'experience:<slug>',
  primary?: Button, secondary?: Button,
  dismissible: bool,
  footnote?: ≤ 120                                  // legal / price disclosure
}
Button = { label ≤ 24, action: Action, style?: 'primary'|'secondary'|'link' }
Action = one of (existing promo@1 registry, versioned):
  open_screen {screen, params}   · paywall {context}   · invite · start_circle
  join_campaign {slug}           · log_water           · enable_notifications
  request_push_permission (P1, soft-ask first) · open_url {https, allowlisted host}
  dismiss · track {event} (P1) · fitzy {prompt} · experience {slug}
```
- **Personalization:** `{{first_name | default: "there"}}`, `{{streak}}`, `{{circle_name}}`, `{{days_left:<slug>}}`, `{{meals_left_today}}`, `{{plan_price:<product>}}` (the localized store price, filled on the client). Rendering happens on the server, except for client-only tokens. An `abort_if_missing` flag skips the user instead of using the default.
- **Localization:** variants carry a `locale → content` map. The fallback chain is the user's locale, then the language, then `en`.

### 6.4 Capability negotiation and compatibility
- **Clients declare support** on `/engage/sync` and the home feed with:
  - `X-Client-Features: icon_keys,engage@1`;
  - `layouts=` (for example `modal@1,slideup@1,…`);
  - `actions=`;
  - `placements=`;
  - `promo@2` in `cards=`.
- **The server sends only what the client declared.** Otherwise it applies the message's fallback (a simpler layout, promo@1 down-conversion, or `skip`).
- **The tool shows a compatibility report** for every message, for example: "iOS ≥ 1.2.0 native · iOS 1.1.x promo@1 fallback · iOS ≤ 1.0.9 not shown · Android ≥ vc 41 native …". It's computed from the latest declared capabilities in `engage_devices`, with live install counts per bucket.
- **Contract tests.** Replay tests check payloads against fixtures from shipped clients, the same pattern as the food-log contract, so older apps never break.

---

## 7. Events and triggers

- **Client events → Engage:** an allowlist of the tracking-plan events that matter for triggers and goals. Clients send them to `POST /api/mobile/engage/events` in batches of up to 50, at least every 30 seconds and on background. The batch is validated against the tracking plan, so there are no free-form names.
  - Initial set: `app_open`, `screen_viewed{screen}`, `meal_logged`, `water_logged`, `workout_logged`, `checkin_completed`, `streak_milestone{days}`, `paywall_viewed{context}`, `paywall_dismissed`, `purchase_completed{product}`, `trial_started`, `circle_created`, `circle_joined`, `invite_shared`, `fitzy_opened`, `push_permission_responded{granted}`, `ai_limit_reached`, `experience_joined{slug}`.
  - These are the same events as in Amplitude: the analytics facade forwards them, as `EngageAppEventBridge` did in v1.
- **Server-side domain events** (purchases from RevenueCat and Stripe webhooks, streak claims, referral qualification) are written to `engage_events` by the services that already handle them. No database triggers.
- **Trigger types:**
  - in-app (evaluated on the device);
  - triggered push and email (server; evaluated as the event is ingested, with an optional delay through the dispatcher);
  - journey entry (§9);
  - segment enter or exit (P1, from materialized segments).
- **Retention:**
  - `engage_events` raw rows are kept 90 days. A daily rollup feeds `engage_user_facts` and the stats tables. A cleanup cron deletes older rows.
  - `home_feed_decisions` also gets its 90-day cleanup, which it currently lacks.

---

## 8. Send pipeline (push, email, web push)

1. **Planner** (`/api/cron/engage-dispatch`, every minute):
   - picks due scheduled and recurring campaigns and due journey steps, using `FOR UPDATE SKIP LOCKED` on `engage_schedule` and `engage_journey_state`;
   - for local-time sends, pre-computes `send_at_utc` per timezone bucket;
   - spreads quiet-hours releases with ±20 minutes of jitter.
2. **Audience resolution:** the segment SQL runs paged by keyset (`user_id > last`), never by offset, in pages of 1,000.
3. **Per-user job** (in batches of 500, through a Postgres job table drained by the dispatcher; Vercel Queues is an option once out of beta):
   1. variant or control assignment (sticky);
   2. consent check;
   3. global caps (§10.2);
   4. render;
   5. **insert the ledger row `engage_sends` with status `pending`**;
   6. `NotificationOrchestrator.send('engage', …)`;
   7. **update the status** to `sent`, `suppressed:<reason>` or `failed:<reason>`.

   This fixes a v1 bug. Users suppressed for quiet hours or caps are retried at the next eligible window when `retry_suppressed` is set (the default for scheduled sends), up to `end_at`. Users suppressed for consent are never retried.
4. **Idempotency:** unique key on (`campaign_id`, `message_id`, `user_id`, `occurrence_key`). The occurrence key is the date for recurring campaigns and the step plus entry for journeys.
5. **Throughput:**
   - `ENGAGE_PUSH_RATE_PER_MIN` (default 2,000), `ENGAGE_EMAIL_RATE_PER_MIN` (default 200);
   - each run is limited to 250 seconds and resumes from a cursor;
   - at most one broadcast runs per campaign at a time.
6. **Token hygiene:**
   - mark `push_tokens.is_active = false` on APNs 410 / `BadDeviceToken` and FCM `UNREGISTERED`;
   - expire tokens not seen for 270 days;
   - `engage_devices.push_permission` is the source of truth for reachability.
7. **Open tracking:** the apps call `POST /api/mobile/engage/events {push_opened, send_id}`, which fills `notification_log.opened_at` as well. Neither app records opens today.

**Push payload keys** added through the orchestrator: `engageSendId`, `engageCampaignId`, `variantId`, `screen`, `params`, `image_url`, `buttons`. **Android drops unknown keys today** (`NotificationDeepLink.ALLOWED_DATA_KEYS`), so the first Engage-capable Android release must allowlist these. Older Android builds still open the app on the deep-linked `screen`, which is already allowlisted, so pushes stay usable.

---

## 9. Journeys (P1)

- **Steps:**
  - `message` (any surface);
  - `delay` (duration, or "until local time HH:MM");
  - `branch` (audience condition, or "did event X since entry", true or false);
  - `split` (random %, for experiments);
  - `exit`.
- **Entry:** an event trigger, entering a segment, an API call, or a schedule.
- **Exit:** on the goal event, on a matching exit condition at any step, or after `max_duration`. Re-entry is controlled by a `reentry_after_hours` setting.
- **State:** `engage_journey_state(user_id, campaign_id, entry_id, step_id, next_run_at, entered_at, exited_at, exit_reason)`, indexed on `next_run_at`. The dispatcher advances it. Vercel Workflow isn't needed at this scale.
- **Editor:** a vertical list with indented branches, not a free canvas.
- **First journeys to build:** they replace the dead `notification-crons.ts` ladder (day 1 with nothing logged, day 3 circle invite, dormant 7/14/30 days, win-back at 60 days, weekly summary).

---

## 10. Consent, caps and policy

### 10.1 Consent (one view over existing stores)
- **Marketing push (App Review 4.5.4):** requires explicit opt-in shown in our UI, plus an in-app opt-out.
  - New column `notification_preferences.marketing_enabled`, default **false**. A new **"Tips & offers"** toggle in notification settings sets it, along with an opt-in prompt at the right moment: a soft-ask card or modal that Engage itself can deliver.
  - We store `marketing_opt_in_at`, the consent text version and the source.
- **Category rules for push:**

| Category | Rule |
|---|---|
| `marketing` | Requires `marketing_enabled` |
| `lifecycle` (reminders, journey nudges about the user's own data) | Uses the existing category toggles: journey, momentum, coach, circle, challenge, social, celebration |
| `transactional` | Always allowed, cap-exempt; only for system and account messages, and requires approval |

- **Email:** a consent view `engage_consent_v` merges `profiles.preferences.marketingEmails`, `user_consent(marketing)`, `privacy_settings.marketing_enabled` and `referral_email_optouts`. The most restrictive setting wins, and an unsubscribe writes to all four.
- **Health data:** lock-screen text must not contain health specifics such as weight or calories in marketing pushes. The tool's linter warns.
- **GDPR and CCPA:** Engage rows (events, sends, devices, journey state) are included in account deletion and data export (`/api/mobile/account` delete and export paths).

### 10.2 Global caps (shared with the orchestrator)

| Rule | Default |
|---|---|
| Daily push cap (all types except exempt) | 3 per local day (existing) |
| Marketing push cap | 2 per local week · 1 per local day (`ENGAGE_MARKETING_PUSH_*`) |
| In-app messages | 1 per session · 2 per 24 h · 30 s minimum interval |
| Feed cards | Feed guardrails (§4.2) |
| Email marketing | 2 per week |
| Quiet hours | Existing per-user window. Engage messages are held and released with jitter. |
| Per-campaign override | `respect_global_caps = false` needs an approver and is logged |

**Global control group (P1):** a stable 5% of users never receive `marketing` campaigns. Lifecycle and transactional messages are unaffected. It measures total program lift.

---

## 11. APIs

### 11.1 Mobile (Bearer token; web uses the cookie)
- `GET /api/mobile/engage/sync?placements=…&layouts=…&actions=…` returns:
  ```
  { schema:1, fetched_at, ttl_seconds:900,
    in_app: [{ send_id?, campaign_id, message_id, variant_id, layout, content, trigger, priority, expires_at, frequency }],
    placements: { <id>: [{ … card … }] },
    prefetch: [AssetRef], caps: { iam_daily, iam_min_interval_s }, control: [campaign_id …] }
  ```
  The response is `no-store`. Exposures (including control) are logged once per user and message, in bulk.
- `POST /api/mobile/engage/events`: `[{ type: impression|click|dismiss|trigger_fired|push_opened|conversion|app_event, campaign_id?, message_id?, variant_id?, send_id?, name?, props?, occurred_at }]` (up to 50).
  - Impressions and clicks are accepted only for messages delivered to this user, checked against `engage_exposures` or `engage_sends`. This fixes v1's spoofing.
  - Timestamps are clamped to the server time ± 24 h.
- `POST /api/mobile/engage/session`: upserts the device registry (§5.3).
- The home feed is unchanged, apart from the Engage card source and `promo@2`.

### 11.2 Admin (`requireAdmin`; through the Admin Tools proxy whitelist)
- **Campaigns:**
  - `/api/admin/engage/campaigns`: list and create.
  - `/:id`: get, update, version.
  - `/:id/{submit, approve, reject, launch, pause, resume, archive, duplicate}`.
  - `/:id/dry-run`, `/:id/test-send`, `/:id/preview?user=&platform=&locale=&variant=&theme=`, `/:id/stats`, `/:id/compat`.
- **Segments:** `/segments` (CRUD), `/segments/estimate`, `/segments/:id/sample`.
- **Assets:** `/assets` (upload, list, archive, usage).
- **Feed rules:** `/feed-rules` (wraps `/api/admin/home-feed/rules`) and `/feed/preview?user=`.
- **Other:** `/placements` (the catalogue, read-only), `/events/catalog` (the trigger and goal event catalogue from the tracking plan), `/audit`, `/overview`.

---

## 12. Data model (migration 117+, schema only, idempotent, row-level security on with service-role access only)

| Table | Purpose |
|---|---|
| `engage_campaigns` | §3.1, including `version`, `status` and the audit columns |
| `engage_campaign_versions` | An immutable snapshot of each launched version |
| `engage_messages` | §3.2 |
| `engage_segments` (+ `engage_segment_members`, P1) | Saved audiences |
| `engage_assets` | From v1 unchanged, plus `usage` computed by SQL; the bucket gets a size limit and allowed MIME types |
| `engage_devices` | §5.3 |
| `engage_user_facts` | §5.4 |
| `engage_events` | Raw events; monthly partitions or a 90-day cleanup; index (`user_id`, `name`, `occurred_at`) |
| `engage_exposures` | First delivery per user and message (control included). Unique (`user_id`, `message_id`, `version`) |
| `engage_sends` | Push, email and web push ledger (§8); index (`user_id`, `channel`, `sent_at`) |
| `engage_dismissals` | Card and in-app dismissals |
| `engage_schedule` | Due work items for the dispatcher |
| `engage_journey_state` | §9 |
| `engage_stats_daily` | Rollup by campaign, message, variant, platform and day: sends, impressions, clicks, dismissals, conversions, unique users |
| `engage_audit_log` | Actor, action, before and after |
| `engage_consent_v` (view) | §10.1 |
| Changes to existing tables | `notification_preferences.marketing_enabled` and `marketing_opt_in_at`; `promo_user_state.campaign_id` and `variant_id`; `campaigns.platforms` (from v1) |

Prod already applied 104–116 except 104, which is v1 Engage, and v1 was never applied. v1's tables are reused where they fit (`engage_assets`, `engage_exposures`, `engage_dismissals`), renumbered into the new migration.

---

## 13. The tool (see `ENGAGE_TOOL_HOSTING.md` for where it lives)

**Pages:**
- **Overview:** live campaigns, today's sends, top movers, warnings such as low coverage, caps hit and failed sends.
- **Campaigns:** list with filters for status, surface, tag and Experience.
- **Composer.** Steps: Basics → Audience → Messages (per surface) → Schedule/trigger → Goal and experiment → Review (checklist, compatibility, dry run) → Submit or Launch.
- **Journeys** (P1).
- **Segments:** builder with a live count, sample users, and where each segment is used.
- **Assets:** drag-and-drop library from v1.
- **Feed:** rule editor and "preview the feed as a user".
- **Experiences:** the existing campaigns module, linked.
- **Analytics** (§14).
- **Settings:** caps, quiet-hours defaults, approval threshold, test devices, roles.
- **Audit log.**

**Preview, three tiers:**
1. **Instant preview (default).** React renderers for every layout:
   - The **web renderer is the production web component**, so the web preview is exact.
   - **iOS and Android previews** are faithful re-implementations in device frames: SF Pro and Roboto, real tokens, safe areas, Dynamic Type at default, large and XXL, light and dark, Duo inner screen and Android foldable widths. They reuse and extend `inov8r-admin/components/modules/campaigns/preview/native/{ios,android}.tsx`.
   - Toggles: platform, locale, theme, text size, device class, variant, **"render as user"** (server-rendered personalization and eligibility trace: "would see / would not see because …").
   - The previews are labelled "approximation · use Test send for the real render".
2. **Test send to a device (ground truth).**
   - Pick a test device from `engage_devices` registered to an admin. The server creates a forced delivery: the push is sent for real, and in-app messages and cards are delivered through a silent push.
     - iOS uses a `content-available` background push to trigger `/engage/sync`.
     - Android uses an FCM data message.
   - The message shows within seconds with a "Test" ribbon.
3. **Native snapshot gallery (P2).**
   - CI renders every layout × theme × text size × device class with the real SwiftUI views (the existing snapshot harness) and Compose views (Roborazzi).
   - The images are published to the tool as the "reference renders" for each app version.
   - It's also the release gate for layout changes.

**Roles:** `viewer`, `editor`, `approver`, `admin`. They're stored in Admin Tools config (per module, keyed by email) and enforced in the backend through `X-Admin-Actor` → `engage_roles`.

---

## 14. Analytics

- **Per campaign, message, variant, control, platform and day:**
  - sent (and suppressed, by reason), delivered (where known), impressions, unique viewers, clicks, CTR, dismissals;
  - push opens;
  - goal conversions within the window (each user counts once per goal per campaign), conversion rate;
  - lift vs control, with a 95% confidence interval;
  - revenue (net) from `subscription_events` within the window (P1).
- **Significance:** two-proportion z-test against control and a χ² test across variants, as Braze does. At our scale the tool shows confidence intervals and "not enough data" until there are ≥ 100 conversions per arm. It never auto-promotes a winning variant.
- **Storage:** stats come from SQL rollups in `engage_stats_daily`, refreshed every 15 minutes, plus live counts for today, never by loading raw rows into Node (a v1 performance issue).
- **Amplitude:** clients already emit `Engage Message Viewed`, `Clicked` and `Dismissed`. Add `Engage Push Opened` and `Engage Conversion` to tracking plan v17+, and regenerate the code for iOS, Android and web.
- **Ads Console tie-in:** campaigns tagged `acq_*` can be filtered by `acq_channel` cohort.

---

## 15. Performance and operational targets

| Item | Target |
|---|---|
| `/engage/sync` p95 | < 250 ms (cached segment membership per user for 5 min) |
| Home-feed overhead from the Engage source | < 40 ms p95, inside the 250 ms context budget |
| Segment estimate (100k users) | < 2 s |
| Broadcast of 100k pushes | < 60 min at default rate |
| Event ingestion | 50 events per call, idempotent on (`install_id`, `client_event_id`) |
| Data retention | events 90 d raw, rollups forever; `engage_sends` 400 d |

**Observability:**
- Sentry spans on dispatch and sync.
- Vercel cron monitors.
- An Admin Tools health panel: last dispatch run, queue depth, failure rates, token invalidations.

---

## 16. What Engage replaces or absorbs

| Today | After Engage |
|---|---|
| `SYSTEM_PROMOS` in code (promo@1), with no authoring UI | Engage `feed` campaigns (`system: true`), editable |
| `campaigns.notifications[]` / `emails[]` plus hourly campaign cron with `all\|participants\|reminders` audiences | Engage campaigns linked to an Experience, with real segments. The campaign cron keeps only Experience mechanics. |
| Home-feed rules (curl only) | Tool → Feed page |
| Three audience formats + three QA mechanisms | One audience language (§5.1) + preview users / test send |
| Dead journey ladder in `lib/cron/notification-crons.ts` | Engage journeys (§9) |
| Duplicate campaign editor in `FitCircleBE /admin/campaigns` | Removed. Admin Tools is the only place to edit. |
| Hard-coded marketing push copy (trial reminder, `fitzy_intro`, meal-reminder copy) | Optional: Engage-managed copy with the triggers and caps kept in code (P2) |

---

## 17. Open decisions (need the owner's call; recommended answer in **bold**)

1. **Tool hosting:** standalone `engage.inov8rlabs.com` vs a module in Admin Tools. **Recommendation:** one codebase in `inov8r-admin`, served at its own domain `engage.inov8rlabs.com` with focused navigation and an app switcher (FitCircle, BuyForBaby, TripWiz), linked from Admin Tools. See `ENGAGE_TOOL_HOSTING.md`.
7. **Multi-app architecture:** **a shared protocol, engine and SDKs (`inov8r-engage`), with Engage tables inside each app's own database and per-app adapters**, rather than a central Braze-style service. See `ENGAGE_MULTITENANCY.md` §3–4.
8. **Build FitCircle inside the library boundary from day one:** **yes**. It adds about 25–30% to the FitCircle MVP, and BuyForBaby and TripWiz then take about 2 weeks each instead of about 6.
2. **Marketing push opt-in default:** **off until the user opts in** (required by App Review 4.5.4 for promotional pushes). Lifecycle pushes keep their current toggles.
3. **Rename seasonal "campaigns" to "Experiences" in the UI:** **yes** (the database stays as is).
4. **Web push in v2:** **no**, P2 after mobile.
5. **Email in the first release:** **yes, but approval is always required.**
6. **Global control group:** **5%, enabled with journeys (P1).**
