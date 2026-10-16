# Campaigns — admin-built marketing campaigns, rendered natively in the apps

Status: binding contract for backend, web (admin portal + web app), iOS and Android.
Started 2026-10-16. Replaces the code-configured seasons of REFERRALS_SPEC §10.4 (that endpoint stays, now backed by this).
Shared TypeScript types: `apps/web/app/lib/campaigns/types.ts` (the source of truth for every JSON shape below).

## 1. Concepts

- **Campaign**: a dated, admin-authored marketing moment (Hold the Line, Advent, Fresh Start 2027, Ramadan…). It has copy, colours, artwork, dates, a **template**, an optional circle template, and a delivery plan (in-app, push, email, App Store event, Play promo).
- **Template** = one of the creative card types the apps render natively. The apps never render arbitrary layouts; an admin picks a template and fills its fields. Unknown templates are skipped by clients (forward compatible).

| template | What the apps show | Primary CTA |
|---|---|---|
| `seasonal_circle` | Hero card (home), compact banner (Circles tab), banner in the circle wizard that prefills name/dates | `start_circle` (wizard prefilled from `circle`) |
| `daily_calendar` | Advent-style calendar: home card ("Door 7 is open"), full calendar screen with N doors, door reveal celebration, friends who opened today, "Remind me each morning" toggle, optional "Start a circle" | `open_calendar` |
| `spotlight` | Simple promo card: art, title, body, one CTA | `invite` · `paywall` · `circles` · `start_circle` · `open_url` |

- **Phase** (computed per viewer local day `today`): `teaser` (featuredFrom ≤ today < startsAt), `live` (startsAt ≤ today ≤ endsAt), `ended` (endsAt < today ≤ endsAt + 2 days, shows a wrap-up), otherwise not returned.
- **Status** (admin): `draft` (unpublished) · `scheduled` (published, today < featuredFrom) · `live` (published, visible) · `ended` · `archived`.

## 2. Data model — migration `103_campaigns.sql` (schema + seed; NO functions/triggers beyond updated_at)

- `profiles.is_admin boolean not null default false`. Seed: the owner account (auth email `aniruddh@bajirao.me`) gets `true`.
- `campaigns`
  - `id uuid pk`, `slug text unique` (`^[a-z0-9_]{3,40}$`), `template text check in ('seasonal_circle','daily_calendar','spotlight')`
  - `published boolean default false`, `published_at`, `archived_at`
  - copy: `title` (≤40), `emoji` (≤8), `tagline` (≤80), `description` (≤280), `cta_label` (≤24, nullable → template default)
  - look: `accent text` (#rrggbb), `palette jsonb` (3 hex aurora colours), `glyph text` (`snowflake|gift|year|sun|moon|flame|leaf|heart|star|bolt`)
  - dates (calendar days, viewer-local): `featured_from date`, `starts_at date`, `ends_at date`, `priority int default 0`
  - `cta jsonb` `{ action, url? }`
  - `circle_template jsonb null` `{ name, description, type, startDate, endDate }`
  - `calendar jsonb null` (daily_calendar only) `{ doors: [{ day, emoji, title, task }] }` — one per day of the window
  - `marks jsonb default '[]'` `[{ date, emoji, label }]` (art + calendar decorations)
  - `art jsonb default '{}'` `{ appStoreCard?, appStoreDetails?, inAppHero?, emailHeader? }` each `{ url, width, height, generated: bool, updatedAt }`
  - `notifications jsonb default '[]'` see §5, `emails jsonb default '[]'` see §6
  - `app_store jsonb default '{}'` `{ name, shortDescription, longDescription, badge, purpose, priority, eventId?, state?, lastSyncedAt?, lastError? }`
  - `play jsonb default '{}'` `{ title?, description?, exportedAt? }`
  - `legacy_season_key text null` (`hold_the_line|new_year_reset|ramadan`) — only these appear on `/api/mobile/seasonal`
  - `preview_user_ids uuid[] default '{}'` (admins previewing a draft on their own devices)
  - `created_by`, `updated_by`, `created_at`, `updated_at`, `version int default 1` (optimistic concurrency on PATCH)
- `campaign_participants (campaign_id, user_id, joined_at, reminders bool default false, primary key(campaign_id,user_id))`
- `campaign_deliveries (campaign_id, user_id, delivery_key text, channel text, sent_at, unique(campaign_id,user_id,delivery_key))` — dedupe for push/email
- Storage bucket `campaign-art` (public read; writes only via service role).
- RLS on the three tables: enabled, no policies for anon/authenticated (service-role access only through API routes).
- **Seed** (idempotent `on conflict (slug) do nothing`), all `published = true`:
  - `hold_the_line` · seasonal_circle · featured 2026-10-20, 2026-11-15 → 2026-12-15 · ❄️ · glyph snowflake · legacy `hold_the_line` · marks 🦃 2026-11-26 Thanksgiving, 🏁 2026-12-15 Finish
  - `advent_2026` · daily_calendar · "Advent Circle" · featured 2026-11-17, 2026-12-01 → 2026-12-24 · 🎁 · glyph gift · 24 doors (§4) · circle template "Advent Circle" Dec 1–24 · marks 🎅 2026-12-06, 🎄 2026-12-24 · priority 20
  - `new_year_reset` · seasonal_circle · "Fresh Start 2027" · featured 2026-12-16, 2027-01-01 → 2027-01-31 · 🌅 · glyph year · legacy `new_year_reset` · mark 🎉 2027-01-01
  - `ramadan_2027` · seasonal_circle · "Ramadan Circle" · featured 2027-01-25, 2027-02-08 → 2027-03-09 · 🌙 · glyph moon · legacy `ramadan`
  - Copy for these comes from today's `lib/seasonal/seasons.ts` and the App Store copy in §7. `seasons.ts` stays as a fallback used only when the campaigns query fails.

## 3. Mobile API (standard envelope, Bearer auth, `x-client-timezone` → viewer local `today`)

### `GET /api/mobile/campaigns`
```
{ campaigns: CampaignView[], homeSlug: string | null }
```
- Visible = published, not archived, phase ∈ {teaser, live, ended}; plus drafts whose `preview_user_ids` contains the caller.
- Order: live before teaser before ended, then `priority` desc, then `starts_at` asc. `homeSlug` = first one (the home card shows exactly one campaign; the Circles tab shows every `seasonal_circle`/`daily_calendar` as compact banners).
- **Admin preview date**: if the caller is admin and `profiles.preferences.campaignPreview.asOf` (YYYY-MM-DD) is set, that date is `today` for campaign endpoints (and `/api/mobile/seasonal`). Lets admins see any phase on their real devices.

### `GET /api/mobile/campaigns/{slug}` → `CampaignView` (404 `NOT_FOUND` when not visible)
### `POST /api/mobile/campaigns/{slug}/participation` body `{ joined?: boolean, reminders?: boolean }` → `CampaignView`
- `reminders: true` implies joined. Opening the calendar screen does NOT auto-join; the "Remind me each morning" toggle and "I'm in" do.

### `CampaignView` (see types.ts for exact fields)
- id, slug, template, title, emoji, tagline, description, accent, palette, glyph, ctaLabel, cta, startsAt, endsAt, featuredFrom
- `phase`, `today`, `dayNumber` (1-based when live, else null), `totalDays`, `daysUntilStart` (teaser), `daysLeft` (live)
- `art` (urls only; any may be null — clients MUST look finished without art: gradient from `palette` + big `emoji`)
- `circle` (circle template or null), `marks`
- `participant: { joined, reminders }`
- `calendar` (daily_calendar only, else null):
  `{ doors: [{ day, date, state: 'locked'|'today'|'opened'|'missed', emoji?, title?, task? }], openedCount, todayOpened, streak, friends: { openedToday, total, members: [{ userId, name, avatarUrl, openedToday }] (≤8, opened first) } }`
  - Content (`emoji/title/task`) is present ONLY for `day ≤ dayNumber` (no peeking ahead). Teaser: every door `locked`, no content.
  - **A door opens when the viewer shows up that local day** — exactly the circle-streak definition: a non-freeze `streak_claims` row or a calorie-bearing `food_log_entries` row on that date. Past unopened doors are `missed` (content still visible, gentle copy). There is no separate "open" action: checking in opens today's door.
  - `streak` = consecutive opened doors ending today (or yesterday if today isn't opened yet).
  - `friends` = distinct active members of the viewer's active circles (excluding the viewer).
- `legacy` not exposed.

### `/api/mobile/seasonal` (REFERRALS_SPEC §10.4) keeps its exact shape: `current`/`upcoming` built from published `seasonal_circle` campaigns that have a `legacy_season_key`, mapping `key = legacy_season_key`. Old clients keep working.

## 4. Advent doors (seed content for `advent_2026`)
Small, kind, doable in a few minutes, no diet talk. Day: emoji · title · task
1 🚶 First steps · A 10-minute walk, any pace. · 2 💧 Water first · A glass of water before your first coffee or tea. · 3 🧘 Unclench · 5 minutes of stretching: neck, shoulders, hips. · 4 🥦 Add a colour · Add one vegetable or fruit to a meal. · 5 📵 Screen-free bite · Eat one meal without your phone. · 6 🎅 St Nicholas steps · 6,000 steps today. · 7 😴 Wind down · Lights out 20 minutes earlier tonight. · 8 🙌 Cheer someone · React to a friend's post in your circle. · 9 🪜 Take the stairs · Pick stairs over the lift or escalator today. · 10 🍲 Cook it · Make one meal at home. · 11 🌬️ Breathe · 2 minutes of slow breathing (4 in, 6 out). · 12 🏃 Move 20 · 20 minutes of any movement you enjoy. · 13 🍎 Smart snack · Swap one snack for fruit or nuts. · 14 🧊 Hydrate · 8 glasses of water today. · 15 🏁 Halfway hero · Log every meal today. · 16 ☀️ Daylight · 10 minutes outside in daylight. · 17 💪 Mini workout · 10 squats, 10 push-ups (any version), 20-second plank. · 18 🫶 Bring a friend · Invite one friend to join your circle. · 19 🍵 Slow sip · Swap one sugary drink for water or tea. · 20 🎶 Dance break · One song, full volume, dance it out. · 21 🌙 Longest night · A cosy evening walk under the lights. · 22 🥗 Plate check · Half your plate vegetables at one meal. · 23 🎁 Gift of steps · Walk with someone you love. · 24 🎄 You made it · Check in and share one win from this month.

## 5. Push (hourly cron `GET /api/cron/campaigns`, CRON_SECRET)
`notifications[]` item: `{ key, kind: 'launch'|'daily'|'last_day'|'custom', sendOn?: date (custom), localHour: 0–23, title (≤60), body (≤140), audience: 'all'|'participants'|'reminders' , enabled }`
- `launch` sends on `starts_at`; `daily` sends every live day (doors: `{{day}}`, `{{door_title}}`, `{{door_emoji}}` placeholders; also `{{days_left}}`, `{{title}}`, `{{first_name}}` everywhere); `last_day` on `ends_at`; `custom` on `sendOn`.
- Fires when the recipient's local hour (profiles.timezone, default America/Los_Angeles) equals `localHour` on the matching local date. Dedupe key `push:{key}:{localDate}` in `campaign_deliveries`.
- Audience: `all` = every user with a push token; `participants` = joined; `reminders` = joined with reminders on. `daily_calendar` daily reminders also skip users who already opened today's door.
- Sent through NotificationOrchestrator as type `campaign` (category `challenge`, so the user's Challenges toggle silences it; subject to the normal daily cap and quiet hours — NOT cap-exempt). Payload `screen: 'campaign'`, `campaignSlug`.
- Clients route `screen == 'campaign'` to the campaign: daily_calendar → calendar screen; others → home with the card (or wizard for start_circle).
- Seeds: Hold the Line `launch` 8:00 all "Hold the Line starts today ❄️" / "Check in with your crew and head into the holidays strong."; Advent `launch` 8:00 all "The Advent Circle is open 🎁" / "Door 1 is waiting. Check in today to open it."; Advent `daily` 8:00 reminders "Door {{day}} is open {{door_emoji}}" / "{{door_title}}: check in today to open it."; Fresh Start `launch` 9:00 all "Fresh Start 2027 begins 🌅" / "New year, healthier you. Start it with your circle today."

## 6. Email (same cron)
`emails[]` item: `{ key, kind, sendOn?, localHour, subject (≤80), preheader (≤100), heading (≤60), body (≤600, plain text, blank line = paragraph), ctaLabel, audience: 'all'|'participants', enabled }`
- Rendered with the referral email shell (dark card, gradient header) plus `art.emailHeader` image when present, CTA → `https://www.fitcircle.ai/c/{slug}` (web page that opens the app / shows the campaign).
- Marketing consent: skip users with `profiles.preferences.marketingEmails === false`. Every email has an unsubscribe link and `List-Unsubscribe` + `List-Unsubscribe-Post` headers → `/api/campaigns/unsubscribe?t={signed token}` (GET validates and shows a confirm page, POST opts out; HMAC-SHA256 with `CRON_SECRET`-derived key; scanner-safe like the referral one).
- Dedupe key `email:{key}`. Sent from `FitCircle <team@fitcircle.ai>` via Resend, ≤ 50 per cron run per campaign (the next hourly run continues).

## 7. External banners
- **App Store In-App Event** (`app_store` jsonb). Limits validated: name ≤30, shortDescription ≤50, longDescription ≤120; event ≤31 days; promotion starts ≤14 days before start (we use featured… capped to start-14d). Badge ∈ `CHALLENGE|COMPETITION|LIVE_EVENT|MAJOR_UPDATE|NEW_SEASON|PREMIERE|SPECIAL_EVENT`.
- Server integration `lib/campaigns/app-store.ts` using the App Store Connect API (ES256 JWT via `jose`): create/update `appEvents` + `appEventLocalizations` (en-US), upload `appEventScreenshots` (card 1920×1080 as `EVENT_CARD`, details 1080×1920 as `EVENT_DETAILS_PAGE`), and submit via `reviewSubmissions` (+ item). Env: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` (p8 text), `ASC_APP_ID` (6811432467). Missing env → endpoints return `409 APP_STORE_NOT_CONNECTED` and the portal shows the export pack instead.
- **Google Play Promotional Content** has no public API: the portal offers an export pack (1920×1080 PNG + title ≤80 / description ≤500) and a link to Play Console → Grow → Promotional content.
- Seed App Store copy: Hold the Line — "Hold the Line" / "Maintain, don't gain, with your crew." / "Start a circle with friends, check in every day and head into the holidays strong." / CHALLENGE. Advent — "Advent Circle" / "A small healthy win behind every door." / "Open one door a day from Dec 1 to 24: a quick healthy challenge you and your circle do together." / SPECIAL_EVENT. Fresh Start — "Fresh Start 2027" / "New year, healthier you. Start it together." / "Kick off 2027 with friends: check in every day for 31 days and build healthy habits that last all year." / CHALLENGE.

## 8. Admin API (`/api/admin/campaigns…`) — web cookie session OR mobile Bearer; caller must have `profiles.is_admin` (403 `FORBIDDEN` otherwise). `ADMIN_API_SECRET` bearer also accepted for scripts.
- `GET /api/admin/campaigns` → `{ campaigns: AdminCampaign[] }` (with computed `status`)
- `POST /api/admin/campaigns` (create draft; body `CampaignInput`) · `GET|PATCH|DELETE /api/admin/campaigns/{id}` (PATCH requires `version`, 409 `VERSION_CONFLICT`; DELETE = archive)
- `POST /{id}/publish` (validates completeness: copy, dates, template fields, ≥ inAppHero art OR accepted fallback) · `POST /{id}/unpublish`
- `POST /{id}/art` multipart `{ slot: 'appStoreCard'|'appStoreDetails'|'inAppHero'|'emailHeader', file (png/jpg ≤8MB, exact size for App Store slots), generated: 'true'|'false' }` → stores `campaign-art/{campaignId}/{slot}-{timestamp}.png`
- `POST /{id}/preview` `{ onMyDevices: boolean, asOf?: date|null }` (toggles caller in `preview_user_ids`; sets/clears caller's `preferences.campaignPreview.asOf`)
- `POST /{id}/test-push` / `POST /{id}/test-email` `{ key }` → sends that item to the caller only (ignores dedupe)
- `GET /{id}/app-store` · `POST /{id}/app-store/sync` · `POST /{id}/app-store/submit`
- `GET /api/admin/me` → `{ isAdmin }` (web nav uses it).

## 9. Admin portal (web, `/admin/campaigns`)
- Only rendered for admins (server-side check; non-admins get 404). The "Admin" link appears in the web nav/profile menu only for admins.
- **List**: status pill, template, dates timeline, quick actions.
- **Editor** (one page, sections with live preview on the right):
  1. Basics — template picker (3 cards with a thumbnail of how each looks in the app), slug, title, emoji, tagline, description, CTA.
  2. Dates — featured from / starts / ends, with the App Store 31-day / 14-day rules shown inline.
  3. Template content — circle template (seasonal_circle, optional for daily_calendar), doors editor (daily_calendar: one row per day, emoji/title/task, "fill from ideas" button with a built-in library), spotlight CTA.
  4. Creative — glyph, palette (presets: Winter, Festive, New Year, Moonlight, Spring, Brand + custom), marks. **Generate artwork** renders every slot in the browser from the same parametric ring art used for the launch campaigns (`lib/campaigns/art/ring-art.ts`, pure SVG builder), rasterises to PNG at exact sizes, uploads. Each slot can be replaced with an uploaded file.
  5. Messages — push and email items with placeholder help, character counters, "Send test to me".
  6. Channels — In-app (always), Push, Email, App Store event (sync/submit/status, or export pack when not connected), Play export pack.
  7. Preview — device mocks of every surface for the chosen template and phase (date scrubber): App Store card + details, home card, Circles banner, calendar screen, push banner, email. "Preview on my phone" (+ date) uses §8 preview.
  8. Go live — publish/unpublish with a checklist.
- Web app (non-admin) also renders campaigns: dashboard card + `/c/{slug}` page (calendar for daily_calendar), sharing the same `CampaignView`.

## 10. Clients (iOS + Android; web for the dashboard card)
- Replace the seasonal data source with `/api/mobile/campaigns` (keep decoding tolerant: unknown template → skip, unknown fields ignored, nullable art).
- Home: one campaign card for `homeSlug`, template-specific: seasonal_circle (hero with art or gradient, title, tagline, phase line "Starts Nov 15 · fill your seats" / "Day 9 of 30", CTA), daily_calendar (mini row of the next doors + "Door 7 is open — check in to open it" / opened state "Door 7 opened ✓ · 6 in a row"), spotlight (art, title, body, CTA). Position: where the seasonal home-card state sits today.
- Circles tab: compact banners for live/teaser seasonal_circle + daily_calendar campaigns. Wizard: seasonal banner generalised to campaigns with a `circle` template.
- Calendar screen (daily_calendar): header (art or gradient, title, "Dec 7 · 18 doors to go"), grid of doors (6 columns; `today` pulsing gold, `opened` filled with its emoji, `missed` dimmed with content, `locked` numbered), tapping a revealed door shows its card (emoji, title, task, "Check in to open" / "Opened ✓"), friends strip ("5 of 8 friends opened today's door"), "Remind me each morning" toggle (participation), "Start an Advent Circle" when `circle` present, invite CTA.
- **Door reveal celebration**: when the calendar loads with `todayOpened == true` for a day not yet celebrated (local flag per campaign/day), play the door-opening animation + confetti and show the door's card; secondary CTA "Bring a friend along →" (invite sheet, source `campaign`) respecting the 7-day peak-prompt cap.
- After any check-in during a live daily_calendar, refresh campaigns so the home card flips to opened.
- Push route `screen: campaign` (§5). Deep link `https://www.fitcircle.ai/c/{slug}` opens the campaign (add to AASA/App Links paths `/c/*`).
- Debug builds only: a **Campaign preview harness** that renders every template surface from fixture `CampaignView` JSON at chosen phases (no network, no sign-in), used for screenshots and visual QA. Not shipped in release.

## 11. Analytics (tracking plan v10, category `engagement`)
- `Campaign Viewed {campaign: string, template: enum, surface: enum home_card|circles_banner|wizard_banner|calendar|web_page, phase: enum}`
- `Campaign CTA Tapped {campaign, template, action: enum start_circle|open_calendar|invite|paywall|circles|open_url}`
- `Campaign Joined {campaign, template, reminders: bool}` · `Campaign Reminders Toggled {campaign, enabled: bool}`
- `Campaign Door Opened {campaign, day: int, opened_count: int}` (fired once, when the reveal celebration shows)
- Add `campaign` to `Referral Invite Sheet Opened.source`, `Referral Contacts Invited.source`, `Circle Wizard Started.source`.
- Server: `Campaign Published {campaign, template}` (web admin).
