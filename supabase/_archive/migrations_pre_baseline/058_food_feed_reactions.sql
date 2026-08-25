-- Migration 058: Social food feed reactions — log_reactions
-- PRD v4 §6.3 (social food feed + log reactions) / §6.7 (healthy engagement).
--
-- ADDITIVE ONLY. No existing table is altered or dropped. One new table:
-- `log_reactions` — a six-emoji tapback on individual food_log_entries, promoting
-- food logs into circle content. This deliberately MIRRORS the chat reaction model
-- (migration 052 circle_message_reactions): same six-emoji vocabulary
-- (flame|clap|eyes|same|heart|laugh), same (target, user, reaction) composite PK,
-- same RLS shape (read if you're an active member of a circle the target belongs to;
-- react/delete only as yourself).
--
-- Grounding (verified against real schema 2026-06-01):
--   * Food log entry  = `food_log_entries(id)`   (031; macro columns added in 054:
--                        calories/protein_g/carbs_g/fat_g; visibility/has_images/
--                        logged_at/entry_date/meal_type/user_id all present)
--   * Circle          = `fitcircles(id)`
--   * Membership      = `fitcircle_members(fitcircle_id, user_id, status)`,
--                        ACTIVE = status = 'active'
--   * User FK         = `profiles(id)`
--
-- A food_log_entry is "in a circle" for reaction purposes iff its owner
-- (food_log_entries.user_id) is an active member of that circle. The feed service
-- gates the viewer to a specific circle; the RLS predicate here authorizes a viewer
-- to read a reaction whenever the viewer and the entry-owner share ANY active circle
-- membership (the join below) — defense-in-depth behind the service's per-circle gate.
--
-- No stored procedures / business-logic triggers (CLAUDE.md hard rule). DB-side
-- constructs are limited to: one table, one index, RLS policies (inline membership
-- predicates), and grants. No updated_at column → no timestamp trigger needed
-- (reactions are immutable: insert or delete, never update — "update via reuse").

-- ----------------------------------------------------------------------------
-- log_reactions — six-emoji tapback on a food_log_entry
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_reactions (
    food_log_entry_id uuid NOT NULL REFERENCES food_log_entries(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reaction          text NOT NULL CHECK (reaction IN ('flame','clap','eyes','same','heart','laugh')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (food_log_entry_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_log_reactions_entry
    ON log_reactions(food_log_entry_id);

ALTER TABLE log_reactions ENABLE ROW LEVEL SECURITY;

-- Read reactions on an entry whose owner shares an active circle with the viewer.
-- (The feed service further scopes reads to a single circle; this is defense in depth.)
CREATE POLICY log_reactions_member_select ON log_reactions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM food_log_entries fle
            JOIN fitcircle_members owner_m
              ON owner_m.user_id = fle.user_id
             AND owner_m.status = 'active'
            JOIN fitcircle_members viewer_m
              ON viewer_m.fitcircle_id = owner_m.fitcircle_id
             AND viewer_m.user_id = auth.uid()
             AND viewer_m.status = 'active'
            WHERE fle.id = log_reactions.food_log_entry_id
        )
    );

-- React as yourself, on an entry whose owner shares an active circle with you.
CREATE POLICY log_reactions_member_insert ON log_reactions
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM food_log_entries fle
            JOIN fitcircle_members owner_m
              ON owner_m.user_id = fle.user_id
             AND owner_m.status = 'active'
            JOIN fitcircle_members viewer_m
              ON viewer_m.fitcircle_id = owner_m.fitcircle_id
             AND viewer_m.user_id = auth.uid()
             AND viewer_m.status = 'active'
            WHERE fle.id = log_reactions.food_log_entry_id
        )
    );

-- Remove only your own reaction.
CREATE POLICY log_reactions_owner_delete ON log_reactions
    FOR DELETE
    USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime: expose on the supabase_realtime publication so reaction counts can
-- live-update on the feed (mirrors how 052 publishes circle_message_reactions).
-- Per-subscriber RLS (policies above) scopes the live stream.
-- ----------------------------------------------------------------------------
ALTER TABLE log_reactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE log_reactions;

-- ----------------------------------------------------------------------------
-- Grants (RLS still governs row visibility; these grant table-level access).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON log_reactions TO authenticated;
