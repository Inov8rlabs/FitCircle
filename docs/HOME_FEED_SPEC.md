# Server-driven Home Feed — v1 contract

Status: build spec (2026-10-22). Owners: backend (`feat/home-feed` in FitCircleBE), iOS (`feat/108-feed`), Android (`feat/home-feed`).
Ships with iOS/Android 1.0.8. Shipped apps (iOS ≤ 1.0.7, Android ≤ 1.0.7) never call this endpoint and must be unaffected.

## 1. Principle

The server decides **which cards appear, in what order, and in which variant**. The apps keep rendering each card from their own code and data sources (exactly as today). The server never sends UI markup. This keeps the blast radius small: a bad rule can reorder or hide cards, never crash an app or show something it can't draw.

## 2. Endpoint

`GET /api/mobile/home-feed` (authenticated, same auth as other `/api/mobile/*` routes, `Cache-Control: no-store`).

Request headers:
- `X-Feed-Schema: 1` (required; the response schema version the client understands)
- `X-App-Platform: ios|android`, `X-App-Version: 1.0.8`, `X-App-Build: <int>` (already sent by apps where available)
- `x-client-timezone: <IANA>` (already sent)

Query:
- `cards` — comma-separated list of card types **and versions** the client can render, e.g. `cards=header@1,campaign@1,hydration@1,referral@1,pro_upsell@1,streak_warning@1,daily_goals@1,progress@1,vitals@1,body_comp@1,past_date_log@1,native_ad@1,charts@1,fitzy_focus@1,health_sync_banner@1,offline_banner@1`.
  Android 1.0.8 additionally declares `missing_days@1` (iOS 1.0.8 does not).
  The server only returns cards in this list (type match + `version <= client version`). Unknown → never returned.

Response `200`:
```json
{
  "schema": 1,
  "decision_id": "f3d1…uuid",
  "generated_at": "2026-10-22T21:30:00Z",
  "ttl_seconds": 900,
  "layout_key": "default-v1",          // which rule set / experiment arm produced it
  "experiment": { "key": "water_first", "arm": "treatment" },   // or null
  "cards": [
    { "id": "header",       "type": "header",       "version": 1 },
    { "id": "campaign:hold-the-line", "type": "campaign", "version": 1, "props": { "slug": "hold-the-line" } },
    { "id": "hydration",    "type": "hydration",    "version": 1 },
    { "id": "referral",     "type": "referral",     "version": 1, "variant": "compact" },
    { "id": "progress",     "type": "progress",     "version": 1 }
  ]
}
```
Card fields: `id` (stable per instance, used for dismiss/analytics), `type`, `version`, optional `variant` (string the client may ignore → default look), optional `props` (small JSON, type-specific, optional for every type; clients ignore unknown keys), optional `dismissible` (bool, default per card), optional `section` (`"top"` | `"main"`, default `"main"`, `"top"` renders in the collapsing header stack).

Errors: `401` as usual. Any `5xx`/timeout/decode failure → client uses its cached layout if fresh (≤ 24 h), else its built-in default. Never block the home screen on this call: render the cached/default layout immediately and apply the server layout when it arrives (no re-order flicker after first paint within a session: apply on next appearance or if the first response arrives < 400 ms).

Versioning: `schema` changes only for breaking response changes; servers keep serving every schema still used by a supported app version (`schema=1` until all apps ≥ the version that introduced 2). Adding a new card type or a new optional field is NOT breaking (clients declare support via `cards`).

## 3. Card catalog v1

Each card keeps its existing self-gating on the client (e.g. campaign card hides when no campaign; referral card hides when the program is off/dismissed). The server's job is ordering + eligibility hints; if the server lists a card the client finds nothing to show for, it renders nothing (collapses).

| type | today on iOS | today on Android | notes |
|---|---|---|---|
| `offline_banner` | OfflineBannerView | offline banner | always client-forced to top when offline (server can't know) |
| `header` | headerSection | header | always first (guardrail) |
| `health_sync_banner` | healthSyncBannerSection | HC banner | |
| `campaign` | CampaignHomeCard | CampaignHomeCard | `props.slug` optional (default: featured campaign) |
| `hydration` | HydrationCard | HydrationCard | |
| `referral` | ReferralHomeCard | ReferralHomeCard | |
| `pro_upsell` | ProUpsellCard | Pro card | |
| `streak_warning` | streakWarningSection | streak shield banner | |
| `missing_days` | — (not declared by iOS 1.0.8) | missing-days prompt ("you have unlogged days") | added 2026-10-22; Android only for now |
| `daily_goals` | widgetsSection | daily goals | |
| `progress` | simplifiedProgressSection | steps/weight cards | |
| `vitals` | vitalsSection (BMI) | vitals | |
| `body_comp` | bodyCompSection | body comp | |
| `past_date_log` | Log Data for Past Date | missing days / past log | |
| `fitzy_focus` | (dashboard focus) | FitzyHomeFocusCard | |
| `native_ad` | FitCircleNativeAdView | native ad | client still enforces ads eligibility |
| `charts` | chartsSection | charts | |

## 4. Default layout (also the clients' built-in fallback)

`offline_banner, header, health_sync_banner, campaign, hydration, referral, pro_upsell, streak_warning, missing_days, daily_goals, fitzy_focus, progress, vitals, body_comp, past_date_log, native_ad, charts`

With the guardrail below, when a campaign card is present the referral card moves after `progress` (the 1.0.7 behaviour), and hydration always sits directly above the referral card.

## 5. Server architecture

`apps/web/app/lib/home-feed/`:
- `catalog.ts` — card types, versions, default order, per-card static metadata (promo vs utility, dismissible default).
- `context.ts` — builds a `FeedContext` for the user cheaply (single round of parallel queries, all optional/fail-soft): has circle, circle size, active/featured campaign + phase, referral program state, pro/entitlement, streak at risk (no check-in today & local hour ≥ 18), local hour/weekday, platform/version, days since signup, water logged today, ads eligible.
- `candidates.ts` — eligibility: which catalog cards apply (filtered by client `cards`).
- `rankers/` — `Ranker` interface `rank(candidates, ctx) → ScoredCard[]`. `RulesRanker` (v1) evaluates rules from the DB; `DefaultRanker` = static default order. Future `ModelRanker` (ML) plugs in here; a `BlendRanker` can combine. Rankers are pure and unit-tested.
- `rules.ts` — rule schema (JSON): `{ id, enabled, priority, platforms?, minAppVersion?, maxAppVersion?, audience?: { percent?, bucketSalt?, pro?, hasCircle?, campaignPhase?, daysSinceSignupLt? ... }, actions: [ {op:"move", card, before|after|toTop|toBottom}, {op:"hide", card}, {op:"show", card}, {op:"variant", card, variant}, {op:"boost", card, by} ] }`. Deterministic bucketing by `hash(user_id + salt) % 100`.
- `guardrails.ts` — applied after ranking, always: `header` first; `offline_banner` handled by client; never two promo cards (`campaign`, `referral`, `pro_upsell`) adjacent; max 2 promos in the first 6 cards; `hydration` immediately above `referral` when both present; `native_ad` never in the first 3.
- `compose.ts` — orchestrates context → candidates → ranker → guardrails → response; generates `decision_id`; records the decision (async, fail-soft).
- Kill switches: env `HOME_FEED_ENABLED` (default on) and per-platform `HOME_FEED_PLATFORMS=ios,android`, plus a rule `minAppVersion`. When disabled the endpoint returns the default layout (still 200), so clients behave identically.

Storage (migration `106_home_feed.sql`, plain tables, **no stored procedures/triggers**):
- `home_feed_rules` (id uuid pk, key text unique, enabled bool, priority int, definition jsonb, created_at, updated_at, updated_by).
- `home_feed_decisions` (id uuid pk = decision_id, user_id, layout_key, experiment_key, experiment_arm, cards jsonb, platform, app_version, created_at) — retention 90 days (cleanup cron or note).
- `home_feed_events` (id bigserial, decision_id uuid, user_id, card_id, card_type, position int, event text check in ('impression','tap','dismiss','cta'), created_at).
- RLS: service-role only for rules/decisions; events inserted via API only.

Events API: `POST /api/mobile/home-feed/events` body `{ decision_id, events: [{card_id, card_type, position, event, at}] }` (batched, ≤ 50, fire-and-forget, 204). Clients ALSO send the same to Amplitude as `Home Feed Card Viewed/Tapped/Dismissed` with `decision_id`, `layout_key`, `position` (add to `analytics/tracking-plan.json` + codegen).

Admin: rules CRUD on the existing admin portal (admin.fitcircle.ai) behind admin auth: list/enable/disable/edit JSON with validation + a "preview layout for user X" endpoint `GET /api/admin/home-feed/preview?userId=…`.

## 6. Client architecture (both platforms)

- `HomeFeedLayout` model (schema 1) + `HomeFeedRepository`: fetch with the header/query above; cache last good response (per user) with `generated_at`/ttl; expose `layout` stream; fallback to built-in default (section 4).
- Dashboard renders `layout.cards` in order by mapping `type` → existing card view; unknown types skipped; duplicates ignored; `variant` passed when the card supports it.
- `offline_banner` forced first when offline; `header` forced first.
- Impression = card ≥ 50% visible for ≥ 1 s, once per decision per card; tap/dismiss/CTA from the card's own handlers. Batch to the events API (flush on background / every 20 s) and Amplitude.
- Feature flag: remote kill switch honoured via the server (disabled → default layout); a local DEBUG override to force default.
- Tests: decode (including unknown types/fields), fallback paths, ordering, impression de-dup, `cards` param contents.

## 7. Compatibility guarantees (checklist)

- New endpoint only; no existing route changes. Shipped apps unaffected.
- Contract tests on the server with fixtures of the exact iOS and Android 1.0.8 requests (headers + `cards` query) and response snapshot tests.
- Clients treat everything except `schema`, `cards[].id`, `cards[].type` as optional.
- Server never returns a card type the client didn't list.

## 8. Backend implementation notes (2026-10-22, `feat/home-feed`)

Clarifications made while building the server. All are backward compatible with §1–7; mobile teams should mirror the marked (★) ones.

- ★ **200 body is the bare schema-1 object above**, not the `{ success, data }` envelope (Android accepts both; iOS expects the bare object). Errors (`400`/`401`/`5xx`) use the standard envelope `{ success:false, data, error:{ code, message } }`.
- ★ **Validation errors (400)**: missing `X-Feed-Schema` → `FEED_SCHEMA_REQUIRED`; any value other than `1` → `UNSUPPORTED_FEED_SCHEMA` with `data.supported = [1]`; missing/empty/unparseable `cards` → `CARDS_REQUIRED`. Treat any 400 like a 5xx (cached/default layout) and log it — it is a client bug.
- ★ **Headers**: the server reads `X-App-Platform`, falling back to `X-Platform` (what Android's AuthInterceptor already sends). **iOS must add `X-App-Platform: ios`, `X-App-Version`, `X-App-Build` on this request** (iOS doesn't send them today); without them, rules gated on platform/version never apply (the user gets the default layout).
- `cards` parsing is lenient: whitespace trimmed, `type` without `@n` = version 1, malformed tokens ignored, duplicates keep the highest version, max 64 entries.
- ★ **Position of chrome cards**: `offline_banner` is index 0 and `header` index 1 when both are listed (guardrail G1 = "header first after the offline banner"). Guardrail positions (first 3 / first 6) are counted *without* `offline_banner`.
- ★ **Effective default layouts** (what the server returns with no rules, i.e. §4 after the guardrails; the clients' built-in fallback should be identical):
  - no campaign: `offline_banner, header, health_sync_banner, hydration, referral, streak_warning, pro_upsell, missing_days, daily_goals, fitzy_focus, progress, vitals, body_comp, past_date_log, native_ad, charts`
  - campaign present: `offline_banner, header, health_sync_banner, campaign, streak_warning, pro_upsell, missing_days, daily_goals, fitzy_focus, progress, hydration, referral, vitals, body_comp, past_date_log, native_ad, charts`
  (`pro_upsell` steps below `streak_warning` because promos may not be adjacent; with a campaign, hydration follows the referral card below `progress`. `missing_days` only appears for clients that declare it — Android; iOS gets the same lists without it.)
- Server eligibility hints only drop a card when the server *knows*: `campaign` when no campaign is visible, `referral` when the program is off, `pro_upsell` for Pro users / subscriptions off, `native_ad` for Pro users. Unknown (lookup failed/timed out) → the card stays and the client self-gates.
- `section` and `dismissible` are not sent in v1 (clients use their per-card defaults); `variant` only when a rule sets one; `props` only for `campaign` (`{ slug }`, id `campaign:<slug>`).
- Events: `at` is optional (stored as `occurred_at` when within the last 7 days); unknown extra fields are ignored; `event` ∈ `impression | tap | dismiss | cta` (clients send `impression`, `tap`, `dismiss` today; `cta` stays allowed for later). 1–50 events per call, else 400.
- ★ **`position`** (events API and Amplitude) = the card's 0-based index in the **resolved order before client-side collapse**: the order the client decided to render (server/cached/default layout, after the client's own forcing of `offline_banner`/`header` and dropping of unknown types/duplicates), counting cards that later collapse because they had nothing to show. It is *not* the visual index among visible cards.
- Amplitude (tracking plan v12): `Home Feed Card Viewed / Tapped / Dismissed`. Required: `card_type`, `card_id`, `position`, `layout_key`, `layout_source` (enum `home_feed_layout_source` = `server | cache | default` — where the rendered layout came from). Optional: `decision_id` (absent for the built-in default), `variant`, `experiment_key`, `experiment_arm`. Send `Tapped` for both `tap` and `cta`.

## 9. Operating the feed

### Kill switches (Vercel env, no deploy of the apps needed)

| Env var | Default | Effect |
|---|---|---|
| `HOME_FEED_ENABLED` | on | `0`/`false`/`off`/`no` → every request gets the static default layout (200, `layout_key: "default-v1"`, no context queries, no rules, no decision recorded). |
| `HOME_FEED_PLATFORMS` | unset (all) | e.g. `ios` → only iOS gets the server-driven layout; others (and requests with no platform header) get the static default. |
| `HOME_FEED_RULES_ENABLED` | on | `false` → context-aware default ranking, but every DB rule is ignored (use when a bad rule ships). |

Per rule: set `"enabled": false` (PATCH below), or gate with `minAppVersion` / `maxAppVersion` / `platforms`. Rules are cached per server instance for 60 s.

### Rule format

A rule is a `home_feed_rules` row: `key` (unique), `enabled`, `priority`, and `definition` (everything else). The admin API takes the flat form:

```json
{
  "key": "streak_rescue_evening",
  "enabled": false,
  "priority": 50,
  "description": "Evening, not checked in: streak warning right under the header.",
  "platforms": ["ios", "android"],
  "minAppVersion": "1.0.8",
  "audience": { "streakAtRisk": true },
  "actions": [{ "op": "move", "card": "streak_warning", "after": "header" }]
}
```

- `actions`: `{op:"move", card, before|after|toTop|toBottom}` (exactly one target), `{op:"hide", card}`, `{op:"show", card, version?}` (restores a hidden/hint-suppressed card; with `version` it can introduce a card type the server catalog doesn't know yet — still only returned to clients that list it), `{op:"variant", card, variant}`, `{op:"boost", card, by}` (score points; 10 = one slot; negative sinks).
- `audience` (all optional, AND-ed; an unknown context value never matches): `percent` + `bucketSalt` (rollout: `bucket < percent`), `pro`, `hasCircle`, `campaignPresent`, `campaignPhase` (string or list: `teaser | live | ended`), `referralProgramEnabled`, `checkedInToday`, `streakAtRisk`, `waterLoggedToday`, `daysSinceSignupLt`, `daysSinceSignupGte`, `localHourGte`, `localHourLt`, `weekdays` (0 = Sunday), `userIds` (≤ 500; for QA).
- `experiment`: `{ key, salt?, arms: [{ name, percent, actions, layoutKey? }] }` — arms fill buckets in order (sum ≤ 100; users past the last arm aren't enrolled). The response reports `experiment: {key, arm}` and `layout_key: default-v1+<key>.<arm>`. A rule has either `actions` or `experiment`, not both.
- `layoutKey` (optional) replaces the rule key in `layout_key` (`default-v1+<rule>`).
- Bucketing: `sha256("<salt>:<user_id>")` first 4 bytes mod 100; salt defaults to the experiment key (experiments) or rule key (`percent`). Changing a salt reshuffles users.

**Evaluation order**: matching rules apply in ascending `priority` (then key) — a higher priority applies later and wins conflicts. Hide/show/variant/boost are applied first, cards are sorted by score, then `move`s apply in rule order. Only one experiment per response: the highest-priority enrolled one; lower experiment rules are skipped for that user. Guardrails (§5) always run last and silently correct a rule that breaks them — notably **G4 keeps hydration directly above referral**, so to move hydration you must move referral with it (or hide referral).

### Example: `water_first` 50/50 (seeded DISABLED by migration 106)

```json
{
  "key": "water_first",
  "enabled": false,
  "priority": 100,
  "description": "50/50: hydration card directly under the header vs default order.",
  "platforms": ["ios", "android"],
  "minAppVersion": "1.0.8",
  "experiment": {
    "key": "water_first",
    "arms": [
      { "name": "treatment", "percent": 50, "actions": [
        { "op": "move", "card": "hydration", "after": "header" },
        { "op": "move", "card": "referral", "after": "hydration" }
      ] },
      { "name": "control", "percent": 50, "actions": [] }
    ]
  }
}
```

More examples:

```json
{ "key": "new_user_goals_first", "enabled": true, "priority": 10,
  "audience": { "daysSinceSignupLt": 7 },
  "actions": [{ "op": "move", "card": "daily_goals", "after": "header" }] }
```

```json
{ "key": "referral_compact_10pct", "enabled": true, "priority": 20,
  "audience": { "percent": 10 },
  "actions": [{ "op": "variant", "card": "referral", "variant": "compact" }] }
```

```json
{ "key": "hide_charts_android_108", "enabled": true, "priority": 0,
  "platforms": ["android"], "maxAppVersion": "1.0.8",
  "actions": [{ "op": "hide", "card": "charts" }] }
```

### Admin API (admin auth: `profiles.is_admin` session/token, or `Authorization: Bearer $ADMIN_API_SECRET`)

```bash
# List (includes valid:false + issues for rows that no longer validate)
curl -H "Authorization: Bearer $ADMIN_API_SECRET" https://www.fitcircle.ai/api/admin/home-feed/rules

# Create (new rules default to enabled:false). 400 with issues on invalid JSON, 409 on duplicate key.
curl -X POST -H "Authorization: Bearer $ADMIN_API_SECRET" -H 'Content-Type: application/json' \
  -d @rule.json https://www.fitcircle.ai/api/admin/home-feed/rules

# Enable / disable / re-prioritise / replace the definition (by key or id)
curl -X PATCH -H "Authorization: Bearer $ADMIN_API_SECRET" -H 'Content-Type: application/json' \
  -d '{"key":"water_first","enabled":true}' https://www.fitcircle.ai/api/admin/home-feed/rules

# Preview what a user would get right now (read-only; no decision recorded)
curl -H "Authorization: Bearer $ADMIN_API_SECRET" \
  "https://www.fitcircle.ai/api/admin/home-feed/preview?userId=<uuid>&platform=ios&version=1.0.8&includeDisabled=true"
```

Preview query: `userId` (required), `cards` (default: the full v1 catalog), `platform`, `version`, `build`, `timezone`, `includeDisabled=true` (evaluate disabled rules too — test a rule before enabling it). Response: `{ feed, killSwitch, context, trace: { ranker, appliedRules, suppressed, guardrailAdjustments, droppedUnsupported }, rulesEvaluated }`.

### Data

- `home_feed_decisions`: one row per served layout (id = `decision_id`), with `cards`, `applied_rules`, `experiment_*` and a coarse `context` snapshot (no health values) for analysis / future model training (`rankers/model-ranker.ts`).
- `home_feed_events`: impressions/taps/dismissals/CTAs; join on `decision_id`.
- Retention 90 days; no cleanup cron yet — purge with the SQL in the header of `supabase/migrations/106_home_feed.sql`.
- Experiment readout: `home_feed_decisions` grouped by `experiment_arm` ⨝ `home_feed_events` (CTR per card), or Amplitude `Home Feed Card *` split by `experiment_arm`.
