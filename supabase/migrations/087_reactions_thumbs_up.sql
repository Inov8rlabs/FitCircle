-- 087: add the 👍 reaction ('thumbs_up') to chat message reactions and food-log
-- reactions. 🙌 already exists as 'same' (rendered as a high-five on web/Android).
-- Product ask 2026-09-23: long-press a message → high-five / thumbs up / heart …
-- Business logic stays in apps/web (CircleChatService.addReaction); this only
-- widens the CHECK constraints.

ALTER TABLE "public"."circle_message_reactions"
  DROP CONSTRAINT IF EXISTS "circle_message_reactions_reaction_check";
ALTER TABLE "public"."circle_message_reactions"
  ADD CONSTRAINT "circle_message_reactions_reaction_check"
  CHECK (("reaction" = ANY (ARRAY[
    'flame'::"text", 'clap'::"text", 'eyes'::"text", 'same'::"text",
    'heart'::"text", 'laugh'::"text", 'thumbs_up'::"text"
  ])));

ALTER TABLE "public"."log_reactions"
  DROP CONSTRAINT IF EXISTS "log_reactions_reaction_check";
ALTER TABLE "public"."log_reactions"
  ADD CONSTRAINT "log_reactions_reaction_check"
  CHECK (("reaction" = ANY (ARRAY[
    'flame'::"text", 'clap'::"text", 'eyes'::"text", 'same'::"text",
    'heart'::"text", 'laugh'::"text", 'thumbs_up'::"text"
  ])));
