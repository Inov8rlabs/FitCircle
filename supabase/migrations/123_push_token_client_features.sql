-- 123: per-device client capabilities on push tokens (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §2.3).
--
-- Chat pushes now vary per device by what the app declared in X-Client-Features
-- when registering the token: `chat_badge` (aps.badge = unread chat; shipped iOS
-- builds never reset the badge) and `chat_quiet` (every member message delivered,
-- burst follow-ups quiet; without it the old burst drop rule applies). Business logic
-- stays in PushService; this only stores the list. Additive and nullable-safe:
-- the backend falls back to registering without it (and sends no badge) until
-- this is applied, so deploy order does not matter.

ALTER TABLE "public"."push_tokens"
  ADD COLUMN IF NOT EXISTS "client_features" text[] NOT NULL DEFAULT '{}'::text[];
