-- Migration 070: Circle Chat — message edit + soft-delete columns
-- Companion to 052_circle_chat.sql (circle_messages).
--
-- ADDITIVE ONLY. Two nullable timestamp columns on circle_messages:
--   * edited_at  — set by the service when the sender edits a user_text message
--                  (15-minute grace window enforced in TS, CLAUDE.md hard rule:
--                  no business logic in the database).
--   * deleted_at — set by the service on sender soft-delete (tombstone). The
--                  service clears body / photo_url in the same UPDATE; deleted
--                  rows stay in the timeline as tombstones.
--
-- No new policies needed: the circle_messages_owner_update policy from 052
-- already permits owners to UPDATE their own rows, and the table is already in
-- the supabase_realtime publication with REPLICA IDENTITY FULL, so edits and
-- tombstones stream to subscribed clients as UPDATE events.

ALTER TABLE circle_messages
    ADD COLUMN IF NOT EXISTS edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
