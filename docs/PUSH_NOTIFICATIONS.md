# Push notifications: fan-out, dedupe and grouping

Status: branch `fix/push-dedupe`, 2026-10-25. Not deployed yet.

This doc describes how one event becomes pushes. It was written after the incident on 2026-10-24: a user who is in 5 circles got five "🎉 Big moment in <circle>" pushes about his own 7-day streak, and every member got one push per circle they shared with him. Every night the daily summary also sent one push per circle.

All pushes go through `NotificationOrchestrator.send()` (`apps/web/app/lib/services/notification-orchestrator.ts`), then `PushService` and FCM (FCM relays to APNs for iOS). Fitzy coaching pushes have their own rules on top of this one (docs/FITZY_PUSH_NOTIFICATIONS.md).

## 1. Rules

1. **A user never gets a push about their own action.** This covers rallies, system posts, meal cards and bundled posts. Everyone in a bundled post ("Ani & Bob all got moving") is excluded. The in-app chat post still appears in every circle. Only the push changes.
2. **One push per recipient per underlying event**, however many circles the recipient shares with the actor.
3. **Mute counts for every system post, rallies included.** A member who muted every circle the event was posted to gets nothing. @mentions still pierce mute.
4. **The daily summary is one push per recipient per night**, covering all of their circles.
5. **Safety net:** an event is delivered at most once per user per `dedupeKey` per 24 h. Identical content goes to the same user at most once per 10 min.
6. **Burst control:** at most 3 ambient social or celebration pushes per user per 2 min. The rest are dropped with reason `burst`.

## 2. Cross-circle fan-out

Some events start from one user action and are posted to every circle the user is in:

| Event | Source |
|---|---|
| `streak_milestone` (P0 rally) | `MomentumService` → `ChatActivityHooks.onStreakMilestone` |
| `workout_done` | `ChatActivityHooks.onWorkoutCompleted` |
| `meal_logged` (meal card) | `CircleMealPostService.onMealLogged` |

How the push is coalesced:

1. The hook writes the post in each circle with `SystemPostEngine.ingest(signal, { push: 'collect' })`. In this mode the engine returns the push intents and does not send anything.
2. Each intent carries an `eventKey`, built by `SystemPostEngine.eventKeyFor`:
   - For the events in `CROSS_CIRCLE_EVENTS`, the key leaves the circle out, so it is the same in every circle. For example `streak_milestone:<actor>:d7` or `workout_done:<actor>:<workoutId>`.
   - Single-circle events append `@<circleId>`.
3. The hook passes all the intents in one call to `ChatNotificationService.notifySystemEvent(intents)`. The pure function `planEventPushes` then works out, for each `eventKey`:
   - **Recipients:** every active member of the event's circles, minus the actors, minus `excludeUserIds`, minus anyone who muted every one of those circles.
   - **The circle the push is about:** the first circle, in the hook's membership order, that the recipient shares unmuted. Its chat is the deep link.
   - **One push** per recipient, with `dedupeKey = evt:<eventKey>`.

Push copy:

| Kind | Shares 1 circle | Shares several circles |
|---|---|---|
| Rally (`chat_rally`) | "🎉 Big moment in Step-Up Circle" / "Ani's on a 7-day streak — nice 🔥" | "🎉 Ani's on a 7-day streak 🔥" / "Celebrate in Step-Up Circle and 2 other circles" |
| System post / meal (`chat_message`) | "Ani in Step-Up Circle" / "Ani just logged a workout 💪" | "Ani in Step-Up Circle and 2 other circles" / "Ani just logged a workout 💪" |

On Android, chat pushes are data-only and the app draws them itself as one conversation per circle. Its title comes from `circleName` and `preview`, so a coalesced push shows the deep-link circle and the post text there. It is still only one push.

Single-circle events (quests, joins, challenge milestones, saves) take the same path with one intent, using the default `push: 'immediate'`.

### 2.1 Posts that never get an engine push

For some events, the source already sends its own typed push to the members. For these, `NO_ENGINE_PUSH_EVENTS` writes the post and sends no chat push. Before this change, every member got two pushes for the same moment.

| Post | Its dedicated push |
|---|---|
| `circle_streak` | `circle_streak_milestone` from `CircleStreakService`, `dedupeKey circle_streak:<circle>:<days>` |
| `circle_kickoff` | `circle_kickoff` from `CircleLobbyService`, `dedupeKey circle_kickoff:<circle>` |
| `daily_summary` | Bundled by `DailySummaryService` (§2.3) |

For `circle_streak_saved`, the saver is the actor and the covered friend is in `excludeUserIds`, because the friend already gets the dedicated `circle_streak_saved` push.

`circle_streak_milestone` still fires once per circle, because each circle has its own streak. These pushes come at different times, and the burst guard (§4) catches the case where several arrive together.

### 2.2 Member messages and reactions

These still go to one circle. Typed messages carry `dedupeKey msg:<messageId>`. Reactions carry `react:<messageId>:<reactor>:<emoji>`.

### 2.3 Daily summary

The hourly cron (`DailySummaryService.generateForAllActiveCircles`) still writes one in-app summary post per circle. After the batch, `sendBundledPushes` loads each circle's members and mute state. The pure function `planSummaryPushes` then plans one `circle_daily_summary` push per recipient, covering every summarized circle they are an unmuted member of:

| Situation | Push |
|---|---|
| One circle | "Step-Up Circle today" / "2 of 6 checked in today 👏". Deep link: that circle's chat. |
| Several circles | "Your circles today" / "Ani's Crew: you checked in ✅ · Step-Up Circle: 2 of 6 checked in". Up to 4 lines, then "· +N more". No `circleId`, so it opens the circles list. |
| Only solo circles (you are the only member) | No push, because it would be about your own check-in. A solo circle is still listed when there is a shared circle to report. |

- `dedupeKey` is `daily_summary:<circle local date>`. A second cron tick on the same night is suppressed as `duplicate`. If a recipient's circles are in different timezones, they are summarized in different ticks, and only the first tick's circles reach the push. The others are still in the app.
- `circle_daily_summary` has category `social`, so it follows the same toggle as chat. It is cap-exempt, like the chat pushes it replaces. It uses the standard notification shape on Android, so older app builds display it as-is.

## 3. Duplicate guard (`NotificationOrchestrator.send`)

The guard runs before the preference, cap, quiet-hours and suppression checks.

1. **In-process claim:** the keys are `(user, dedupeKey)` with a 24 h TTL and `(user, type, title, body)` with a 10 min TTL.
   - The first send claims the keys. Any concurrent or later send in the same instance is logged `suppressed, reason 'duplicate'`.
   - This makes concurrent fan-outs within one request race-safe. All of them would otherwise read an empty `notification_log` before any of them had logged.
   - Claims are released when nothing was delivered (`no_delivery`, `quiet_hours`, `category_disabled`, …), so a later retry can still go out.
2. **`notification_log` backstop** (works across instances):
   - A row with `suppressed = false` and `data->>'dedupeKey'` equal to the key in the last 24 h means duplicate.
   - Identical `(notification_type, title, body)` in the last 10 min also means duplicate.
   - The check fails open: if the DB errors, the push is sent.
   - `dedupeKey` is stored in `data` (jsonb), the same way all push data is logged. Migration `109_notification_log_dedupe_index.sql` adds a partial expression index on `(user_id, (data->>'dedupeKey'), sent_at desc)`. The code works without it.

What this does not cover: two different serverless instances that send the same key within the few hundred milliseconds before either one has logged. Coalescing at the source (§2) is what keeps this from happening in practice. The guard is the safety net.

Callers pass the key as `data.dedupeKey`. Keys used today: `evt:<eventKey>`, `msg:<id>`, `react:…`, `daily_summary:<date>`, `circle_streak:<circle>:<days>`, `circle_kickoff:<circle>`, `circle_streak_saved:<saveId>`.

## 4. Burst control

The types in `BURST_TYPES` count toward the limit:

- `chat_message`, `chat_rally`, `chat_reaction`
- `circle_daily_summary`, `circle_streak_milestone`, `perfect_day`, `circle_boost_threshold`, `friend_joined_circle`

If a user already has `BURST_LIMIT` (3) of these delivered or in flight in the last `BURST_WINDOW_MINUTES` (2 min), the next one is **dropped** with reason `burst`. The count is the larger of the in-process reservations and the `notification_log` rows.

We chose dropping over a bundled "3 more updates in your circles" push:

- Bundling needs a delayed send, and this stack has no queue.
- Every dropped item is still in the in-app timeline.
- iOS already groups what was delivered by thread.

`chat_mention`, outcomes (rewards, streak loss, shields) and reminders are never dropped for a burst.

Since 2026-11-02, on devices that registered with the client feature `chat_quiet`, a member's own chat message (`data.conversation`) is never dropped either: inside a circle's 2-minute window it is delivered **quietly** instead (passive, no sound, `data.quiet`). Devices without `chat_quiet` (every shipped build) keep the rule above unchanged; `PushService.forDevice` applies it per token. See `docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md` §2 for the alert-once rule, `summary-arg`, the unread badge and the cheer push.

## 5. Wire grouping

| | iOS (APNs, via FCM `apns`) | Android (FCM) |
|---|---|---|
| Group | `aps.thread-id`: the circle id for chat, `fitcircle.<category>` for everything else | Chat is data-only and the app groups it per circle (`CHAT_GROUP_KEY`). `data.groupKey` is also sent whenever there is a dedupeKey. |
| Replace, don't stack | `apns-collapse-id` header set to `collapseIdFor(dedupeKey)` | Standard shape: `android.notification.tag` set to the same value. Data-only chat: `data.dedupeKey` (current apps ignore it; they already replace per circle id). |

`collapseIdFor` returns the key itself when it is printable ASCII of at most 64 bytes. Otherwise it returns a stable 64-char sha256 hex digest. With no dedupeKey, the wire format is unchanged.

FCM's `collapse_key` is not used, because FCM keeps only 4 distinct collapse keys per device.

## 6. Tests

`apps/web/app/lib/services/__tests__/push-dedupe.test.ts` replays the incident end to end: hooks → engine → chat fan-out → orchestrator → FCM message, with an in-memory DB. It also covers:

- The planner, and daily-summary bundling
- `dedupeKey` (in-process and `notification_log`), the identical-content guard, concurrent sends, and retry after no delivery
- Burst control, the payload's `thread-id` / `apns-collapse-id` / `tag`, and the posts that have dedicated pushes

## 7. Delivery analytics and open tracking

Added 2026-11-12 (branch `feat/checkout-exit-analytics`, tracking plan v33). Before this, `notification_log.opened_at` was never set (clients reported opens only to Amplitude, without an id to join on), so the open rate could not be measured per push.

### 7.1 `notification_id` in every payload

`NotificationOrchestrator.send()` generates the `notification_log` row id (`crypto.randomUUID()`) before anything else. Every `send()` writes exactly one row with that id, whatever the outcome. The row is still inserted **after** the FCM call, so the duplicate guard (§3), which counts delivered rows, is unchanged. Every delivered payload carries it:

| Key | Value |
|---|---|
| `data.notification_id` | the `notification_log.id` (lowercase UUID string) |

It is additive. Android's `ALLOWED_DATA_KEYS` drops it until a build adds it; iOS ignores unknown keys. Pushes sent outside the orchestrator (`CampaignDeliveryService`) have no `notification_log` row and no `notification_id`.

### 7.2 `Push Sent` (server, Amplitude)

There is one `Push Sent` event per `notification_log` row the orchestrator writes (`lib/notifications/push-sent-events.ts`). `user_id` is the profile id, and `platform` is `server`.

| Property | Value |
|---|---|
| `notification_type` | `notification_log.notification_type` |
| `notification_category` | `notification_log.notification_category` |
| `outcome` | `sent`: delivered to at least 1 device. `no_token`: the user has no active push token. `failed`: tokens exist, but FCM accepted none. `suppressed`: any guard stopped it before sending (including a quiet-hours deferral, and a burst follow-up that no device takes). |
| `suppression_reason` | `notification_log.suppression_reason` for every non-`sent` outcome (`duplicate`, `category_disabled`, `frequency_cap`, `quiet_hours`, `deferred_quiet_hours`, `burst`, `suppressed_by_<type>`, `no_delivery`) |
| `push_platform` | `ios`, `android` or `both`: the platforms of the active tokens targeted. Absent when the send stopped before the token read. |
| `notification_id` | the row id |

Delivery:

- Events are queued in-process. One flush is scheduled after the response (`runAfterResponse` → Next `after()`, which also works in cron route handlers), so one cron tick becomes one HTTP V2 request, or one per 500 events.
- `insert_id = push-sent:<notification_log id>` makes retries idempotent.
- A 2.5 s timeout applies, and nothing ever throws.
- It is a no-op when `AMPLITUDE_SERVER_API_KEY` is unset or `off`, using the same key resolution as the server Identify (`lib/analytics/amplitude-server.ts`).

The push and the log row never depend on Amplitude.

### 7.3 `POST /api/mobile/notifications/opened`

The app calls this when the user taps a push that has `data.notification_id`. It uses mobile auth (Bearer).

Request body:

```json
{ "notification_id": "<uuid from data.notification_id>", "action": "default" }
```

- `notification_id` is required and must be a UUID. Upper case is accepted, which covers iOS `uuidString`.
- `action` is optional. It must match `^[A-Za-z0-9_.-]{1,64}$`: `default` for a body tap, or the action button id such as `log_meal` or `snooze`. `null` is treated as absent.

| Status | When |
|---|---|
| `204` (no body) | Recorded. The first open sets `notification_log.opened_at = now()`, and the action is stored in `data.openedAction`. A repeat (retry, second tap) is also `204` and changes nothing. |
| `400 VALIDATION_ERROR` | `notification_id` is missing or not a UUID, the action is malformed, or the body is not JSON. |
| `401 UNAUTHORIZED` | Missing or invalid token. |
| `404 NOT_FOUND` | There is no row with that id for this user. Another user's id also returns 404. |
| `500` | Read or update failed (reported to Sentry). |

Every response is `Cache-Control: no-store`. The update is conditional on `opened_at is null`, so concurrent first opens record once. Clients should fire it in the background and should not retry on 4xx.

Clients should also keep sending `Push Notification Opened {notification_type, route, notification_id, action}` and `Push Dismissed {notification_type, notification_id}` to Amplitude. The open rate from the server is `opened_at is not null` over `suppressed = false` rows in `notification_log`, or `Push Notification Opened` ÷ `Push Sent {outcome: sent}` in Amplitude, joined on `notification_id`.

The older `POST /api/mobile/notifications/[id]/opened` is kept for compatibility. No shipped client calls it, and it overwrites `opened_at` on every call.

### 7.4 Meal reminder payload and copy

Meal reminders (`meal_reminder_{breakfast,lunch,snack,dinner}`) carry these data keys:

| Key | Value | Who reads it |
|---|---|---|
| `type` | `meal_reminder_<slot>` | all |
| `category` | `momentum` | all |
| `screen` | `food_log` | Shipped apps route by it (Food Log tab). It stays the fallback. |
| `mealType` | `breakfast` / `lunch` / `snack` / `dinner` (the slot) | 1.1.0+, which opens the logger with the slot preselected |
| `route` | `log_meal_camera` | New. The meal logger opens straight into the camera. Shipped apps never read `data.route`: Android's allowlist drops it, and iOS routes by `screen`. So it is safe for old clients. |
| `dedupeKey`, `groupKey` | `meal:<slot>:<localDate>` / thread | §3, §5 |
| `notification_id` | the row id | §7.1 |

The copy is action-led ("Lunch time — snap it in 5 seconds" / "Take a photo and FitCircle does the counting.").

- Each slot has 2–3 variants in `MEAL_REMINDER_COPY` (`lib/journey/meal-reminders.ts`). The variant is picked by the user's local date (days since epoch mod n), so consecutive days differ and a cron re-run picks the same text.
- The copy has no emoji and no invented data.
- The only number ever shown is the user's own streak, on dinner, and only when today's claim is still open. This is why `momentum_at_risk` is suppressed after a dinner reminder.

Tests: `lib/services/__tests__/push-sent-tracking.test.ts` and `api/mobile/notifications/opened/__tests__/route.test.ts`.
