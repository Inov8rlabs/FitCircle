-- 122: Circle Chat Reactions v2 (docs/CHAT_REACTIONS_V2.md).
-- Product ask 2026-11-02: cheer / clap / any emoji on chat messages.
--
-- * Adds the 💪 'muscle' kind and allows a single custom emoji as a reaction.
--   The app (CircleChatService + lib/chat/reactions.ts) validates "exactly one
--   emoji, <= 16 UTF-8 bytes" and canonicalises named-kind emoji to the kind;
--   this CHECK is only a backstop that keeps plain words out of the column.
-- * Adds a GENERATED `emoji` column so Supabase Realtime postgres_changes rows
--   (the clients' realtime reaction events) carry the same `emoji` field as the
--   REST ReactionSummary. It is a plain column expression — no function, no
--   trigger. The CASE must match REACTION_EMOJI in apps/web/app/lib/types/
--   circle-chat.ts (a unit test parses this file to keep them in sync).
-- * The PK (message_id, user_id, reaction) is unchanged. One reaction per person
--   is enforced in CircleChatService (delete the viewer's other rows, then
--   upsert); older rows with several reactions per user are read as "newest
--   row counts" and collapse on that user's next reaction.
-- * log_reactions (food-log feed) is intentionally untouched.
--
-- Applied by the lead ALONE (db query + schema_migrations history insert).

ALTER TABLE "public"."circle_message_reactions"
  DROP CONSTRAINT IF EXISTS "circle_message_reactions_reaction_check";
ALTER TABLE "public"."circle_message_reactions"
  ADD CONSTRAINT "circle_message_reactions_reaction_check"
  CHECK (
    "reaction" = ANY (ARRAY[
      'flame'::"text", 'clap'::"text", 'eyes'::"text", 'same'::"text",
      'heart'::"text", 'laugh'::"text", 'thumbs_up'::"text", 'muscle'::"text"
    ])
    OR (
      char_length("reaction") BETWEEN 1 AND 16
      AND "reaction" !~ '^[A-Za-z0-9_ ]+$'
    )
  );

ALTER TABLE "public"."circle_message_reactions"
  ADD COLUMN IF NOT EXISTS "emoji" "text" GENERATED ALWAYS AS (
    CASE "reaction"
      WHEN 'thumbs_up' THEN '👍'
      WHEN 'same' THEN '🙌'
      WHEN 'heart' THEN '❤️'
      WHEN 'flame' THEN '🔥'
      WHEN 'clap' THEN '👏'
      WHEN 'laugh' THEN '😂'
      WHEN 'eyes' THEN '👀'
      WHEN 'muscle' THEN '💪'
      ELSE "reaction"
    END
  ) STORED;
