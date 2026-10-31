# FitCircle Engage — a Braze-style engagement platform

Status: binding contract for backend, web tool, iOS and Android. Started 2026-10-16.
Builds on CAMPAIGNS_SPEC.md (campaigns stay: they're the dated "experience" containers — Hold the Line, Advent…). Engage adds **messages** that fill **placements** in the apps, an **asset library on the CDN**, **segments**, **triggers**, **A/B variants**, **frequency capping** and **analytics**.
Shared types: `apps/web/app/lib/engage/types.ts` (source of truth for every JSON shape).

## 1. Concepts (Braze vocabulary)

| Engage | Braze equivalent | What it is |
|---|---|---|
| Asset | Media library | An image on the CDN with size variants, reused across messages |
| Message | Message / Campaign step | One piece of content on one channel, with variants, audience, schedule, caps |
| Channel | Channel | `content_card` · `in_app` · `push` · `email` |
| Placement | Content Card feed / banner slot | A named slot in the apps that renders content cards |
| Layout | Message type | The native component a message renders with (fixed set, §4) |
| Segment | Segment | Saved audience filter |
| Trigger | Action-based delivery | App event that shows an in-app message |
| Variant / control | A/B test | Content alternatives with weights; control = sees nothing (measures lift) |
| Conversion goal | Conversion event | App event within N hours of a click (or impression) |
| Campaign | Campaign | Optional grouping; a message may belong to one (`campaign_id`) |

## 2. Asset library — "drop it in, it's on the CDN"
- Upload = drag & drop (or paste) in the tool. The browser reads the file, computes **SHA-256**, width/height, **dominant colour** (average of a downscaled 16×16), and encodes **WebP variants** at widths 480/960/1440 (never upscaled) with canvas. Original + variants are uploaded via `POST /api/admin/engage/assets` (multipart: `file`, `variants[]`, metadata JSON).
- Storage: Supabase Storage bucket `engage-assets` (public; served through Supabase's CDN). Content-addressed, immutable paths: `a/{sha256}.{ext}`, `a/{sha256}@{w}.webp`, uploaded with `cache-control: public, max-age=31536000, immutable`. Re-uploading the same bytes dedupes to the existing asset.
- Table `engage_assets`: id, sha256 unique, name, mime (png/jpeg/webp/gif), width, height, bytes, url, variants jsonb `[{width, url, format}]`, dominant_color, tags text[], usage_count (computed on read), created_by, created_at, archived_at.
- Accepted: png/jpg/webp/gif ≤ 10 MB, ≥ 320 px wide. Animated GIF keeps original only (no variants).
- Asset fields in content are `{ assetId }`; the delivery API expands them to `AssetRef { url, variants, width, height, dominantColor, alt }`. Apps pick the smallest variant ≥ (rendered width × screen scale), show `dominantColor` as the placeholder, then fade the image in.
- **Prefetch**: the delivery response lists `prefetch: AssetRef[]` (every asset of every eligible card/IAM). Apps download them into the image cache in the background at launch/foreground, so a triggered in-app message shows instantly.
- Campaign art slots (CAMPAIGNS_SPEC) can also be filled from the library: the art editor accepts a drop / library pick and validates exact sizes for the App Store slots.

## 3. Placements (fixed slots implemented natively; the tool only fills them)
| placement | Where | Renders | Max shown |
|---|---|---|---|
| `home_hero` | Top of home, where the campaign card sits | the active campaign experience card OR a content card, whichever has higher priority (campaign experience priority = campaign.priority; content card priority = message.priority) | 1 |
| `home_feed` | Home, below the streak card | stack of content cards | 3 |
| `circles_top` | Circles tab, top | content cards (banner layouts recommended) | 2 |
| `profile_top` | Profile tab, top | content cards | 1 |
| `post_checkin` | Inside the check-in celebration, under the main content | one compact card (banner layout) | 1 |
Unknown placements are ignored by clients. Empty placements render nothing (no gap).

## 4. Layouts (native components with placeholders)
Every layout takes the same **content** object:
```
content = {
  image?: {assetId} , imageAlt?, title (≤60), body (≤240), badge? (≤20),
  buttons: [{ label (≤24), action: Action, style: 'primary'|'secondary' }] (0–2),
  theme: { background, text, accent, buttonBackground, buttonText } (hex; defaults from the app theme),
  imageFit: 'cover'|'contain', dismissible: bool, pinned: bool (content cards only)
}
Action = { type: 'deeplink'|'url'|'invite'|'paywall'|'start_circle'|'campaign'|'screen'|'dismiss', value?: string }
  deeplink: in-app route string (same routes as push `screen`, e.g. "circles", "food_log", "invite_hub")
  url: https URL (opens in-app browser)   campaign: campaign slug   screen: screen key   start_circle: optional campaign slug for prefill
Personalisation (server-rendered before delivery): {{first_name}}, {{streak}}, {{circle_name}}, {{days_left}} (campaign), with `| default: "…"`.
```
**Content card layouts** (sizes are for a 390 pt-wide phone; scale proportionally; corner radius 20; 16 pt inner padding):
- `hero` — full-width image 16:9 on top, badge chip over the image top-left, then title (Title 2, bold), body (2–3 lines), buttons row. For `home_hero`.
- `card` — image left 88×88 rounded 14, text right (badge, title Headline, body 2 lines), buttons below full width.
- `banner` — single row: optional 44×44 image, title + one-line body, chevron or one compact button; height ~72. For `circles_top`/`post_checkin`.
- `captioned_image` — image 4:3 full width, caption block (title + body) below, whole card tappable (first button's action).
- `image_only` — image at its own aspect ratio (max 4:5), whole card tappable; title used only for accessibility.
Dismiss = small × top-right when `dismissible`.

**In-app message layouts**:
- `modal` — centered card 88% width over a 50% black scrim; image 16:9 top (optional); title, body, up to 2 buttons stacked; × close.
- `slideup` — compact bar from the bottom above the tab bar (image 40×40, title + body 1 line, chevron), auto-dismiss after 8 s, swipe down to dismiss; tap = first button action.
- `fullscreen` — image fills the top 60% (cover), gradient into the background, title Large Title, body, buttons pinned to the bottom; × close top-right.
All layouts respect Dynamic Type / font scale (text wraps, image shrinks first), Reduce Motion (fade instead of slide/scale), dark theme colours from `theme` with app defaults, and VoiceOver/TalkBack labels.

## 5. Messages
Table `engage_messages`:
- id, name (internal), campaign_id null, channel, placement (content_card), layout, status `draft|scheduled|live|paused|ended|archived` (computed from `published` + dates + paused_at), published, paused_at
- `variants jsonb`: `[{ id: 'A'|'B'|'C'…, name, weight (0–100), content }]` + `control_weight` int (0–50). Weights + control = 100.
- audience: `segment_id` null (= everyone) + `audience_filters jsonb` (extra inline filters, AND), `platforms text[]` (`ios|android|web`, empty = all)
- schedule: `starts_at timestamptz`, `ends_at timestamptz null`; for push/email: `send_mode 'immediate'|'scheduled'|'local_time'`, `send_at`, `local_hour`, (recurring is out of scope v1)
- in_app trigger: `trigger jsonb { event: TriggerEvent, filters?: {key, op, value}[], delaySeconds (0–30) }`
- frequency: `max_impressions_per_user` (null = unlimited), `min_hours_between` (default 24 for in_app), `priority` int (higher wins), `respect_global_cap` bool (default true)
- `conversion jsonb { event: AppEvent, windowHours (1–168), basis: 'click'|'impression' }` null
- push content per variant: `{ title, body, image?: {assetId}, action }`; email content per variant: `{ subject, preheader, heading, body, image?: {assetId}, ctaLabel, action }` (rendered with the campaign email shell)
- `preview_user_ids uuid[]`, created_by, updated_by, created_at, updated_at, version
**Variant assignment**: deterministic `hash(userId + messageId) % 100` → control if `< control_weight`, else bucket by weights. Stable per user. Control users never see the message but are logged as `control` exposure (for lift).
**Global caps** (server constants, `lib/engage/policy.ts`): ≤ 1 in-app message per session (client) and ≤ 2 per 24 h per user (server+client); content cards are not capped globally. Push uses the NotificationOrchestrator daily cap and quiet hours (type `engage`, category `challenge`).

## 6. Segments
Table `engage_segments`: id, name, description, filters jsonb (AND of conditions; each condition `{ key, op, value }`), estimated_count, estimated_at, created_by, timestamps.
Attribute keys (computed server-side in `lib/engage/attributes.ts` from existing tables; one snapshot per user per request, bulk for audiences):
`platform` (last active push token platform: ios/android/web) · `days_since_signup` · `is_pro` · `current_streak` · `last_active_days` (days since last streak claim/log) · `active_circle_count` · `has_active_circle` · `referral_qualified_count` · `campaign_joined` (slug) · `country` (from timezone region, best effort) · `timezone` · `app_version` (from client header `x-app-version` if sent; else unknown) · `email_opt_in` · `push_enabled` · `random_bucket` (0–99, stable hash, for % rollouts).
Ops: `eq neq gt gte lt lte in not_in exists not_exists`. `POST /api/admin/engage/segments/estimate` returns the count (cap compute at 50k users; show "≈").

## 7. Triggers & app events
Apps report app events (also used for conversions): `app_open`, `screen_view` (prop `screen`), `check_in_completed` (prop `streak`), `streak_milestone` (prop `days`), `circle_created`, `circle_joined`, `invite_sent` (prop `count`), `subscription_started`, `door_opened` (prop `campaign`, `day`), `workout_logged`, `meal_logged`.
- In-app trigger evaluation is **on device** (instant, works offline): the delivery response includes eligible IAMs with their trigger; when the event fires and filters match and local caps allow, show after `delaySeconds`. Never show over onboarding, the paywall, an active system sheet, or the camera; if the app is busy, queue for the next calm moment within 60 s, then drop.
- Clients send events (and message interactions) batched to `POST /api/mobile/engage/events` (≤ 50 per batch, flush every 30 s / on background).

## 8. Delivery API (mobile envelope, Bearer; web cookie works too)
`GET /api/mobile/engage` (headers: x-client-timezone, x-app-version, x-platform `ios|android|web`) →
```
{ cards: { [placement]: CardView[] }, inApp: InAppView[], prefetch: AssetRef[], caps: { inAppPer24h: 2, inAppPerSession: 1 }, fetchedAt }
CardView  = { messageId, variantId, layout, placement, priority, content: RenderedContent, campaignSlug? }
InAppView = { messageId, variantId, layout, priority, trigger, content: RenderedContent, maxImpressions, minHoursBetween, impressionsSoFar, lastShownAt }
RenderedContent = content with personalisation applied and image → AssetRef
```
- Eligibility: live (or caller in preview_user_ids), platform match, segment + filters match, not dismissed (cards), impressions < max, min_hours_between respected, variant ≠ control. Control assignments are logged server-side once (`control` exposure) when the user would have been eligible.
- `home_hero` merge: the server also returns `heroCampaignSlug` when the campaign experience outranks the hero content card; clients then show the campaign card (CAMPAIGNS_SPEC) instead.
- Admin preview: preview_user_ids sees drafts; `asOf` from campaign preview is ignored here (messages use real time) unless the message is in preview.

`POST /api/mobile/engage/events` body `{ events: [{ type: 'impression'|'click'|'dismiss'|'push_open'|'app_event', messageId?, variantId?, buttonIndex?, name? (app event), props?, at (ISO) }] }` → `{ accepted }`. Server stores in `engage_events` (id, user_id, message_id null, variant_id null, type, name null, props jsonb, platform, at, received_at). Indexes for (message_id, type, at) and (user_id, name, at). Dismiss of a content card is permanent for that user; impressions dedupe per message per user per 30 min.

## 9. Push & email messages
Delivered by the existing hourly campaign cron extended (or `GET /api/cron/engage` every 15 min): `immediate` → next run; `scheduled` → at `send_at` UTC; `local_time` → `local_hour` in the user's timezone on the `send_at` date. Audience resolution over all users in batches; dedupe via `engage_deliveries (message_id, user_id unique, variant_id, channel, sent_at)`. Push payload: `screen` from the action (deeplink) + `engageMessageId` + `variantId` so the open is attributed (`push_open` event). Email = campaign email shell + unsubscribe.
"Send test to me" for every channel; IAM and cards test = add yourself to preview and force-show on next app open.

## 10. Analytics
`GET /api/admin/engage/messages/{id}/stats?from&to` → per variant (+control): eligible/exposed users, impressions (total, unique), clicks (unique), CTR, dismissals, conversions (unique users with the goal event within the window after click/impression), conversion rate, lift vs control with a two-proportion z-test p-value; push: sent, opens, open rate; email: sent (opens not tracked v1). Daily series for charts. Overview `GET /api/admin/engage/overview` (live messages, last-7-day impressions/clicks/conversions).

## 11. Admin API (requireAdmin, as in CAMPAIGNS_SPEC §8)
- Assets: `GET /api/admin/engage/assets?q&tag&cursor`, `POST /api/admin/engage/assets` (multipart; dedupe by sha256), `PATCH /{id}` (name, tags, alt), `DELETE /{id}` (archive; blocked with 409 `ASSET_IN_USE` if a live message uses it, returns usage list)
- Messages: `GET /api/admin/engage/messages?channel&status&campaignId`, `POST`, `GET|PATCH|DELETE /{id}` (version), `POST /{id}/launch` (validates), `/pause`, `/resume`, `/duplicate`, `/test` `{ channel-specific }`, `POST /{id}/preview { onMyDevices }`, `GET /{id}/stats`
- Segments: `GET|POST /api/admin/engage/segments`, `GET|PATCH|DELETE /{id}`, `POST /estimate { filters }`
- Overview: `GET /api/admin/engage/overview`

## 12. The tool (web, `/admin`, admins only) — feels like Braze / Customer.io
- Shell: left nav **Overview · Campaigns · Messages (Content Cards, In-App, Push, Email) · Segments · Assets**, top bar with search and "New message".
- **Assets**: grid with drag & drop anywhere on the page (multi-file), upload progress, dedupe notice, dominant-colour placeholders, filters/tags, detail drawer (variants, dimensions, CDN URL copy, where it's used).
- **Message composer** (single page, sticky live preview on the right):
  1. Channel + placement/trigger → 2. **Layout picker** (visual thumbnails of each native layout) → 3. **Content**: drop zone for the image (drop a file → uploads to the library → instantly shown in the preview; or pick from library), title/body/badge with personalisation inserter and counters, buttons with action pickers, theme colours (presets from brand + custom), dismissible/pinned → 4. **Variants**: tabs A/B/C, weights slider, control % → 5. **Audience**: segment picker + inline filters builder + platform toggles + live reach estimate → 6. **Delivery**: schedule window; IAM trigger builder; push/email send mode; frequency caps; priority → 7. **Conversion goal** → 8. **Review & launch** checklist; pause/resume.
  - **Live preview**: device frame with iOS / Android / web toggle and light text-size slider; renders the selected layout in its real placement context (home screen mock around `home_hero`/`home_feed`, Circles tab around `circles_top`, check-in celebration around `post_checkin`, modal over the home screen, push on a lock screen, email in a mail client). Built from the same layout spec as the apps so it matches. Variant switcher in the preview.
  - "Preview on my phone" and "Send test".
- **Message list** per channel with status pills, sparkline of impressions, CTR, conversions; bulk pause.
- **Message analytics** tab: KPI tiles, variant comparison table with lift/significance, daily chart, funnel (eligible → impression → click → conversion).
- **Segments**: builder with attribute picker, ops, values; live estimate; usage.
- **Campaigns** (existing CAMPAIGNS_SPEC editor) gets a "Messages" section listing/creating messages attached to the campaign, and its art slots accept drops/library picks with instant preview.
- **Overview**: what's live now, upcoming, last-7-day totals, top messages.

## 13. Clients (iOS + Android; web renders cards in its dashboard)
- `EngageClient`: fetch `GET /api/mobile/engage` at launch/foreground/sign-in and every 15 min in foreground; cache last response on disk (show cached instantly); prefetch assets; batch + persist events (retry offline).
- `PlacementView(placement)` composable/SwiftUI view: renders 0–N cards for a placement with the §4 layouts; reports impression when ≥ 50% visible for ≥ 1 s (once per session per message), click with buttonIndex, dismiss.
- `InAppMessageHost` at the app root: listens to the app event bus, evaluates triggers + caps (local: per-session 1, per-24h 2, per-message min hours / max impressions), queues, presents §4 IAM layouts, reports events.
- Action router shared with push/deep links (§4 Action types).
- App events (§7) emitted from the existing places (app open, screen views of main tabs, check-in, streak milestone, circle create/join, invite sent, subscription started, door opened, workout/meal logged) — also forwarded to `/engage/events`.
- Placements wired: home_hero (merge with campaign card per `heroCampaignSlug`), home_feed, circles_top, profile_top, post_checkin.
- Debug harness (extends the campaign preview harness): render every layout × placement and every IAM layout from fixture JSON; used for screenshots.

## 14. Data model — migration `104_engage.sql` (schema only + bucket; no functions/triggers)
`engage_assets`, `engage_segments`, `engage_messages` (with `platforms text[]`), `engage_events` (with `platform`), `engage_deliveries (message_id, user_id, platform, unique(message_id,user_id,platform))`, `engage_dismissals (message_id, user_id, at, pk)`, `campaigns.platforms text[] default '{}'`, bucket `engage-assets` public. RLS enabled, no anon/auth policies.

## 15. Cross-platform targeting (first-class)
- Every message AND every campaign has `platforms` (`ios`, `android`, `web`; empty = all). The tool shows a prominent platform selector in the composer header and on Review & launch ("Launching to: iOS · Android · Web"), with per-platform reach in the estimate.
- **Per-platform overrides**: each variant's content may carry `platformOverrides: { ios?, android?, web? }` — a partial content object (any field: image, title, body, buttons, theme). The server merges the override for the caller's platform before delivery. Typical uses: a different screenshot per platform, "Get it on Google Play" vs "App Store" wording, a web-only URL action.
- **Platform capability rules** (validated at launch, shown inline): `in_app` layouts are mobile + web (web renders modal/slideup/fullscreen as overlays); `post_checkin` placement exists on all three; `push` targets ios/android (web push not supported → excluded, shown as a warning); App Store events are iOS-only, Play promotional content Android-only (campaign channels).
- **Platform detection**: clients send `x-platform: ios|android|web` (web app sends `web`; cookie-session requests without the header are treated as web). Push audiences use each user's active push-token platforms; a user with tokens on both gets one push per platform-eligible device per message (dedupe per user+platform).
- **Campaign platforms**: `campaigns.platforms text[] default '{}'` (migration 104 adds the column). `/api/mobile/campaigns` filters by the caller's platform.
- **Analytics** break down every metric by platform (`?platform=` filter + per-platform columns in the variant table).
- **Preview** toggles iOS / Android / Web and applies that platform's override.
