# Activation journey: first meal, meal reminders, paywall moments, meeting Fitzy

Status: approved by the owner 2026-10-26 (build). Ships as **iOS + Android 1.1.0**; backend parts go live first behind flags. Builds on `docs/PROMO_CARD_SPEC.md` (promo@1), which this spec adopts with the decisions in §8.

## 1. Why

First paid-UA data (Apple Ads, Oct 24–26): of attributed paid users, 3/6 finished onboarding, 2 tried a meal photo, **1 logged a meal**, **1 saw the paywall**, 0 purchased. Among all 12 real sign-ups, 6 ever logged a meal. The product loses people between sign-up and the first logged meal, and almost nobody reaches the paywall. Fitzy (the AI coach) is never introduced.

Goals (measured in Amplitude, paid vs organic):
- **Activation** (≥1 meal logged within 24 h of sign-up): from ~40% to ≥60%.
- **Day-1 return** with a logged meal: track; no target yet.
- **Paywall reach** within 3 days: from ~15% to ≥50% of activated users; never before the user has seen value.
- **Fitzy opened** within 3 days: ≥40% of activated users.

## 2. Journey

| When | What the user sees | Where it lives |
|---|---|---|
| Onboarding, after goals | **"Snap your first meal"** step: camera / photo / describe it. **"Skip for now"** is always visible and equal weight to the secondary action. | app (native step) |
| First meal analysed successfully (in onboarding or later) | Result → saved → **"Meet Fitzy"** moment: a short sheet "I'm Fitzy, your coach. Here's my take on your <meal>" with one-line insight + "Chat with Fitzy" / "Later". Then, on the next screen dismissal, the **soft paywall** (once, see §5). | app |
| Home feed, no meal ever logged | **`first_meal` promo** (hero/banner): "Snap your first meal" → `open_screen: log_meal`. Top of feed (position ≤ 2) until the first meal. | server promo |
| Home feed, a meal slot is open and not logged | **`log_meal_now` promo** (banner/compact, time-aware copy): "Log your lunch" → `open_screen: log_meal` with `meal: lunch`. Hidden once that slot has an entry. Not shown while `first_meal` is shown. | server promo |
| Home feed, activated (≥1 meal) free user, from day 1 | **`pro_value` promo** (banner): enticing value prop that rotates (A/B creatives), e.g. "See exactly what's in every bite — unlimited AI meal scans with Pro" → `paywall` (placement `feed_pro_value`). Replaces legacy `pro_upsell` for clients with promo@1. | server promo |
| Home feed, activated, Fitzy never opened | **`meet_fitzy` promo** (banner): "Meet Fitzy, your coach — ask anything about your meals" → `open_screen: fitzy` with a prompt seeded from their last meal. Hidden after first Fitzy open. | server promo |
| Meal-time push | breakfast / lunch / afternoon snack / dinner reminders (§4) | server push |
| Day 2 (if Fitzy never opened, activated) | push `fitzy_intro`: "Fitzy has a tip about yesterday's meals" → `fitzy_chat` deep link | server push (existing Fitzy push infra) |

All copy is real product copy — no fake social proof or invented stats.

## 3. Feed cards via promo@1 (server)

Implement PROMO_CARD_SPEC §3–§7, §9, §12 with these **system promos** defined in code (seeded, not admin-editable in v1 beyond pause/copy):

| key | layout | audience (matcher in `lib/promos/`) | caps |
|---|---|---|---|
| `first_meal` | hero (no image; gradient + 📸) | 0 meals ever | perDay ∞, dismiss cooldown 24 h, hide after conversion (first meal) |
| `log_meal_now` | banner | ≥1 meal ever; current local time inside a slot window (§4) and no entry for that slot today | cooldown 2 h after dismiss; hides when slot logged |
| `pro_value` | banner | free (not Pro), ≥1 meal ever, ≥ 18 h since sign-up | perWeek 3, cooldown 48 h after dismiss, hide after conversion |
| `meet_fitzy` | banner | ≥1 meal ever, Fitzy never opened (`fitzy_opened_at` null) | cooldown 72 h after dismiss, hide after conversion (Fitzy opened) |

Guardrails (PROMO_CARD_SPEC §6.2): ≤ 2 promo-category cards per feed, ≤ 1 in the first 4 positions, **except `first_meal`**, which may take position 1–2 (it is utility, not marketing). Never show `pro_value` and the campaign hero adjacent.

Older clients (no `promo@1`): keep sending legacy cards (`pro_upsell`, etc.) — nothing changes for them.

Context the matchers need (one indexed read each inside the existing 250 ms context round): meals ever (bool), today's logged slots, signup time, Pro, `fitzy_opened_at` (new nullable column on `profiles` or a small table — tables only; set by the Fitzy chat endpoint on first message/open).

## 4. Meal reminders (server push)

Replace the lunch/dinner-only logic in `reminder-service.ts` with four slots, user-local time:

| slot | send at | window counted as "logged" | default |
|---|---|---|---|
| breakfast | 08:30 | 04:00–10:59 entry, or `meal_type=breakfast` | on |
| lunch | 12:30 | 11:00–14:59, or `lunch` | on |
| afternoon snack | 15:30 | 15:00–16:59, or `snack` | **off** (opt-in) |
| dinner | 18:30 | 17:00–21:59, or `dinner` | on |

- Skip if the slot is logged (by `meal_type` **or** by entry time in the window — fixes the "lunch logged as snack" gap), if quiet hours, if the per-day push cap is hit, or if the user hasn't logged **any** meal in the last 7 days *and* already got 3 ignored reminders (no nagging dead users; resume on next log).
- Preferences: per-slot toggles under the existing notification settings category (`meal_reminders`), stored in the existing preferences JSON; defaults as above. Settings UI on both apps lists the four toggles.
- Dedupe key `meal:<slot>:<localDate>` (uses the dedupe guard from `docs/PUSH_NOTIFICATIONS.md`). Deep link opens the logger with the slot preselected.
- Copy (one per slot, warm, short, no guilt): e.g. breakfast "Morning! Snap breakfast 📸 — calories & macros in seconds."
- These are server-only: they reach users on 1.0.8/1.0.9 immediately (they already handle `meal_reminder_*` and the food-log deep link — verify for breakfast/snack and fall back to the lunch type's routing if needed).

## 5. Paywall moments

- **Soft paywall after the first successful AI analysis** (in onboarding or later): shown once, after the Meet-Fitzy moment, placement `first_meal_aha`. Dismissible; never blocks saving the meal.
- **Feed `pro_value` card** → paywall placement `feed_pro_value`.
- Existing gates unchanged (scan limits etc.).
- Frequency: an *automatically presented* paywall at most once per 72 h and never in the user's first 10 minutes unless it is the post-aha moment. User-initiated taps always open it.
- Track `Paywall Viewed {source}` with the new sources.

## 6. Meeting Fitzy

- Post-first-meal sheet (§2), shown once (local flag + server `fitzy_intro_seen_at` optional).
- Feed `meet_fitzy` promo until first open.
- Day-2 `fitzy_intro` push if still never opened (activated users only, respects coach toggle and caps; dedupe `fitzy_intro:<userId>`; once ever).
- Opening Fitzy from any entry point records `fitzy_opened_at`.

## 7. Analytics (tracking plan bump)

New/extended events (all platforms via codegen in `analytics/tracking-plan.json`):
- `Onboarding Meal Step Viewed`, `Onboarding Meal Step Skipped`, `Onboarding Meal Logged`
- `Fitzy Intro Viewed {surface: post_meal_sheet|feed|push}`, `Fitzy Intro Accepted`, `Fitzy Opened {source}`
- `Promo Viewed/Tapped/Dismissed/Converted` (PROMO_CARD_SPEC §12)
- `Paywall Viewed {source}` new sources: `first_meal_aha`, `feed_pro_value`
- `Meal Reminder Opened {slot}` (from push open)

## 8. Decisions on PROMO_CARD_SPEC §14 open questions (owner delegated)

- Migration number: **110** (108/109 are taken).
- v1 promos: the four system promos above + migrate `pro_upsell` → `pro_value` for promo@1 clients. Admin portal promo editor: **later** (system promos are code-defined; ops can pause via env `PROMOS_DISABLED_KEYS` and the global `PROMOS_ENABLED`).
- Layouts in v1 clients: all three (hero, banner, compact).
- Actions in v1 clients: `open_screen@1` (incl. `log_meal` with optional `meal`, `fitzy` with optional `prompt`, `food_log`, `campaign`, `circles`, `settings_notifications`), `paywall@1`, `invite@1`, `start_circle@1`, `enable_notifications@1`, `open_url@1`, `dismiss@1`. (`join_campaign`, `log_water` may follow.)
- Images: optional; v1 system promos use gradient + emoji only.

## 9. Rollout

1. Backend (flags default **off** in prod until clients ship, except meal reminders): migration 110, promo engine, system promos, 4-slot meal reminders (**on** — server-only, helps current apps), `fitzy_opened_at` + `fitzy_intro` push, tracking plan.
2. iOS + Android 1.1.0: PromoCard + action runner, onboarding meal step, Meet-Fitzy sheet, post-aha paywall, meal-slot settings, analytics.
3. Turn on `PROMOS_ENABLED` after 1.1.0 reaches users; watch activation and paywall reach by source in the ads console / Amplitude.

---

## Appendix A — Backend build (2026-10-26, branch `feat/activation-journey`): wire contract for iOS / Android 1.1.0

### A.1 Flags (Vercel env)

| Env | Default | Effect |
|---|---|---|
| `PROMOS_ENABLED` | **off** | Only `true`/`1`/`on`/`yes` turns promo@1 on. Off → no promo cards, no promo reads, legacy cards (`pro_upsell`) for everyone. |
| `PROMOS_DISABLED_KEYS` | empty | Comma list of promo keys to pause (`first_meal,log_meal_now,pro_value,meet_fitzy`). Pausing `pro_value` returns `pro_upsell` to promo@1 clients. |
| `MEAL_REMINDERS_ENABLED` | **on** | `false` stops the 4-slot meal reminders (cron `/api/cron/meal-reminders`, every 15 min). |
| `FITZY_PUSH_ENABLED` / `FITZY_PUSH_DISABLED_KINDS` | off / empty | `fitzy_intro` rides the Fitzy push cron and its kill switch; `FITZY_PUSH_DISABLED_KINDS=fitzy_intro` turns just the intro off. |

Migration **110** (`supabase/migrations/110_promos_activation_journey.sql`, not applied): `promos` (+ 4 seeded system rows), `promo_user_state` (keyed by `promo_key`), `home_feed_events.promo_key/creative_id/button`, `profiles.fitzy_opened_at/fitzy_intro_seen_at/paywall_auto_last_at/paywall_aha_shown_at` (+ backfill of `fitzy_opened_at` from `fitzy_conversations`). Apply 110 before turning `PROMOS_ENABLED` on.

### A.2 Home feed request (promo@1)

```
GET /api/mobile/home-feed
  ?cards=<everything 1.0.8 sends>,promo@1
  &actions=open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1
  &promoLayouts=hero,banner,compact
Headers as today (X-Feed-Schema: 1, X-App-Platform, X-App-Version, X-App-Build, x-client-timezone — the timezone matters for meal slots).
```
- Declare only actions the app can run. Missing `actions=` → only `dismiss@1` → no promo is sent. `open_screen@1` = screens `campaign`(slug), `calendar`(slug), `circles`, `circle`(id), `fitzy`(prompt?), `food_log`, `log_meal`(meal?), `hydration`, `step_history`, `profile`, `settings_notifications`, `health_connect`.
- Keep declaring `pro_upsell@1`: the server suppresses it for you while `pro_value` is live and sends it back if promos are turned off.
- Clients without `promo@1` (1.0.8/1.0.9) get exactly the old feed.

### A.3 promo@1 card

```jsonc
{ "id": "promo:<key>", "type": "promo", "version": 1, "props": {
  "promoId": "<key>", "creativeId": "<variant>", "layout": "hero|banner|compact",
  "theme": { "background": { "kind": "gradient", "colors": ["#…","#…","#…"] }, "foreground": "light" },
  "emoji": "📸",                      // no image in v1: gradient + emoji
  "eyebrow": "…", "title": "…", "body": "…",   // optional eyebrow/body; plain text, ≤ 28/44/120
  "primary": { "label": "…", "action": { "type": "open_screen", "params": { … } } },
  "dismissible": true } }
```
Actions arrive resolved (no `fallback` on the wire). `banner`/`compact`: the whole card runs `primary`. Text colour = white for `foreground: light`.

System promos (examples are exact server output):

| key | layout | example props (abridged) | caps / shown when |
|---|---|---|---|
| `first_meal` | hero | `creativeId first_meal_v1`, eyebrow "Your first step", title "Snap your first meal", body "Take a photo of what you're eating and get calories and macros in seconds. Or just describe it.", emoji 📸, primary "Snap a meal" → `open_screen {screen: log_meal}` (fallback `food_log`) | 0 meals ever; dismiss → 24 h; always position ≤ 2 (right under the header) |
| `log_meal_now` | banner | `creativeId log_meal_now_lunch`, title "Log your lunch", body "A quick photo is all it takes.", emoji 🥗, primary "Log lunch" → `open_screen {screen: log_meal, meal: lunch}`. Breakfast 🍳 / snack 🍎 / dinner 🍽️ variants. | ≥ 1 meal; local time in a slot window (§4) and that slot not logged today (meal_type or entry time); slot toggle on (snack off by default); dismiss → 2 h |
| `pro_value` | banner | A/B: `pro_value_scans` "See exactly what's in every bite" / "Free includes 5 AI meal scans a day. Pro makes them unlimited, so every meal counts." (only while the `food_ai_unlimited` gate is live); `pro_value_coach` "A coach that plans your week" / "With Pro, Fitzy builds a weekly plan around your goals and remembers what works for you."; `pro_value_history` "Your whole journey, in one place" / "Pro keeps your full history and trends, and removes ads." (only while `history_extended` is live; ads clause only while `ads_removed` is live). Eyebrow "FitCircle Pro", primary "See Pro" → `paywall {placement: feed_pro_value}` | free, subscriptions on, ≥ 1 meal, ≥ 18 h since sign-up; shown on ≤ 3 days / 7; dismiss → 48 h; hidden after a subscription |
| `meet_fitzy` | banner | `creativeId meet_fitzy_v1`, title "Meet Fitzy, your coach", body "Ask anything about your meals. Fitzy can tell you what is working and what to try next.", emoji 💬, primary "Chat with Fitzy" → `open_screen {screen: fitzy, prompt: "What do you think of my lunch: Chicken salad?"}` (prompt = PREFILL the composer, don't auto-send) | ≥ 1 meal and Fitzy never opened; dismiss → 72 h |

Feed rules for promo@1 clients: ≤ 2 promo-category cards per feed (promo, campaign, referral, pro_upsell count; `first_meal` doesn't), ≤ 1 in the first 4, never two adjacent. Ranking: first_meal 985 (pinned ≤ 2) > log_meal_now 965 > pro_value 955 > referral 950 > meet_fitzy 905.

### A.4 Events (reuse `POST /api/mobile/home-feed/events`)

Add to each event of a promo card: `promo_id` (= props.promoId), `creative_id`, and for `tap`/`cta` `button: "primary"|"secondary"`; `card_id` stays `promo:<key>`, `card_type` `promo`. Send `impression` (≥ 50 % for ≥ 1 s, once per decision), `cta` on the button / card tap, `dismiss` on ✕ (optimistic hide; the server stores it, so it holds across devices). Conversions are server-side. Also track `Promo Viewed/Tapped/Dismissed` (tracking plan v14).

### A.5 Journey API

`GET /api/mobile/me/journey` → `{ success, data }`:
```jsonc
{ "mealsLoggedEver": 3, "firstMealAt": "2026-10-26T17:58:00Z", "fitzyOpenedAt": null, "fitzyIntroSeenAt": null,
  "paywallAutoEligible": true,      // = autoEligible: may the app present the paywall on its own now
  "autoEligible": true, "postAhaEligible": true, "nextAutoEligibleAt": null,
  "paywallAutoLastAt": null, "paywallAhaShownAt": null,
  "isPro": false, "subscriptionsEnabled": true, "signupAt": "2026-10-26T17:55:00Z",
  "mealReminderPrefs": { "breakfast": true, "lunch": true, "snack": false, "dinner": true } }
```
- `autoEligible`: free + subscriptions on + ≥ 1 meal + ≥ 10 min since sign-up + no automatic paywall in the last 72 h.
- `postAhaEligible`: free + subscriptions on + `first_meal_aha` never shown + 72 h spacing. Not gated on meals/10 min (the app has just seen the aha; the meal may still be in the offline outbox). Show the Meet-Fitzy sheet first when `fitzyOpenedAt == null && fitzyIntroSeenAt == null`, then the soft paywall on the next dismissal.
- User-initiated paywall taps never need a check.

`PATCH /api/mobile/me/journey` `{ "mealReminderPrefs": { "snack": true } }` → `{ data: { mealReminderPrefs } }` (full, with defaults). The same toggles are accepted by `PATCH /api/mobile/notifications/preferences` as `"meal_reminders": { breakfast?, lunch?, snack?, dinner? }`, and its GET now also returns `meal_reminders` (extra key; the six `*_enabled` booleans are unchanged).

`POST /api/mobile/me/journey/events`:
- `{ "event": "fitzy_opened" }` — call on every Fitzy open from any entry point (idempotent; first one stamps `fitzy_opened_at`). The server also stamps it on `POST /fitzy/chat`, `/fitzy/chat/stream` and `GET /fitzy/conversations`.
- `{ "event": "fitzy_intro_seen" }` — the post-first-meal Meet-Fitzy sheet was shown.
- `{ "event": "paywall_shown", "placement": "first_meal_aha", "automatic": true }` — an app-presented paywall (starts the 72 h spacing; `first_meal_aha` also marks the once-only aha). `automatic: false` for user taps (no spacing).

### A.6 Pushes

| type | when | data | routes on 1.0.8/1.0.9 |
|---|---|---|---|
| `meal_reminder_breakfast` / `_lunch` / `_snack` / `_dinner` | 08:30 / 12:30 / 15:30 (opt-in) / 18:30 local, ±15 min; skipped if the slot is logged (meal_type or entry time), quiet hours, the daily cap (3) is reached, the momentum toggle is off, or dormant (no meal in 7 days and ≥ 3 reminders since) | `screen: food_log`, `mealType: <slot>`, `dedupeKey: meal:<slot>:<localDate>`, `category: momentum` | Food Log tab (both apps route by `screen`; `mealType` is ignored / dropped by Android's allowlist). **1.1.0**: open the logger with `mealType` preselected; add `mealType` to Android's `ALLOWED_DATA_KEYS`; add breakfast/snack to iOS `mealResolvedPushTypes`; track `Meal Reminder Opened {slot}`. |
| `fitzy_intro` | day 2–4 after sign-up, ≥ 1 meal, Fitzy never opened, once ever, morning slot (08–11 local), coach toggle + caps + spacing | `screen: fitzy_chat`, `category: coach`, `fitzyTip` (Fitzy's opening line), `dedupeKey: fitzy_intro:<userId>` | Fitzy chat seeded with the tip (both apps: `fitzy_` prefix / `screen: fitzy_chat`) |

### A.7 Analytics (tracking plan v14)

New: `Onboarding Meal Step Viewed`, `Onboarding Meal Step Skipped`, `Onboarding Meal Logged {method}`, `Fitzy Intro Viewed {surface: post_meal_sheet|feed|push}`, `Fitzy Intro Accepted {surface}`, `Promo Viewed {promo, creative, layout, position, campaign?, decision_id?}`, `Promo Tapped {promo, creative, button, action, decision_id?}`, `Promo Dismissed {promo, creative, decision_id?}`, `Promo Converted` (server-recorded only), `Meal Reminder Opened {slot}`. Extended: `Fitzy Opened {surface?, source?}`; `Paywall Viewed/Plan Selected/Dismissed` sources `first_meal_aha`, `feed_pro_value`. Generated constructors were written to web, `FitCircle-iOS-108` and `Fitcircle-Android-108` (`node analytics/codegen.mjs` with `IOS_REPO`/`ANDROID_REPO`).
