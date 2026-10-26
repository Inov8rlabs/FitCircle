# Promo cards — server-driven creative + actions in the home feed

Status: **v1 BUILT 2026-10-26** (backend, behind `PROMOS_ENABLED`) per `ACTIVATION_JOURNEY_SPEC.md` §3/§8 + Appendix A — migration **110** (not 108); `promo_user_state` is keyed by `promo_key` and tracks `seen_days` (perWeek = distinct local days). Original status: DRAFT, parked 2026-10-23 — reviewed with the owner, to be picked up later. Nothing here is built yet. Next step: answer the §14 open questions, then plan the build (migration 108 is the next free number as of 2026-10-23; re-check before using it).
Builds on: `HOME_FEED_SPEC.md` (card ordering, rules, experiments, events) and `CAMPAIGNS_SPEC.md` (dated marketing moments, art, push/email, admin portal).

## 0. Summary

Today the home feed can *place* cards from the server, but what a promo *looks like* and what its button *does* is still hard-coded per template in each app. This spec makes the promo card fully server-driven:

- **Creative from the server**: layout, image, eyebrow, title, body, colours, badge, countdown, one or two buttons.
- **Actions from the server**: each button carries a typed action (`open_screen`, `paywall`, `invite`, `start_circle`, `join_campaign`, `log_water`, `open_url`, …) drawn from a versioned registry that every client declares support for.
- **Scheduling and targeting from the server**: monthly/seasonal campaigns and evergreen promos (Pro, invite friends, new features) share one pipeline with dates, audiences, frequency caps, dismissal, priorities and A/B variants.

One new home-feed card type, `promo@1`, carries the whole creative inline. Old apps never receive it (the feed only returns card types the client declares), so nothing shipped can break.

### Goals
1. Launch a monthly or seasonal promo (image + copy + CTA) without an app release.
2. Choose what the CTA does from a safe, finite list, with parameters.
3. Target, schedule, cap and A/B test promos with the existing rules engine.
4. Measure impressions → taps → completed actions per creative.
5. Look native and finished on iOS, Android and web, in both themes, with or without an image, with no layout shift.

### Non-goals
- Arbitrary server-rendered layouts or downloaded code (App Review 2.5.2 / Play policy). Clients only fill in native layouts they already ship.
- Replacing the rich campaign templates (`daily_calendar` doors, `seasonal_circle` wizard). They keep their `campaign@1` card; a campaign may *also* run plain promos.
- Push and email creative (already covered by CAMPAIGNS_SPEC §5–6).

## 1. What exists today, and the gaps

| Area | Today | Gap |
|---|---|---|
| Card content | `campaign@1` card → client fetches `/api/mobile/campaigns`, renders one of 3 templates (`seasonal_circle`, `daily_calendar`, `spotlight`) | Layout is fixed per template; only `spotlight` is a generic promo, and it allows only one CTA |
| Image | `art.inAppHero` 1200×675, otherwise a gradient + emoji | One aspect ratio; no dark-mode variant, focal point or alt text |
| CTA | 6 actions (`start_circle`, `open_calendar`, `invite`, `paywall`, `circles`, `open_url`), no parameters | Can't say *which* paywall offering, screen or water amount. **Shipped clients map an unknown action to the template's default action** (iOS `CampaignView` decoder; Android keeps the raw string), so a new action would silently do something else on old apps. |
| How many | Exactly one campaign card (`homeSlug`) | Can't run an evergreen promo (Pro, invites, a feature launch) next to a seasonal one |
| Targeting | Campaign phase + preview users | Home-feed rules can move or hide the card, but can't choose *which* creative a user sees |
| Frequency and dismissal | Dismissal stored on the device (`campaignHomeCard.dismissed`) | Not shared across devices, no caps, no cooldown, no "stop after conversion" |
| Experiments | Feed-level experiments only | No creative-level A/B |
| Measurement | `Campaign Viewed` / `CTA Tapped` | No link from a tap to the completed action (subscription, circle created, invite sent) |
| Pro upsell / referral cards | Separate hard-coded cards | Could be promos, but must keep working on old builds |

## 2. Concepts

- **Promo**: a schedulable unit of in-feed marketing, such as "Hold the Line: start your circle", "Pro: 1 month free with annual", "New: Apple Watch app". It may belong to a campaign (inheriting its dates and phase) or stand alone (evergreen).
- **Creative**: what the promo looks like. A promo has 1–4 creatives (variants for A/B), each with a layout and fields (§3).
- **Action**: what a button does. A typed `{ type, params }` from the action registry (§4), with an optional fallback chain for clients that don't support it.
- **Placement**: where it can render. v1 is `home_feed` only. Later: `circles_tab`, `food_log_header`, `post_log_sheet`, web dashboard.
- **Eligibility → ranking → caps**: the feed composer (HOME_FEED_SPEC §5) asks the promo engine for candidate promos for this user right now. Each promo becomes a `promo` card with its creative inline, and the existing ranker and guardrails decide position.

## 3. Creative schema (`promo@1` card `props`)

```jsonc
{
  "promoId": "hold_the_line_start_circle",   // stable key (analytics, dismissal)
  "creativeId": "htl_start_a",              // variant id (A/B)
  "layout": "hero",                          // hero | banner | compact (§3.1)
  "theme": {
    "background": { "kind": "gradient", "colors": ["#1E1B4B", "#7C3AED", "#EC4899"] },  // or { kind: "solid", color }
    "accent": "#F97316",
    "foreground": "light"                    // light | dark text over the background
  },
  "image": {                                 // optional: every layout must look finished without it
    "url": "https://…/promo/htl/hero@3x.webp",
    "darkUrl": null,                         // optional dark-theme variant
    "aspect": "16:9",                        // fixed per layout (§3.1); the client reserves the box → no layout shift
    "focal": { "x": 0.5, "y": 0.4 },         // for cropping on narrow screens
    "alt": "Four friends' rings closing together"
  },
  "eyebrow": "Starts Nov 15",                // ≤ 28
  "title": "Hold the Line with your crew",   // ≤ 44
  "body": "Maintain, don't gain. Start a circle and check in every day through the holidays.",  // ≤ 120
  "badge": { "text": "New", "tone": "pink" },  // optional, ≤ 12
  "countdown": { "endsAt": "2026-11-15T00:00:00", "label": "Starts in" },  // optional; client renders locally in the viewer's time zone
  "primary":   { "label": "Start a circle", "action": { "type": "start_circle", "params": { "campaign": "hold_the_line" } } },
  "secondary": { "label": "Learn more",     "action": { "type": "open_screen", "params": { "screen": "campaign", "slug": "hold_the_line" } } },
  "dismissible": true
}
```

All text is plain (no Markdown or HTML), trimmed and length-checked on the server. Placeholders resolve on the server before sending: `{{first_name}}`, `{{days_left}}`, `{{circle_name}}`, `{{streak}}`. Unknown or empty placeholders fail validation in the admin portal, never at render time.

### 3.1 Layouts (each client ships all three natively)

| layout | Shape | Image | Buttons | Use |
|---|---|---|---|---|
| `hero` | Full-width card, image on top (16:9), text below | 16:9, 1200×675 min (deliver @3x 1800×1013 WebP) | primary + optional secondary | Seasonal launches, big moments |
| `banner` | Full-width short card, text left, image or emoji right | 1:1 thumbnail 240×240 | primary only (the whole card is tappable) | Evergreen nudges: Pro, invites, features |
| `compact` | One line: icon/emoji + title + chevron | none (emoji or glyph) | the whole row is the action | Low-key reminders, "ended" wrap-ups |

- Unknown `layout` → the client hides the card and logs `promo_unrenderable`. The server only sends layouts the client declared (§6).
- No image → gradient from `theme.background` plus an optional `emoji`/`glyph` (reusing the campaign glyph set).
- Light/dark: `darkUrl` if present, else `url`. `theme.foreground` chooses text colour; the server validates contrast ≥ 4.5:1 against the gradient's mid colour.
- Dynamic Type / font scale: text wraps (never truncates the title below 2 lines); the image box keeps its aspect. RTL mirrors the layout.
- Loading: the card is the same height whether the image has loaded or not (the box is reserved from `aspect`; a shimmer shows until it loads). This follows the "never jumps" rule from the 1.0.8 loading work.

## 4. Action registry (v1)

Every button has `action: { type, params, fallback? }`. Types are versioned as `type@n`, and each client declares the exact set it handles (§6).

| type | params | What happens | Completion event (for conversion) |
|---|---|---|---|
| `open_screen` | `screen`: `campaign`(slug) · `calendar`(slug) · `circles` · `circle`(id) · `fitzy` (optional `prompt` ≤ 200, prefills chat) · `food_log` · `log_meal` · `hydration` · `step_history` · `profile` · `settings_notifications` · `health_connect` | Navigate in-app | none (navigation only) |
| `paywall` | `placement` (analytics), `plan`?: `annual`\|`monthly`\|`lifetime` (preselect), `offering`?: RevenueCat offering id | Opens the native paywall | `Subscription Started` |
| `invite` | `source` (`promo`), `campaign`? | Invite sheet | `Referral Contacts Invited` / link shared |
| `start_circle` | `campaign`? (prefill from its circle template), `type`? | Circle wizard | `Circle Created` |
| `join_campaign` | `campaign`, `reminders`?: bool | Calls `POST /api/mobile/campaigns/{slug}/participation`; shows a success toast | `Campaign Joined` |
| `log_water` | `ml`: 100–1000 | Logs water through the offline-first path, optimistic UI, toast with undo | water entry created |
| `enable_notifications` | `category`?: e.g. `coach` | System permission prompt if not yet asked, else the settings screen | permission granted / toggle on |
| `open_url` | `url` (https only), `mode`: `in_app`\|`external` | In-app browser (SFSafariViewController / Custom Tabs) or the system browser | none |
| `dismiss` | — | Hides the card (same as ✕) | — |

**Safety rules (enforced server-side on save and again on send, and client-side on receipt):**
- No arbitrary deep links. `open_screen` values are an allowlist; unknown → fallback.
- `open_url`: https only, host allowlist (`fitcircle.ai`, `www.fitcircle.ai`, `apps.apple.com`, `play.google.com`, plus admin-added hosts). Never carries user identifiers.
- Actions that spend something (a circle save) or post on the user's behalf (a nudge) are **not** promo actions; they stay behind their existing confirmations.
- Params are validated by a zod schema per type (server) and decoded leniently by clients. Invalid params → the client treats the action as unsupported and uses the fallback.

**Fallback chain:** `fallback: [action, …]`. The server resolves it per request: it sends the first action the client declares support for. If none is supported, it drops the button, and if the primary button can't be resolved it drops the whole promo. Clients never see an action they can't run.

## 5. Data model — migration `108_promos.sql` (tables only; no functions or triggers beyond `updated_at`)

```
promos
  id uuid pk, key text unique (^[a-z0-9_]{3,60}$), name text (admin label)
  campaign_id uuid null → campaigns(id) on delete set null   -- inherits dates/phase when set
  status text check in ('draft','scheduled','live','paused','ended','archived') default 'draft'
  placement text default 'home_feed'
  starts_at timestamptz null, ends_at timestamptz null          -- null + campaign → campaign window
  phases text[] default '{teaser,live}'                         -- for campaign-bound promos
  priority int default 0                                        -- ranking tiebreak + feed boost
  audience jsonb default '{}'          -- same schema as home_feed_rules.audience (HOME_FEED_SPEC rules.ts) + locales, countries
  platforms text[] null, min_app_version text null, max_app_version text null
  caps jsonb default '{}'              -- { perDay?, perWeek?, total?, cooldownHoursAfterDismiss?, hideAfterConversion: true }
  creatives jsonb not null default '[]'   -- [{ id, weight (0–100), layout, …§3 fields… }], 1–4 variants
  experiment_key text null                -- bucketing salt; null = weights apply per user hash of promo key
  created_by, updated_by, created_at, updated_at, version int default 1 (optimistic concurrency)

promo_user_state                      -- small, write-light; one row per (user, promo)
  user_id uuid → profiles on delete cascade, promo_id uuid → promos on delete cascade
  creative_id text, first_seen_at, last_seen_at, impressions_total int, impressions_day int, day date,
  dismissed_at timestamptz null, tapped_at timestamptz null, converted_at timestamptz null
  primary key (user_id, promo_id)
```

- Images live in the existing `campaign-art` bucket under `promo/{promoId}/{creativeId}-{slot}-{ts}.webp` (public read, service-role writes), served through Supabase image transforms at @1x/@2x/@3x.
- `promo_user_state` is updated *after the response* from the home-feed events batch (impression / dismiss / tap) and from conversion hooks in the existing services (subscription webhook, circle create, invite sent, campaign join, water log with `source=promo`). The feed never waits on it.
- RLS enabled, no anon/authenticated policies (service role through API routes only).

## 6. Wire contract

### 6.1 Client declares what it can render and do
`GET /api/mobile/home-feed?cards=…,promo@1&actions=open_screen@1,paywall@1,invite@1,start_circle@1,join_campaign@1,log_water@1,open_url@1,dismiss@1&promoLayouts=hero,banner,compact`
- Same additive pattern as `cards=`. Missing `actions` → only `dismiss` (so no promo with a primary button is sent).
- Screens: `open_screen@1` implies the v1 screen list; adding a screen bumps to `open_screen@2`.

### 6.2 Server response: one `promo` card per promo
```jsonc
{ "id": "promo:hold_the_line_start_circle", "type": "promo", "version": 1, "props": { /* §3, actions already resolved */ } }
```
- Several promo cards per feed are allowed; guardrails (HOME_FEED_SPEC §5) get two new rules:
  1. at most **2 promo-category cards** per feed (promo + campaign + pro_upsell + referral all count);
  2. at most **1 in the first 4 positions**.
- The existing "no two promos adjacent" and "native ad not in top 3" rules stay.
- `pro_upsell` and `referral` become promos (§9) once clients declare `promo@1`; for older clients the server keeps sending the legacy cards.

### 6.3 Events
Reuse `POST /api/mobile/home-feed/events` (`impression`, `tap`, `dismiss`, `cta`) with `card_id = promo:<key>` plus new optional fields `promo_id`, `creative_id`, `button: primary|secondary`. Conversions are recorded server-side (§5); no client event is needed.

### 6.4 Campaign API stays
`GET /api/mobile/campaigns` keeps its shape. **Compatibility rule:** `CampaignView.cta` stays limited to the 6 original actions, because shipped apps silently replace an unknown action with the template default (§1). New actions reach users only through `promo@1`, where the client has declared support (§6.1).

## 7. Selection and ranking (server, `lib/promos/`)

1. **Eligible** = status `live` (or `scheduled` with `starts_at ≤ now`), inside the window (or the campaign's phase is in `phases`), placement matches, client supports `promo@1`, the layout is declared and the primary action resolves (§4), the audience matches the feed context (same matcher as rules; unknown context values don't match), and the platform and app version are in range.
2. **Caps** from `promo_user_state`: skip if dismissed within the cooldown, converted and `hideAfterConversion`, or over `perDay`/`perWeek`/`total`.
3. **Creative**: deterministic bucket `sha256(experiment_key ?: promo.key + ':' + userId) % 100` against creative weights. A user keeps the same creative for the promo's life; `creative_id` is logged on the decision.
4. **Ranking**: each eligible promo is a candidate card with base score = `priority` (+ campaign boost while `live`). The ranker and guardrails place it like any other card; home-feed rules can still `move`/`hide`/`boost` `promo:<key>`.
5. **Budget**: the promo engine adds ≤ 5 ms and no extra round trips on a warm instance. Promos are loaded through the same per-instance stale-while-revalidate cache as rules (HOME_FEED_SPEC §10), and `promo_user_state` for the user is one indexed read inside the existing 250 ms context round.

## 8. Monthly and seasonal operation

- **Seasonal promos ride campaigns.** For example, Hold the Line gets a `hero` launch promo (teaser: "Starts Nov 15 · fill your seats" → `start_circle`), a mid-campaign `banner` ("Halfway: invite one more friend" → `invite`) and a `compact` wrap-up ("You held the line 🎉" → `open_screen: campaign`). Each is a promo with `campaign_id` and `phases`.
- **Evergreen promos** (no campaign): Pro (`paywall`, free users only, cap 2/week, hide after conversion), Invite friends (users with < 3 circle members), Turn on Fitzy tips (`enable_notifications` coach, users with it off), New: Apple Watch / widgets (iOS ≥ 1.0.8, once dismissed never again).
- **Calendar view in the admin portal**: a month grid of every live/scheduled promo and campaign by placement, so overlaps are visible before publishing.
- **Suggested 2026–27 content calendar** (proposal, not yet set up):
  - Nov: Hold the Line (seasonal).
  - Dec: Advent (calendar campaign) plus a "Holiday Pro" offer (needs a RevenueCat offering).
  - Jan: Fresh Start 2027.
  - Feb–Mar: Ramadan Circle.
  - Apr: Spring Steps.
  - Evergreen all year: Pro, invites and the feature-launch promos.

## 9. Migrating today's cards

| Card | Becomes | Old clients |
|---|---|---|
| `campaign@1` (seasonal_circle, daily_calendar) | stays as is (rich templates); a campaign can add promos | unchanged |
| `campaign@1` spotlight template | deprecated in favour of promos (the portal stops offering it) | existing spotlight campaigns keep rendering |
| `pro_upsell@1` | evergreen promo `pro_default` (banner) | server keeps sending `pro_upsell` to clients without `promo@1` |
| `referral@1` hub card | stays (it shows live hub state); an "invite" promo covers acquisition pushes | unchanged |

## 10. Admin portal (`/admin/promos`, admins only)

- **List / calendar** toggle; status pills; filters by placement and campaign.
- **Editor**:
  1. Basics: key, name, campaign link, placement, priority.
  2. Schedule: window or campaign phases, with the timezone note (server time; countdowns are viewer-local).
  3. Audience: the rules-engine audience builder (Pro/free, has circle, days since signup, platforms, app version, locale) with a live count from a nightly sample.
  4. Creatives: 1–4 variants, each with a layout picker, fields with character counters, an image upload with crop guides per aspect (focal-point picker), light and dark images, theme presets (reusing the campaign palettes), buttons through an **action picker** (type → params form validated by the same zod schema → fallback chain), and weights.
  5. Caps: per day, per week, total, cooldown after dismiss, hide after conversion.
  6. Preview: iOS, Android and web device mocks for each layout, light and dark, large text, no-image state; "Preview on my phone" (the admin's feed injects this promo, reusing `preview_user_ids`); "Send me a test" is n/a.
  7. Go live: a checklist (copy, image contrast, actions resolve for ≥ 1 shipped client version, caps set) → publish / pause.
- **Results**: per creative impressions, CTR, dismiss rate and conversion rate, from `home_feed_events` and `promo_user_state`.

## 11. Clients (iOS, Android, web)

- New `PromoCard` component per platform with the 3 layouts, the theme, the image box with a reserved aspect plus shimmer, and an optional countdown.
- **Action runner**: a single `PromoActionRunner` mapping registry types to existing navigation and services (paywall, invite sheet, circle wizard, campaign participation, the water log outbox, permission prompt, Safari/Custom Tabs). Unknown type or invalid params → no-op plus a `promo_action_unsupported` log; the server should never send one (§4).
- Declares `promo@1`, `actions=` and `promoLayouts=` on the feed request; decodes `props` leniently (missing optional fields fine; missing title or primary → hide the card).
- **Dismiss**: optimistic hide plus a `dismiss` event, and the server persists it, so it holds across devices. The local dismissed-set stays as an offline fallback.
- **Accessibility**: one accessibility element per card (eyebrow + title + body), buttons as separate actions, image alt text.
- **Web**: the redesigned dashboard renders the same props (the web app declares its own `actions=`: `open_url`, `paywall` → `/upgrade`, `open_screen` subset).

## 12. Analytics (tracking plan v14)
- `Promo Viewed {promo, creative, layout, position, campaign?}`
- `Promo Tapped {promo, creative, button, action}`
- `Promo Dismissed {promo, creative}`
- `Promo Converted {promo, creative, action}` (server, when a completion hook fires within 7 days of a tap)
- Feed `decision_id` on all of them, so promo performance can be split by feed experiment.

## 13. Rollout

1. **Backend + admin** (no client changes): tables, promo engine behind `PROMOS_ENABLED`, the admin editor and previews, and admin-side validation that keeps `CampaignView.cta` on the original 6 actions (§6.4).
2. **Clients 1.0.9**: `PromoCard` (all 3 layouts), the action runner with the v1 registry, `promo@1` declared. Ship before using any promo in production.
3. **First live promos**: Hold the Line launch hero (Nov 1, teaser) and the evergreen Pro banner (replacing `pro_upsell` for 1.0.9+).
4. **Later**: creative A/B, more placements (Circles tab, post-log sheet), and a model-ranked promo choice (ModelRanker from HOME_FEED_SPEC) once there is conversion data.

Kill switches: `PROMOS_ENABLED=false` (no promo cards; legacy cards return for everyone), per-promo **pause** in the portal (effective within the 30 s cache TTL).

## 14. Open questions (need a decision)

1. **Images**: do we design per-campaign art by hand (designer upload), auto-generate it with the existing parametric ring art, or both (generated default, upload to override)? *Recommendation: both, as campaigns do today.*
2. **Localization**: English only for v1, with `locale` targeting so other languages can be added later? *Recommendation: yes, en-only v1.*
3. **External links**: allow `open_url` to non-FitCircle hosts (partners) at all? *Recommendation: allowlist only, admin-managed.*
4. **Promo density**: is max 2 promo-category cards per feed (1 in the top 4) right?
5. **Pro offers**: should promos be able to preselect a discounted RevenueCat offering (e.g. a holiday annual deal)? This needs offerings set up in App Store Connect, Play and Stripe, and the Terms wording for introductory offers.
6. **Conversion window**: 7 days after a tap?
