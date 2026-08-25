-- Migration 053: Circle Chat safety — member block list.
-- Companion to 052 (circle_chat). ADDITIVE ONLY: one new table, no existing object
-- is altered or dropped, so existing functionality cannot break.
--
-- Blocking is APP-WIDE (not per-circle): blocker_id no longer wants to see, or be
-- seen by, blocked_id anywhere chat timelines are rendered. This is simpler than a
-- per-circle block and matches the product rule "a blocked member's messages are
-- hidden and they can't see yours". Timeline filtering of the bidirectional hide set
-- lives in TS (ChatSafetyService.getBlockedIdsFor) — no DB-side business logic.
--
-- Grounding (matches 052):
--   * User FK = profiles(id) (canonical user table).
--   * RLS = pure inline auth.uid() predicates, NO SECURITY DEFINER helper fn
--     (avoids the RLS-recursion class fixed in migration 011).

-- ----------------------------------------------------------------------------
-- circle_member_blocks — app-wide per-user block edges
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_member_blocks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    blocked_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT circle_member_blocks_uniq UNIQUE (blocker_id, blocked_id),
    CONSTRAINT circle_member_blocks_no_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_member_blocks_blocker
    ON circle_member_blocks(blocker_id);

ALTER TABLE circle_member_blocks ENABLE ROW LEVEL SECURITY;

-- A user may only see, create, and remove their OWN block edges (blocker_id = self).
-- The "who has blocked me" direction is read service-side (service_role) for the
-- bidirectional hide set; it is intentionally NOT exposed to clients via RLS.
CREATE POLICY circle_member_blocks_self_select ON circle_member_blocks
    FOR SELECT USING (blocker_id = auth.uid());
CREATE POLICY circle_member_blocks_self_insert ON circle_member_blocks
    FOR INSERT WITH CHECK (blocker_id = auth.uid());
CREATE POLICY circle_member_blocks_self_delete ON circle_member_blocks
    FOR DELETE USING (blocker_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Grants (RLS still governs row visibility; these grant table-level access)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON circle_member_blocks TO authenticated;
