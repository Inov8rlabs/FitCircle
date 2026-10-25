# Fitzy coaching tips as push notifications

Status: built on branches `feat/fitzy-push` (backend), `feat/108-fitzy-push` (iOS, from `release/1.0.8`) and `feat/108-fitzy-push` (Android, from `1aa2801`). Nothing is sent until the kill switch is turned on (see [Rollout](#rollout)). 2026-10-22.

Fitzy is the in-app AI coach (docs/FITZY_V2_SPEC.md). This feature sends its coaching as pushes. It sends at most one morning tip and at most one well-timed nudge a day. Every Fitzy push goes through the existing push stack (NotificationOrchestrator → PushService → FCM → APNs/FCM). It also obeys the same preference, quiet-hours and daily-cap rules as every other push.

## 1. The notifications

All five types are category **`coach`**, which has its own toggle, **"Coaching tips from Fitzy"** (`notification_preferences.coach_enabled`, default on). They all open Fitzy chat, seeded with the tip (`screen: fitzy_chat`, see §3). None is cap-exempt, so each counts toward the daily cap of 3.

| Type | Slot | When (user's local time) | Who | Copy | Frequency |
|---|---|---|---|---|---|
| `fitzy_daily_focus` | morning | first hourly run 08:00–10:59 that passes the checks | Users who have chatted with Fitzy (all tiers), active in the last 3 days, who have not already opened today's focus in the app | **AI.** It is today's focus card (`FitzyFocusService.get`, Haiku 5.5), so the push matches the in-app card | ≤ 1/day (morning slot) |
| `fitzy_weekly_recap` | morning | Sunday morning | Pro with a plan this week. That day the focus card *is* the recap (Sonnet 5.5) | **AI** (the recap card) | Sundays only |
| `fitzy_weekly_plan` | morning | Monday morning, **instead of** the daily focus | Pro without a plan this week → "Plan your week". Free → plan teaser, at most once every 14 days, and only if no preview exists yet this week | Template | ≤ 1/week (Pro), ≤ 1/14 days (free) |
| `fitzy_hydration_nudge` | contextual | 11:00–11:59 | Water loggers (water on ≥ 2 of the previous 7 days) with no water logged today | Template (3 deterministic variants per user/day) | ≤ 1/day contextual, ≤ 2 per rolling 7 days |
| `fitzy_protein_nudge` | contextual | 15:00–16:59 | Logged ≥ 1 food entry today, and today's protein is below 40 % of their **own** usual. The usual is the mean over ≥ 3 of the last 7 days with ≥ 2 entries, and must be ≥ 30 g. There are no targets | **AI** for users who have chatted with Fitzy (diet, allergens, memory for Pro). Template otherwise, and on any failure | ≤ 1/day contextual, ≤ 2 per rolling 7 days |

**No coach-voiced streak push.** The evening is already covered by `meal_reminder_dinner` (18:00, carries the streak) and `momentum_at_risk` (19:00, suppressed behind the dinner reminder). A third evening streak nudge would only duplicate them. Instead, Fitzy keeps one daily-cap slot free for them (§2).

### Copy examples (live model output, 2026-10-23, production prompts and parsers)

Morning (`fitzy_daily_focus`). Title and body come from today's focus card:
- "One 20-minute walk keeps your week on track, Priya" / "You've already done two of your three walks this week, which is a lovely rhythm to build on."
- "Five days in a row, Lucía, that's real momentum" / "You've shown up for check-ins all week and moved your body twice already. Today, just log one meal you're enjoying, no changes needed, simply notice what's on your plate."
- "Kenji, your climbing-strength week is on track" / "You've already finished both kettlebell sessions, which is a great foundation for climbing season."
- Headline over 50 chars → "Today's focus from Fitzy ☀️" / "Hi Sam, no pressure at all, just a small idea for today. A short walk after a meal or while listening to something you enjoy can feel refreshing and easy to fit in."

Protein (`fitzy_protein_nudge`, AI):
- Vegan, tree-nut allergy: "Afternoon fuel idea ✨" / "Kenji, roasted chickpeas or hummus with veggies would be a tasty, vegan boost before climbing season kicks in. 🌱"
- Vegetarian, peanut allergy: "Afternoon fuel idea ✨" / "Priya, a little Greek yogurt or a boiled egg with veggies would make a great pick-me-up before your evening. Enjoy!"
- Vegetarian: "A little afternoon boost, Lucía ✨" / "Try hummus with crunchy veggies or a handful of edamame. Easy, tasty, and it keeps your energy steady."
- "Afternoon fuel idea, Dana ✨" / "A cottage cheese bowl with berries or a tuna wrap would be a great fit for your 10K training. Enjoy!"
- Caught by the allergen check (an earlier prompt version), so the template was sent instead: "Afternoon fuel idea 🥜" for the peanut-allergic persona.
- Template (vegetarian, nut allergy; the idea list rotates per user and day): "A protein boost for later 💪" / "A boiled egg, hummus with veggies or edamame could round out your afternoon."

Templates:
- Hydration: "Water break? 💧" / "A glass now makes the afternoon easier. Log it in a tap." (also "Sip check 💧", "Hydration hello 💧")
- Weekly plan, Pro: "Plan your week with Fitzy 🗓️" / "Tell me one thing you want from this week and I'll turn it into a few small, doable commitments."
- Weekly plan, free: "Your week, planned in a minute 🗓️" / "Fitzy can turn one goal into a few small, doable steps. Take a peek at this week's plan."

Follow-up chat after tapping (Haiku 5.5, Opus-judged 7–8/10, 0 safety fails). Tip: "A protein boost for later…", user: "How do I fit that in on a busy day?" → "Busy shifts are easier when protein is ready to grab. A few ideas that fit a vegetarian diet: **Prep ahead:** boil a few eggs at the start of the week… **Keep a portable option:** a single-serve Greek yogurt…"

### Free vs Pro

These rules follow the existing teasers: free users get the daily focus (the hook), and planning and memory are Pro.
- The daily focus and the contextual nudges go to both tiers. Pro copy is grounded with Fitzy memory, because `FitzyService.grounding` only adds memory for Pro.
- The Sunday recap is Pro only.
- On Monday, Pro users without a plan get "Plan your week". Free users get the teaser at most every 14 days. Tapping it opens Fitzy, where the plan strip shows the locked preview and the "Unlock your weekly plan" paywall (`Fitzy Locked Feature Viewed` / `Upgrade Tapped`, as before).

## 2. Rules, caps and dedupe

Checked in this order (`lib/fitzy/push.ts` `commonSkip` + `morningKind`, then the orchestrator):

1. **Kill switch.** `FITZY_PUSH_ENABLED` must be exactly `true`. `FITZY_PUSH_DISABLED_KINDS=<type,type>` turns single kinds off.
2. **Preference.** `coach_enabled` must not be `false` (null or absent counts as on). The legacy `profiles.preferences.notifications.push=false` master switch is honoured by the orchestrator.
3. **Quiet hours.** These are pre-checked so no model call is wasted (the default 22:00–07:00 applies when there is no preferences row), and the orchestrator checks again. The morning window is three hours long, so a user whose quiet hours end at 09:00 still gets the tip at 09:10.
4. **Activity.** A streak claim, food log or workout in the last 3 local days. Dormant users get the journey ladder (`dormant_*`), not Fitzy.
5. **Daily cap budget.** Fitzy only sends while fewer than **2** cap-counted pushes have gone out today (cap 3, minus 1 reserved slot). This leaves room for the evening `momentum_at_risk` / `near_milestone`. Cap-exempt types (chat, meal reminders, outcomes) don't count.
6. **Spacing.** No Fitzy push within **90 min** of any delivered push. This covers the 13:00 lunch reminder, campaign pushes, chat and so on. The hydration slot (11:00) sits two hours before the lunch reminder for the same reason.
7. **Per-kind frequency.** Contextual kinds are capped at 2 per rolling 7 days each. The free plan teaser is capped at 1 per 14 days.
8. **Morning dedupe.** If a `fitzy_daily` row already exists for today, the user has already opened today's focus in the app, so there is no push.
9. **Relevance.** Hydration and protein rules as in §1.
10. **Idempotency.** Before generating, the service inserts `(user_id, '<slot>:<local date>')` into **`fitzy_push_deliveries`**. The primary key makes a cron retry, a concurrent run or a late pass a no-op (`duplicate`). There is one key per slot, so at most one morning push and **one contextual nudge** per user per local day. If the table is missing (migration 107 not applied), the service **fails closed** (`claim_failed`, nothing sent). The row's `status` records the outcome (`sent`, `no_delivery`, `frequency_cap`, …).

Each user's local time comes from the same timezone priority as `ReminderService`: `notification_preferences.quiet_hours_timezone`, then the latest `streak_claims.timezone`, then New York. Known limitation, shared with the meal and streak reminders: `createDefaults` stamps `America/New_York` on new preference rows, so users who never open notification settings are scheduled in Eastern time.

## 3. Content, safety and privacy

- **AI only with consent evidence.** AI data-sharing consent is held on the device only. The server uses "has a `fitzy_conversations` row" as its signal: the apps can't send a chat message without consent. Users without that signal get **templates only**, so no data of theirs reaches a model for a push, and no daily-focus push. (A pre-existing gap, not changed here: the in-app `/fitzy/today` card is fetched without a consent check on both apps.) The server can't see a consent that was revoked later on the device.
- **Lock screen.** `lockScreenSafe` rejects numbers with food or body units (g, kg, lb, kcal, %, ml…) and weight / calorie / macro / BMI / body-fat / plate-score words. The orchestrator's existing pushes show only streak days and workout counts, and this matches that. For the daily focus, the title and body fall back independently: a long or unsafe headline becomes "Today's focus from Fitzy ☀️", and an unsafe body becomes "One small, doable idea for today is waiting for you." The full card still reaches the chat as the tip.
- **Allergens.** The protein nudge is rejected when it names or pictures a food the user is allergic to (`mentionsAllergen`: peanuts, tree nuts, dairy, eggs, soy, fish, shellfish, sesame, gluten; words and emoji). Template ideas are allergen- and diet-filtered.
- **Guard.** Every AI text passes `FitzyService.containsForbiddenContent`. The protein nudge is also rejected for judging words ("behind", "low", "not enough", "only", "missed"…). The prompt forbids numbers, shaming, restriction, targets and medical topics.
- **Limits.** Title ≤ 50 chars. Body ≤ 150 chars, or ≤ 178 for the focus card (about 4 lock-screen lines), trimmed at a sentence end. Tip ≤ 400 chars in the data payload.
- **Fallbacks.** If the model errors, times out (20 s for the nudge, 45 s for the focus) or produces unparseable or unsafe copy, the template is used. The focus service's own static focus applies on its side.
- Templates are deterministic per user and day, so a retry picks the same variant. Protein ideas respect diet (`vegan`, `vegetarian`, `gluten_free`) and allergens.

### Tap → Fitzy chat with the tip as context

The push data carries `type`, `category: coach`, `screen: fitzy_chat` and **`fitzyTip`** ("headline\n\nbody"):
- **iOS** (`DeepLinkRouter`): `fitzy_chat` + tip → `.fitzyTip(FitzyPushTip)` → `AppFeature.openFitzyWithTip`. This opens a **fresh** Fitzy chat whose first message is the tip (headline in bold) with chips "Tell me more" / "How do I fit this in?" / "Give me another idea". It tracks `Fitzy Opened {surface: push}`. Without a tip it opens plain `.fitzy`.
- **Android** (`NotificationDeepLink`): `fitzy_chat` and `fitzyTip` are allowlisted. The tip is **sanitized as untrusted** because MainActivity is exported: control characters, URLs and Markdown link/HTML characters are stripped, and it is capped at 400. `MainScreen` hands it to `FitzyPushTipHolder` and opens the Fitzy sheet, and `FitzyChatViewModel` starts the same tip-seeded fresh chat.
- On the first message, both apps send the tip once as `clientMessages: [{role: assistant, content: tip}]`, and the server stores it as the conversation's first turn. The Anthropic API needs a user turn first, so `FitzyService.withUserFirst` prepends a synthetic "(I opened your notification.)" for the model only. It is never stored.
- **Older app builds:** iOS doesn't know `fitzy_chat`, so it falls back to `type`. `fitzy_*` matches no prefix rule there and lands on **Home**, where the Fitzy focus card is. Android drops the unknown screen and `screenForType` returns `dashboard` (Home). Both just open the app sensibly.

### Android "Coach" channel

The backend sets `android.notification.channel_id = fitcircle_coach` for coach pushes only. New builds create the **Coach** channel (`IMPORTANCE_DEFAULT`, "Coaching tips from Fitzy"). Foreground pushes are routed there via `category: coach` and use BigText. On older builds the channel doesn't exist, and FCM falls back to the default channel. Existing categories' channels, sound and interruption are unchanged.

### iOS presentation

No new `UNNotificationCategory`: a tap is the default action. Interruption level is the default (active). The unmerged `feat/push-categories` branch (rich categories, interruption levels, and the undecided "passive" proposal) is untouched. If it merges, consider mapping `fitzy_hydration_nudge → WATER_REMINDER` in `TYPE_APNS_CATEGORY` for the +250/+500 ml buttons. Whether coach pushes should be passive is part of that open proposal.

## 4. How it is set up

| Piece | Where |
|---|---|
| Cron | `GET /api/cron/fitzy-coach`, **hourly at :10** (`apps/web/vercel.json`), `maxDuration 300`, 6 users in parallel, stops starting new users after 240 s. A user skipped for time is picked up on the next hour inside their window. CRON_SECRET-gated, fails closed |
| Policy (pure, tested) | `apps/web/app/lib/fitzy/push.ts` (windows, `commonSkip`, `morningKind`, relevance, `lockScreenSafe`, templates, `NUDGE_PROMPT`/`nudgeRequest`/`parseNudge`/`mentionsAllergen`) |
| Service (I/O) | `apps/web/app/lib/services/fitzy-push-service.ts` (batched reads, claim, generation, send, outcome) |
| Catalog | `notification-orchestrator.ts` (5 types, `fitzy_chat` screen, `fitzyTip` payload, Android channel), `notification-preferences-service.ts` (`coach` category), `push-service.ts` (`androidChannelId`) |
| Preference | `coach_enabled` in `PATCH /api/mobile/notifications/preferences`. Toggles in the iOS and Android notification settings and on web `/settings/notifications`. All three **hide the toggle until the backend returns the field**, so nothing PATCHes a column that doesn't exist yet |
| Schema | `supabase/migrations/107_fitzy_coach_push.sql`: `notification_preferences.coach_enabled` (default true) + `fitzy_push_deliveries` ledger. No functions or triggers |
| Models | Existing Fitzy setup: `FITZY_CHAT_MODEL` (Haiku 5.5) for focus + nudges, `FITZY_DEEP_MODEL` (Sonnet 5.5) for the Sunday recap. About $0.0001 per AI push (eval-measured) |

Env vars (all optional except the switch):

| Var | Default | |
|---|---|---|
| `FITZY_PUSH_ENABLED` | off | **Kill switch.** Must be `true` to send |
| `FITZY_PUSH_DISABLED_KINDS` | — | Comma list of types to skip |
| `FITZY_FOCUS_LOCAL_HOUR` | 8 (5–12) | Start of the 3-hour morning window |
| `FITZY_HYDRATION_LOCAL_HOUR` | 11 (9–14) | 1-hour window |
| `FITZY_PROTEIN_LOCAL_HOUR` | 15 (13–17) | 2-hour window |

### Testing and sending a test push

```bash
# What would happen right now for everyone in a window (no claim, no model call, no send):
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/fitzy-coach?dryRun=1"
# One user's decision:
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/fitzy-coach?dryRun=1&userId=<uuid>"
# Send one kind to one user now (works with the kill switch off; ignores the hour window, spacing and weekly caps;
# the coach toggle, quiet hours and the daily cap still apply in the orchestrator). Uses a unique test claim key.
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/fitzy-coach?userId=<uuid>&force=fitzy_protein_nudge"
```

The response lists per-user decisions (`kind`, `skip` reason, `sent`, `source: ai|template`). Delivered and suppressed pushes are in `notification_log` (`notification_category = 'coach'`). Claims and outcomes are in `fitzy_push_deliveries`.

Automated:
- `apps/web/app/lib/services/__tests__/fitzy-push.test.ts` covers windows, kill switch, toggle, quiet hours, activity, cap budget, spacing, weekly caps, morning logic, relevance, lock-screen filter, limits, templates, allergens (ideas and AI-copy check), nudge parsing, claim, dedupe, fail-closed, dry run, template fallback, recap typing and the tip seed turn. `notification-catalog.test.ts` covers the contract (`fitzy_chat` added).
- Live model eval through the production code: `npm run fitzy:eval -- --suite=push` (daily focus → push copy, protein nudge) and `--suite=chat --tag=push` (chat opened from a tip). **Run it after any change to `NUDGE_PROMPT`, `lockScreenSafe`, the limits or the Fitzy models.** Last run (3 reps × 8 personas): push_focus 24/24, push_protein 24/24, tip follow-up chat judged 7.67 mean / 0 safety fails, about $0.006 without the judge.
- iOS: `FitCircleTests/FitzyPushTests.swift` (routing, fallbacks, sanitizing, seeded chat, `clientMessages`, coach preference decode, visibility and PATCH). Android: `core/services/FitzyPushTest.kt` (allowlist, sanitizing, fallbacks, Coach channel, seed, holder, preference).

### Analytics

There are no server "push sent" events in the tracking plan. `notification_log` is the sent record (type, category `coach`, `data.fitzySource` = ai/template). Opens use the existing `Push Notification Opened` (Android: `notification_type` = the fitzy type, `route` = `fitzy_chat`. iOS: `route` = `fitzyTip`). iOS also sends `Fitzy Opened {surface: "push"}`. `surface` is a free string, so the tracking plan needs no change. Settings changes use `Notification Settings Changed {setting: coach}` (Android, iOS) or `coach_enabled` (web).

## 5. Interaction with existing notifications

The orchestrator's general duplicate, burst and grouping rules (docs/PUSH_NOTIFICATIONS.md) apply to Fitzy pushes too. The identical-content guard (10 min) and the thread-id `fitcircle.coach` apply. Fitzy types are not burst types.

| Existing | Interaction |
|---|---|
| Daily cap (3) | Fitzy counts toward it and leaves one slot free for the evening streak reminder |
| `meal_reminder_lunch` 13:00 / `meal_reminder_dinner` 18:00 | 90-min spacing. Hydration at 11:00. Protein needs a food log today, so it never overlaps "you haven't logged" |
| `momentum_at_risk` / `near_milestone` 19:00 | No Fitzy streak push. A slot is reserved for these |
| `daily_drop`, campaigns (hourly :02), chat | 90-min spacing. If they fill 2 cap slots before Fitzy, Fitzy stays silent that day |
| `weekly_summary`, journey / dormancy ladder | Fitzy requires activity in the last 3 days, so dormant users only get the ladder |
| Quiet hours (migration 082) | Pre-checked and enforced. The morning window (3 h) absorbs late quiet-hour ends |

## 6. Rollout

1. **Apply migration 107** (`supabase/migrations/107_fitzy_coach_push.sql`). 106 is the home-feed migration on another branch, so apply 106 first if it ships first; 107 doesn't depend on it. Without 107 nothing sends (fail closed), and the toggles stay hidden.
2. **Deploy the backend** (`feat/fitzy-push`). The cron is registered by `apps/web/vercel.json`. Check with `vercel crons ls`.
3. **Smoke test** with `?dryRun=1`, then `?userId=<your id>&force=fitzy_daily_focus` and `force=fitzy_hydration_nudge` to your own device. Check the tap opens Fitzy with the tip (iOS 1.0.8 build / Android build from these branches) and that an older build lands on Home.
4. **Set `FITZY_PUSH_ENABLED=true`** in Vercel production, then redeploy so functions pick it up. Optionally start with `FITZY_PUSH_DISABLED_KINDS=fitzy_protein_nudge,fitzy_hydration_nudge` and send the morning tip only.
5. **Ship the apps.** iOS 1.0.8 (`feat/108-fitzy-push`) and Android (`feat/108-fitzy-push`) bring the seeded chat, the Coach channel and the toggle. The backend works with old builds; they open Home.
6. Watch `notification_log` (category `coach`) and `fitzy_push_deliveries.status` for the first days. If anything looks off, set `FITZY_PUSH_ENABLED` to anything other than `true` to stop all Fitzy pushes at once.
