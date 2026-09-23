-- 086: meals logged by circle members become chat posts (system_event_type = 'meal_logged').
--
-- Product decision 2026-09-22: the per-circle "Food Feed" sub-screen goes away; a
-- shared meal shows up in the circle chat timeline as a meal card, with the
-- same privacy gating the feed had (owner's per-circle tier must be 'full').
-- Business logic lives in apps/web/app/lib/services/circle-meal-post-service.ts;
-- this only widens the CHECK constraint so the new event type can be stored.

ALTER TABLE "public"."circle_messages"
  DROP CONSTRAINT IF EXISTS "circle_messages_system_event_type_check";

ALTER TABLE "public"."circle_messages"
  ADD CONSTRAINT "circle_messages_system_event_type_check"
  CHECK (("system_event_type" = ANY (ARRAY[
    'workout_done'::"text",
    'notable_meal'::"text",
    'streak_milestone'::"text",
    'circle_streak'::"text",
    'quest_done'::"text",
    'challenge_milestone'::"text",
    'challenge_resolved'::"text",
    'daily_summary'::"text",
    'member_joined'::"text",
    'new_challenge'::"text",
    'meal_logged'::"text"
  ])));

-- Meal posts are looked up by the entry they mirror (photo attached later,
-- entry edited, entry deleted).
CREATE INDEX IF NOT EXISTS "circle_messages_system_event_ref_idx"
  ON "public"."circle_messages" ("system_event_type", "system_event_ref")
  WHERE "system_event_ref" IS NOT NULL;
