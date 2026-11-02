# Chat from anywhere, grouped chat notifications, leaderboard cheers — contract as built (backend + web)

Status: built on `feat/chat-nav-cheers` (2026-11-02). **Migration 123** (written, not applied):
`push_tokens.client_features text[]` — the per-device gates `chat_badge` (§2.3) and `chat_quiet` (§2.1), see §2.5. Cheers fit the
existing `circle_messages` columns and rate limits count existing rows, so they need no migration.
The backend works before 123 is applied (it registers tokens without the column and sends no badge). Product spec:
`CHAT_ACCESS_NOTIF_CHEERS_SPEC.md` (lead's scratchpad). Builds on `docs/CHAT_REACTIONS_V2.md`,
`docs/CIRCLE_STEPS_LEADERBOARD.md`, `docs/PUSH_NOTIFICATIONS.md`, `docs/HOME_FEED_SPEC.md`.

All mobile routes use the standard envelope `{ success, data, error, meta }`, Bearer auth,
`Cache-Control: private, no-store`. The web app calls the same `/api/mobile/*` routes with its
session token (no separate web routes).

---------------------------------------------------------------------------------------------------
## 1. `GET /api/mobile/chats` — the chat inbox

Every circle the viewer is an **active member** of, with unread counts and the last message.

```jsonc
{
  "success": true,
  "data": {
    "chats": [
      {
        "circle_id": "7d3f…",
        "circle_name": "Nov steps challenge",
        "circle_avatar_url": null,            // fitcircles.cover_image_url when https, else null
        "circle_type": "step_count",          // fitcircles.type
        "unread_count": 3,                    // counted even when muted
        "muted": false,
        "last_message": {                     // null when the circle has no visible message
          "id": "a1b2…",
          "sender_id": "d152…",               // null for system posts
          "sender_display_name": "Raveesh",   // system post: its first actor's name, else null
          "preview": "Let's go!",             // ≤ 80 chars, single line; "Photo" for a photo
          "kind": "user_text",                // user_text | user_photo | system_event
          "is_cheer": false,                  // true for a leaderboard cheer (§3)
          "created_at": "2026-11-02T18:01:00Z"
        },
        "last_read_at": "2026-11-02T17:00:00Z",   // null = never opened
        "last_activity_at": "2026-11-02T18:01:00Z" // last visible message, else the member's joined_at
      }
    ],
    "total_unread": 3,          // sum of unread_count over NON-muted circles → number badge
    "muted_unread": 5,          // sum over muted circles → show a dot when total_unread == 0
    "default_circle_id": "7d3f…" // what the top-nav button opens (null when chats is empty)
  },
  "error": null,
  "meta": { "requestTime": 41 }
}
```

Rules:

- **Order**: `last_activity_at` desc (ties: name). The switcher shows unread (non-muted) circles
  first, then the rest — clients partition this list, they do not re-sort by anything else.
- **`default_circle_id`**: the circle whose newest **unread** message is newest (non-muted first;
  muted only if nothing else is unread); else the first chat (most recent activity).
  Exactly one circle → that circle.
- **Unread** = messages with `created_at > last_read_at` (all messages when never read), **not**
  sent by the viewer, **not** deleted, **not** from a member the viewer blocked / who blocked the
  viewer (`circle_member_blocks`, both directions). System posts count. Look-back is capped at
  **30 days** and 2,000 messages per request (a never-opened busy circle shows `99+` anyway).
- **Last message** skips deleted messages and blocked senders the same way.
- Reuses the existing read cursor: `POST /api/mobile/circles/{id}/read` (unchanged) sets
  `circle_chat_state.last_read_at = now()`. Mute: `POST /api/mobile/circles/{id}/mute` (unchanged).
- Cost: at most 8 queries regardless of circle count (memberships; then in parallel circles,
  chat state, blocks, the light message window; then a fallback for circles silent for 30 days,
  one detail read for the chosen last messages, one profiles batch). No per-circle queries.
- Realtime: no new channel. Clients bump/re-fetch on existing `circle_messages` INSERT events and
  on foreground. Opening a chat calls `/read` as today, then re-fetch `/chats` for the badge.
- Errors: `401 UNAUTHORIZED`, `500 INTERNAL_SERVER_ERROR`. Zero circles → `chats: []`,
  `total_unread: 0`, `default_circle_id: null` (clients hide the button).

---------------------------------------------------------------------------------------------------
## 2. Chat push payload (every chat push; FCM v1 → APNs + Android)

Unchanged keys keep their meaning. **New** keys are marked ★. All FCM `data` values are strings.

### FCM `data` (Android data-only; iOS gets them as top-level `userInfo` keys)

| key | example | notes |
|---|---|---|
| `type` | `chat_message` | `chat_message` \| `chat_mention` \| `chat_rally` \| `chat_reaction`. **A cheer to its recipient is sent as `chat_mention`** (every shipped client already renders/routes that) plus `subtype=cheer`. |
| ★ `subtype` | `cheer` | only on the cheer recipient's push |
| `category` | `social` | |
| `screen` | `circle_chat` | |
| `circleId` | uuid | also APNs `thread-id` |
| `circleName` | `Nov steps challenge` | group name for INSendMessageIntent (`speakableGroupName`) |
| `messageId` | uuid | |
| `senderId` | uuid | INPerson handle / Android Person key (absent for rallies) |
| `senderName` | `Raveesh` | display name (absent for rallies) |
| `senderAvatarUrl` | `https://…` | only when the profile avatar is an https URL; NSE: download ≤ 1 s, fall back to initials |
| `preview` | `Let's go!` | ≤ 80 chars; Android MessagingStyle line; INSendMessageIntent content |
| `deepLink` | `fitcircle://circles/<id>/chat` | |
| `dedupeKey` / `groupKey` | `msg:<id>` / `<circleId>` | as before |
| ★ `quiet` | `true` | present (= `"true"`) on follow-ups inside the circle's 2-minute window (§2.1), **only on devices that registered with `chat_quiet`**. Android: update the circle's notification with `setOnlyAlertOnce(true)` / no sound. Absent = alert. |
| ★ `unreadTotal` | `4` | recipient's `total_unread` (same number as `aps.badge`); Android may use it for a launcher badge |

### APNs (`apns.payload.aps`)

```jsonc
{
  "aps": {
    "alert": { "title": "Raveesh in Nov steps challenge", "body": "Let's go!" },
    "sound": "default",                 // ★ omitted when quiet
    "thread-id": "<circleId>",          // one notification stack per circle (verified in tests)
    "summary-arg": "Nov steps challenge",// ★ "3 more notifications from Nov steps challenge"
    "badge": 4,                          // ★ recipient's total_unread (non-muted chat), same query as /chats
    "mutable-content": 1,                // NSE runs (Communication Notification)
    "interruption-level": "active",      // ★ "passive" on burst follow-ups
    "relevance-score": 0.6
  },
  "type": "chat_message", "circleId": "…", "circleName": "…", "senderId": "…",
  "senderName": "…", "senderAvatarUrl": "…", "preview": "…", "messageId": "…", "quiet": "true"?, …
}
```

Header `apns-priority: 10`, `apns-collapse-id` = dedupeKey (unchanged). `thread-id` is set from
`circleId` for every chat type (`threadIdFor`), and the FCM message builder copies it into `aps`
unchanged; nothing downstream rewrites it — the NSE must keep `threadIdentifier` (it does when it
calls `content.updating(from: intent)` on the mutable copy).

### 2.1 Burst etiquette ("alert once") — per device, gated on `chat_quiet`

The new behaviour only goes to devices whose app registered its push token with the client feature
**`chat_quiet`** (see §2.5). Every other device — all shipped builds, and any token registered
before migration 123 is applied — gets exactly the pre-2026-11-02 behaviour. iOS and Android are
gated the same way.

- Applies to `chat_message` pushes (member messages **and** system posts) per **(recipient, circle)**.
- **Follow-up:** the recipient got **any delivered chat push for that circle** (`chat_message`,
  `chat_mention`, `chat_reaction`, `chat_rally`, cheer) in the last **2 minutes**. Decided from
  `notification_log` (`data->>circleId`, `sent_at`) plus an in-process marker so two sends racing
  inside one instance don't both alert; recorded as `notification_log.data.quiet`.
- **`chat_quiet` devices:** a follow-up is delivered **quietly** (`interruption-level: passive`, no
  `sound`, `data.quiet = "true"`, relevance 0.3); otherwise it alerts. Member messages are **never
  dropped** for a burst: every member message is delivered.
- **Other devices (old rule, unchanged):** no quiet variant — every delivered push alerts — and the
  global burst limit applies: after 3 burst-type pushes in 2 minutes, further pushes are **not sent
  to that device**. If no device of the user declared `chat_quiet`, the burst follow-up is logged
  as `suppressed_reason = 'burst'` exactly as before (`data.burstFollowUp = true` marks it).
- System posts / rallies / reactions keep the old 3-per-2-minutes drop rule on every device.
- **Mentions and cheers addressed to the user always alert** on every device (never quiet), and
  pierce the circle's mute.
- Unchanged: daily cap (chat is cap-exempt), quiet hours, per-circle mute, `social` category
  toggle, dedupe.

### 2.2 Blocks

No chat push between a blocked pair, either direction: member messages, cheers, member-post /
system pushes whose sender is the blocked member, and reactions (already).

### 2.3 Badge

`aps.badge` / `data.unreadTotal` = the recipient's `total_unread` from §1, computed **after** the
message is written (it includes it). Only chat pushes carry a badge; other pushes leave it
untouched (unchanged). Clients set the badge to `/chats.total_unread` after mark-read / foreground.

**Per-device gate:** shipped iOS builds never reset the icon badge, so `aps.badge` is only sent to
tokens whose app sent **`X-Client-Features: …,chat_badge`** on `POST /api/mobile/push/register`
(stored in `push_tokens.client_features`, replaced on every registration). New iOS builds: add
`chat_badge` to the X-Client-Features header (at least on the push-register call) and re-register
the token on launch. `data.unreadTotal` is sent to every device (Android may use it).

### 2.4 Cheer push (recipient only)

```
type=chat_mention, subtype=cheer
title: "Ani cheered you 👏"
body:  "Keep going! · Nov steps challenge"   (no message → "in Nov steps challenge")
preview (data): "cheered you 👏 · Keep going!"   (no message → "cheered you 👏")
interruption-level: active (always), sound default, relevance 0.9
```
Everyone else in the circle gets the cheer as an ordinary `chat_message` (burst rules apply).
Internally it is logged as `notification_type = chat_cheer`.

### 2.5 Client features on push registration (migration 123)

`POST /api/mobile/push/register` reads the `X-Client-Features` request header (comma-separated,
case-insensitive) and stores it on the token (`push_tokens.client_features`, replaced on every
registration). Two features matter for chat pushes:

| feature string | effect on that device |
|---|---|
| `chat_badge` | chat pushes carry `aps.badge` (§2.3) |
| `chat_quiet` | every member message is delivered; follow-ups inside 2 min are quiet (§2.1) |

New iOS and Android builds send **`X-Client-Features: chat_badge,chat_quiet`** (plus any features they
already send, e.g. `icon_keys,reactions_v2`) on push registration, and re-register on launch so an
upgraded app's token picks them up. Before migration 123 is applied, registration still succeeds
without storing features, so every device keeps the old behaviour until it is.

---------------------------------------------------------------------------------------------------
## 3. Cheers — `POST /api/mobile/circles/{id}/cheers`

```jsonc
// request
{
  "to_user_id": "uuid",                      // required
  "reaction": "clap",                        // optional, default "clap"; any v2 reaction value
                                             // (named kind or one emoji, canonicalised like reactions)
  "message": "Keep going!",                  // optional, trimmed, ≤ 280 chars, "" = none
  "source": "leaderboard_long_press",        // "leaderboard_long_press" | "member_sheet" (default
                                             // leaderboard_long_press; web sends one of these too)
  "client_id": "uuid"                        // optional: retry-safe (same sender+client_id → same message)
}
// 201
{ "success": true, "data": { "message": ChatMessageDTO }, "error": null, "meta": {…} }
```

Chips send `reaction` **and** their text as `message` (e.g. `clap` + "Great job!"); the ＋ emoji
picker sends only `reaction`; "Write a message…" sends `message` (+ the chip's reaction or default).

Errors (`error.code`):

| status | code | when / message |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad body; `details.reaction` / `details.message` |
| 400 | `CANNOT_CHEER_SELF` | `to_user_id` = viewer |
| 400 | `INVALID_CIRCLE_ID` | path id is not a uuid |
| 403 | `FORBIDDEN` | viewer not an active member |
| 403 | `BLOCKED` | blocked pair (either direction) — "You can't cheer this member." |
| 404 | `RECIPIENT_NOT_FOUND` | recipient not an active member |
| 429 | `RATE_LIMITED` | `details: { reason: "pair_cooldown" \| "daily_limit", retry_after_seconds }` + `Retry-After` header; message "You just cheered Raveesh — give it a minute" / "That's a lot of cheering for today — try again tomorrow". Show `error.message` as-is; don't retry. |

Limits (durable — counted from `circle_messages` rows): same sender → same recipient at most
**1 per 60 s**; at most **20 cheers per sender per circle per rolling 24 h**.

Text safety: the same rules as chat messages (trim, length, blocks, reportable like any message).
Chat has no word filter today; cheers don't add one.

### 3.1 The message (shape that degrades on shipped clients)

Stored as an ordinary **`kind = 'user_text'`** row from the sender with
`system_payload = { "cheer": { … } }`. Shipped iOS/Android/web clients decode `kind`, `body`,
`sender` as a normal text bubble and ignore the extra top-level `cheer` key (iOS synthesized
`Codable` ignores unknown keys; Android `Json { ignoreUnknownKeys = true }`), so they show
**"👏 @Raveesh Keep going!"** from Ani. Nothing new is decoded into an enum.

```jsonc
ChatMessageDTO = {
  "id": "…", "circleId": "…", "kind": "user_text",
  "sender": { "id": "<ani>", "name": "Ani", "avatarUrl": null },
  "body": "👏 @Raveesh Keep going!",          // plain-text fallback, always present
  "photoUrl": null, "system": null, "reactions": [], "clientId": null,
  "createdAt": "…", "editedAt": null, "deletedAt": null,
  "cheer": {                                   // ★ NEW, null on every other message
    "to_user_id": "<raveesh>",
    "to_display_name": "Raveesh",
    "reaction": "clap",                        // canonical v2 value (kind or custom emoji)
    "emoji": "👏",
    "message": "Keep going!",                  // null when none
    "source": "leaderboard_long_press",
    "stat_snapshot": {                         // null when the recipient hides progress / no steps
      "metric": "steps",
      "date": "2026-11-02",                    // recipient's local day
      "today_steps": 2732,
      "daily_goal_steps": 8000,
      "goal_pct_today": 34                     // rounded, uncapped
    }
  }
}
```

- `body` = `"<emoji> @<to_display_name>"` + `" <message>"` when present.
- `cheer` is `null` for deleted (tombstoned) cheers. Cheers can't be edited (`409
  INVALID_MESSAGE_KIND`); they can be deleted, reported and reacted to like any message.
- Stat snapshot comes from `CircleStepsLeaderboardService` (server-side, recipient's local today);
  client numbers are never accepted.
- Realtime: the insert is a normal `circle_messages` INSERT (existing postgres_changes path).
  Clients refetch the page and read `cheer` from the DTO.
- Every list / send / edit / delete response carries `cheer` (null when not a cheer).

---------------------------------------------------------------------------------------------------
## 4. Home feed card `circle_chat@1`

Server-driven feed (docs/HOME_FEED_SPEC.md). New catalog type **`circle_chat`, version 1**,
kind `utility`, dismissible. Only returned to clients that declare `circle_chat@1` in `cards=`
(old clients never see it). Default position: right after `health_sync_banner` (before `campaign`).

```jsonc
{ "id": "circle_chat", "type": "circle_chat", "version": 1,
  "props": {
    "circle_id": "7d3f…",            // the chat to open (= /chats default_circle_id)
    "circle_name": "Nov steps challenge",
    "unread_count": 3,               // in that circle
    "total_unread": 5,               // all non-muted circles
    "circles_with_unread": 2,
    "sender_display_name": "Raveesh",// of the newest unread message, may be null
    "preview": "Let's go!"           // may be null
  } }
```

Copy suggestion: "3 new in Nov steps challenge · Raveesh: Let's go!" (+ " and 1 more chat" when
`circles_with_unread > 1`). The server drops the card when it **knows** there is nothing unread
(non-muted); if the lookup timed out the card is sent **without props** — the client then uses its
own `/chats` data and collapses when `total_unread == 0`.

---------------------------------------------------------------------------------------------------
## 5. Analytics (tracking plan v21)

| event | change |
|---|---|
| `Chat Opened` | ★ optional `entry` (enum `chat_entry`: `circle_detail \| top_nav \| home_feed \| notification \| switcher \| cheer_toast`), optional `circle_id` |
| `Chat Switcher Opened` | ★ new — optional `circle_count` (int), `source` (enum `chat_switcher_source`: `header \| long_press`) |
| `Chat Circle Switched` | ★ new — `from_circle_id`, `to_circle_id` (required) |
| `Member Cheer Sent` | ★ new — `circle_id`, `reaction` (named kind or `"custom"`), `has_message` (bool), `source` (enum `cheer_source`: `leaderboard_long_press \| member_sheet`), `recipient_goal_pct_bucket` (enum `goal_pct_bucket`: `unknown \| lt_25 \| 25_50 \| 50_75 \| 75_100 \| 100_plus`) |
| `Push Notification Opened` | reused for chat notification taps (`notification_type` = wire `type`, e.g. `chat_message`; add `chat_cheer` when `subtype=cheer`); also fire `Chat Opened` with `entry=notification` |

---------------------------------------------------------------------------------------------------
## 6. Old-client safety

| change | shipped iOS | shipped Android | web |
|---|---|---|---|
| `/chats` | not called | not called | ships with BE |
| new data keys `quiet`, `subtype`, `unreadTotal` | ignored | ignored (allowlisted extras only) | n/a |
| `aps.summary-arg`, passive/no-sound | honoured by iOS | n/a | n/a |
| `aps.badge` | **not sent** (token lacks `chat_badge`), so no stale badge | n/a | n/a |
| cheer recipient push as `chat_mention` | renders as a chat conversation, routes to circle chat | MessagingStyle line "Ani: cheered you 👏 · …" | n/a |
| alert-once / no burst drop for member messages | **unchanged**: no `chat_quiet` → old drop rule, no quiet variant | **unchanged** (same gate) | n/a |
| cheer message = `user_text` + `cheer` key | text bubble "👏 @Raveesh Keep going!" | same | renders cheer bubble |
| `circle_chat` feed card | never sent (not declared) | never sent | n/a |

---------------------------------------------------------------------------------------------------
## 7. Files (backend + web)

- `apps/web/app/lib/services/chat-inbox-service.ts` — inbox, batched unread totals (badge), batched blocks
- `apps/web/app/api/mobile/chats/route.ts`
- `apps/web/app/lib/services/circle-cheer-service.ts`, `apps/web/app/api/mobile/circles/[id]/cheers/route.ts`
- `apps/web/app/lib/services/circle-chat-service.ts` — `cheer` on the DTO, cheers not editable, `toDTO`,
  and a fix: a viewer with any block no longer loses every system post (`NULL NOT IN (…)`)
- `apps/web/app/lib/types/circle-chat.ts` — `MessageCheer`, `CheerStatSnapshot`, limits
- `apps/web/app/lib/services/{notification-orchestrator,chat-notification-service,push-presentation,push-service,notification-preferences-service}.ts`
- `apps/web/app/lib/home-feed/{catalog,candidates,context,types}.ts`, `services/home-feed-service.ts`
- Web UI: `components/chat/{ChatNavButton,ChatSwitcher,useChatInbox,CircleChat,MessageBubble}.tsx`,
  `components/circles/{CheerSheet,CheerHoverButton,cheer-options,useCheerGesture,StepsLeaderboard,LeaderboardRow}.tsx`,
  `components/layout/navbar.tsx`, `fitcircles/[id]/page.tsx` (`?tab=chat` deep link)
- `analytics/tracking-plan.json` v21 + generated web/iOS/Android event files
- `supabase/migrations/123_push_token_client_features.sql`, `api/mobile/push/register/route.ts`
