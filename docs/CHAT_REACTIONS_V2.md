# Circle Chat Reactions v2 — contract as built (backend + web)

Status: built on `feat/chat-reactions-v2` (2026-11-02). Migration **122** written, **not applied**.
Product spec: cheering + emoji reactions in Circle chat (long-press menu, double-tap 👏, cheer chip on
activity posts, any-emoji picker, one reaction per person).

## Reaction values

A reaction is either a **named kind** or **exactly one emoji**.

| kind        | emoji | notes                               |
|-------------|-------|-------------------------------------|
| `clap`      | 👏    | cheer; double-tap / cheer chip      |
| `same`      | 🙌    | high five; cheer                    |
| `muscle`    | 💪    | **new in v2**; cheer                |
| `flame`     | 🔥    |                                     |
| `heart`     | ❤️    |                                     |
| `laugh`     | 😂    |                                     |
| `thumbs_up` | 👍    | still accepted; not on the v2 bar   |
| `eyes`      | 👀    | still accepted; not on the v2 bar   |

Quick-reaction bar order (all clients): `clap, same, muscle, flame, heart, laugh`, then ＋.

Canonicalisation (`apps/web/app/lib/chat/reactions.ts`, used by service, routes and web):

- Input is trimmed. A named kind is stored as-is.
- The emoji of a named kind — with or without U+FE0F (`❤` / `❤️`) — is stored **as the kind**
  (`"👏"` → `clap`).
- Skin-tone variants (`👏🏽`) are **not** folded into the kind; they are stored as custom emoji so
  the reactor's choice survives. (They push with "reacted" copy, not "cheered".)
- Anything else must be a single RGI emoji grapheme (`\p{RGI_Emoji}` with the `v` flag; an
  Extended_Pictographic / flag / keycap fallback on older engines), at most **16 UTF-8 bytes**.
  Text, multiple emoji, and long ZWJ sequences (e.g. 👨‍👩‍👧‍👦, 25 bytes) are rejected with
  `400 VALIDATION_ERROR`.

## One reaction per person

Enforced in `CircleChatService.setReaction`: the viewer's other rows on the message are deleted,
then the new one is upserted. The PK `(message_id, user_id, reaction)` is unchanged; pre-v2 data
may hold several rows per user, so **summaries and reactors count only each user's newest row**
(`created_at`), and the user's next reaction collapses the extras.

## API (all under `/api/mobile/messages/[id]/reactions`, mobile auth, circle members only)

Envelope everywhere: `{ success, data, error, meta }`. Errors: `401 UNAUTHORIZED`,
`403 FORBIDDEN` (not an active member), `404 NOT_FOUND`, `409 MESSAGE_DELETED` (react on a tombstone),
`400 VALIDATION_ERROR` (bad reaction; `error.details.reaction` set), `500`.

| Method | Path | Body | Behaviour | `data` |
|---|---|---|---|---|
| `PUT` | `…/reactions` | `{ "reaction": "<kind-or-emoji>" }` | set the viewer's one reaction (replace) | `{ reactions: ReactionSummary[] }` |
| `DELETE` | `…/reactions` | — | clear the viewer's reaction (idempotent) | `{ reactions: ReactionSummary[] }` |
| `GET` | `…/reactions` | — | who reacted with what | `{ reactors: Reactor[] }` |
| `POST` | `…/reactions` | `{ "reaction": … }` | **legacy**, kept for shipped clients — now the same replace semantics as PUT; also accepts custom emoji | `{ reactions }` |
| `DELETE` | `…/reactions/[reaction]` | — | **legacy** — removes that one reaction if it is the viewer's (kind, its emoji, or URL-encoded custom emoji); no-op otherwise | `{ reactions }` |

```ts
ReactionSummary = {
  reaction: string;     // named kind, or the custom emoji itself
  emoji: string;        // NEW, always present: canonical emoji for a kind, else the custom emoji
  count: number;
  reactedByMe: boolean; // at most one summary per message has this true
}
// Ordered by count desc, then the reaction that appeared first.

Reactor = {
  user_id: string; display_name: string; avatar_url: string | null;
  reaction: string; emoji: string; reacted_at: string  // ISO
}
// Viewer first, then newest first. One row per member (their newest reaction).
```

The message list / send / edit DTOs carry the same `ReactionSummary[]` in `reactions`.

**Blocked members:** summaries and the reactors list are viewer-specific — reactions from members
the viewer blocked, or who blocked the viewer (`ChatSafetyService.getBlockedIdsFor`, both
directions), are excluded from the counts and the list. The viewer's own reaction always shows.
Other viewers still see them.

## Realtime

There is no server broadcast: clients subscribe to Supabase **postgres_changes** on
`circle_message_reactions` (unfiltered; RLS scopes delivery) and treat each event as a nudge to
refetch. Migration 122 adds a **generated column `emoji`** (plain `CASE` expression — no function,
no trigger) so every realtime INSERT/UPDATE/DELETE row carries `emoji` alongside `message_id`,
`user_id`, `reaction`, `created_at`. A replace arrives as DELETE(old) + INSERT(new). The `CASE`
must match `REACTION_EMOJI`; `chat-reactions-v2.test.ts` parses the migration to enforce that.

## Old-client safety (no header gate needed)

Checked against shipped code on 2026-11-02:

- **iOS** (`ChatMessage.swift`): `ReactionKind.init(from:)` maps unknown strings to `.unknown`
  (since the first chat release, 8584ccd); `ReactionPills` filters `.unknown` before `ForEach`.
  `muscle` / custom emoji are silently not drawn. Extra `emoji` key is ignored by `Codable`. No crash,
  message never dropped.
- **Android** (`ChatModels.kt`): lenient `ReactionKindSerializer` → `UNKNOWN`, lenient list
  serializer, `ReactionSummary.wire` keeps the raw value; pills draw unknown kinds with a neutral glyph
  and disable tapping them (since f39f4b3, before the first Play release). Realtime only reads
  `message_id`. No crash.
- **Web** ships with the backend.

So custom-emoji summaries are sent to every client; there is **no** `X-Client-Features: reactions_v2`
gate. New clients (and web) still send `X-Client-Features: reactions_v2` so the server can gate
later if ever needed (parse it with the same comma-list approach as `icon_keys` in
`lib/design/icon-compat.ts`). Old clients that POST a kind now replace instead of add — their
optimistic toggle is reconciled by the server summaries they already apply.

## Push (`chat_reaction`)

- Recipient rules unchanged (`ChatNotificationService.reactionRecipient`: author, or the member a
  system post is about; never yourself; muted circle = no push). Dedupe key, caps, quiet hours,
  burst control unchanged.
- Copy: clap / same / muscle → **"Ani cheered your message 👏"**; anything else →
  **"Ani reacted 🥳 to your message"** (`photo` / `post` instead of `message` where relevant).
  Body: the quoted preview, else `in <circle name>`.
- No push for: a re-tap / retry of the current reaction, any removal, a **replacement within
  60 s** of the reactor's previous reaction on that message (`REACTION_PUSH_QUIET_MS`), or a
  **remove-then-re-add within 60 s of the last push** for that message + reactor (in-process
  TTL map in `circle-chat-service.ts`, like the orchestrator's `InProcessSendGuard`; best-effort
  across serverless instances — a different warm instance can still push once).
- No reaction push between a blocked pair (either direction).

## Analytics (tracking plan v20)

- `Chat Reaction Sent` (existing event, reused) — `reaction` (kind or `"custom"`, never the raw
  emoji), optional `circle_id`, `source` (enum `chat_reaction_source`: `long_press | double_tap |
  cheer_button | pills_sheet | emoji_picker`), `replaced` (bool). Optional so pre-v2 call sites
  still compile.
- `Chat Reaction Removed` (new) — `reaction`, optional `circle_id`, `source`.

## Web chat UX (`apps/web/app/components/chat/`)

- **One focused menu** (`MessageFocusMenu`): touch long-press (350 ms), right-click, or Enter /
  Space / ContextMenu / Shift+F10 on the focused message, or the hover ☺ button. Backdrop dims +
  blurs, the message lifts in place (scale 1.03), reaction bar above, actions below (Copy, Edit (own,
  15 min), Delete (own), Report (others)). Esc / outside click dismisses; focus is trapped and
  restored. Optimistic (unsent) rows: actions only.
- **Reaction bar**: 👏 🙌 💪 🔥 ❤️ 😂 ＋ (current reaction highlighted; a custom current reaction
  appears before ＋). ＋ swaps the action list for a dependency-free emoji grid (arrow-key nav).
- **Double-click / double-tap = 👏 toggle** with a short burst (off under reduced motion). Never on
  a link, and not when the gesture starts on text that is already selected.
- **Cheer chip** on system posts about another member (not the daily summary, not your own):
  "👏 Cheer" → "👏 Cheered"; tap again to undo. **No count on the chip** — all counts live in the
  pills (shown even when the only reactions are claps), which open the reactors dialog.
- **Pills** on the bubble's inner bottom corner: up to 3 emoji + total; click / right-click opens
  the **Reactions** dialog (bottom sheet on narrow screens): filter chips per emoji, the viewer's row
  first with "Tap to remove".
- Everything optimistic with rollback; 44 px targets; `motion-safe` / `useReducedMotion`.

## Migration 122

`supabase/migrations/122_chat_reactions_v2.sql`: relaxes `circle_message_reactions_reaction_check`
to the 8 kinds **or** `char_length 1..16 AND NOT ^[A-Za-z0-9_ ]+$`, and adds the generated `emoji`
column. `log_reactions` (food-log feed) untouched; the shared `REACTION_KINDS` constant stays at
the 087 set so the food-log routes do not start accepting `muscle`. Apply alone (db query +
history insert); the backend must deploy **after** the migration (writing `muscle` / emoji before it
lands violates the old CHECK → 500).

## Files

- `supabase/migrations/122_chat_reactions_v2.sql`
- `apps/web/app/lib/chat/reactions.ts` — canonicalisation / validation
- `apps/web/app/lib/types/circle-chat.ts` — `ChatReactionKind`, `CHAT_REACTION_BAR`, `MessageReactor`, summary `emoji`
- `apps/web/app/lib/services/circle-chat-service.ts` — `setReaction`, `clearReaction`, `listReactors`, `summarizeReactions`, `shouldNotifyReaction`
- `apps/web/app/api/mobile/messages/[id]/reactions/{route.ts,reaction-route-helpers.ts,[reaction]/route.ts}`
- `apps/web/app/lib/services/{chat-notification-service,notification-orchestrator}.ts` — push copy
- `apps/web/app/components/chat/*` — web UX
- `analytics/tracking-plan.json` (v20) + generated web/iOS/Android event files
