# Pro lifecycle prompts: "Pro is ending" / "Pro ended"

Status: BUILT 2026-11-04 on `feat/pro-ending-prompts` (backend + Admin Tools). Not deployed. No migration.

Server-driven, so shipped iOS / Android **1.1.0+** (they declare `promo@1` + `paywall@1`) get it with no app release.

## 1. States (server-side, per user — `lib/pro-lifecycle/state.ts`)

| State | Who | Card | Push |
|---|---|---|---|
| `pro_expiring` | Free Pro (referral weeks or a time-boxed complimentary grant) whose effective end (latest expiry across active grants) is within `hoursBefore` (48 h) | yes | `pro_expiring_reminder`: 10:00 local the day before, or right away if later (≥ 1 h left) |
| `pro_expired` | The latest non-revoked grant ended within `daysAfter` (7), no active grant, profile downgraded to free | yes | `pro_expired`: sent by the downgrade cron right after it ends the promo; quiet hours → the hourly cron retries for up to 36 h |
| `trial_expiring` | App Store / Play / web trial with renewal OFF, ending within 24 h | yes (off by default) | none (`trial_ending_reminder` already exists) |

Excluded: internal / test accounts (`ads/test-users.ts` rules), anyone who paid before (`trial_converted_at` or a real paid `subscription_events` row), live store subscribers, lifetime / "until revoked" grants. Between the expiry and the hourly downgrade the user still has Pro: no prompt.

"Trial available" = no `trial_started_at` and no real TRIAL purchase event: the copy then offers the 3-day free trial; otherwise it says "Get Pro" / "Keep Pro" with no "free".

## 2. Card (`promo@1`, `lib/pro-lifecycle/card.ts`)

- Promo keys `pro_expiring` / `pro_expired` / `trial_expiring` (card id `promo:<key>`), score 988: right under the header, above every other promo, so it wins G7 (max 2 promo cards) and G8 (max 1 in the first 4). Guardrails still run last.
- While it shows, `pro_value` and the legacy `pro_upsell` step aside (one paywall card at a time).
- Primary = `paywall@1` with `placement` `pro_expiring_card` / `pro_expired_card` / `trial_expiring_card`. No fallback: a client without `paywall@1` gets no card.
- Fixed style per state (theme gradient, icon key `hourglass` / `crown` + legacy glyph for pre-`icon_keys` builds); expiring states carry a `countdown` in the user's local wall time ("Pro ends in 1d 3h").
- Copy (Admin Tools): eyebrow, title, body, usage body (`{{usage}}`), CTA with trial, CTA without trial. Placeholders: `{{first_name}} {{period}} {{ends}} {{ended}} {{usage}}`. `{{usage}}` = real counts while Pro was on (AI-analyzed meals, meals, Fitzy chats, weekly plans); below the thresholds or too long → the value-prop body. Never estimated.
- **Card look (1.1.3+)**: `StateConfig.style` (optional; 1–3 A/B variants of surface + button style + eyebrow colour). It goes only to clients that declare `promo_style@1`. Absent means today's look, and the defaults are unchanged. 1.1.0–1.1.2 always draw today's white pill. While a test runs, the creative id gets `_s<variant>`. See `PROMO_BUTTON_STYLE_SPEC.md`.
- Dismiss = snooze `snoozeDays` (expiring 1, expired 3) through `promo_user_state` (cross-device). Converts on `subscription_started`.

## 3. Push

`ProLifecyclePushService` (hourly `/api/cron/pro-lifecycle` at :25, plus `notifyExpired` from `/api/cron/referrals`). Both types are transactional: cap-exempt, not blocked by a category toggle; the push master switch, quiet hours and dedupe apply. One push per (type, user, Pro end): `dedupeKey = <type>:<user>:<endsAt>` checked against `notification_log` with no time limit (a renewed referral end gets its own reminder). "10:00 local" uses `profiles.timezone`; quiet hours use the preference's own time zone, exactly like the orchestrator. Tap → `screen: dashboard` (Home, where the card is).

Dry run: `GET /api/cron/pro-lifecycle?dryRun=true` (or env `PRO_ENDING_PUSH_DRY_RUN=true`) reports who would get what and when, sends and writes nothing.

## 4. Config + kill switches

- `feature_flags` row `pro_lifecycle_prompts` (no migration): `is_enabled` = admin master switch, `metadata` = config (validated; invalid / missing → code defaults in `lib/pro-lifecycle/config.ts`). Cached 30 s per instance.
- Env `PRO_ENDING_PROMPTS_ENABLED` (default on; `false` = no cards, no pushes). Cards also need `PROMOS_ENABLED`.
- Audit: `experiment_audit_log`, key `config:pro_lifecycle_prompts`, action `config_publish` (before/after config, diff, summary, note, actor).

## 5. Admin Tools (Home feed → Pro lifecycle)

`/api/admin/home-feed/pro-lifecycle` (GET state), `/audience` (GET, who is in each state now), `/preview` (POST draft → each state's card in the persona's real feed + push, before/after), `/publish` (POST, optimistic concurrency on the content version `pl1-…`, 409 `STALE_DRAFT`), `/changes` (GET history). Admin-only (same gate as the home feed editor); exact routes are whitelisted in the Admin Tools proxy. The home feed editor's preview personas include `pro_expiring` / `pro_expired`. Look controls (PROMO_BUTTON_STYLE_SPEC §7): `GET` returns `states[].theme` + `styles` presets, preview takes `styleVariant` and returns `draft.warnings`, and the editor previews `1.1.3` (styled) against `1.1.2` (today's apps).

## 6. Analytics (tracking plan v26)

Paywall sources `pro_expiring_card` / `pro_expired_card` / `trial_expiring_card` (Android sends `promo:<source>`); card events = Home Feed Card / Promo Viewed / Tapped / Dismissed with `promo_id`; push opens = `Push Notification Opened {notification_type: pro_expiring_reminder | pro_expired}`; sends = `notification_log` (reserved name `Pro Lifecycle Push Sent`).
