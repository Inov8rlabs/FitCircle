-- Migration 052: Circle Chat & System-Post Engine — schema
-- Companion: FitCircle Nutrition PRD v4 §6.3a; Build Spec v1.2 §0.2/§0.3.
--
-- ADDITIVE ONLY. No existing table is altered or dropped, so existing functionality
-- cannot break. Four new tables: circle_messages, circle_message_reactions,
-- circle_chat_state, circle_message_reports.
--
-- Grounding (verified against real schema 2026-06-01):
--   * Circle          = `fitcircles(id)`        (renamed from `challenges` in 038)
--   * Membership      = `fitcircle_members`     (renamed from `challenge_participants` in 038):
--                        columns `fitcircle_id`, `user_id`, `status`, `role`.
--                        ACTIVE membership = `status = 'active'`  (NOT an `is_active` column —
--                        the Gate-0 spike wrongly assumed is_active; status enum is the truth:
--                        'pending'|'active'|'completed'|'dropped'|'disqualified').
--   * User FK         = `profiles(id)`          (canonical user table; not auth.users)
--
-- No stored procedures / business-logic triggers (Build Spec §0.3, CLAUDE.md hard rule).
-- All chat behaviour lives in TS `circle-chat-service`. The only DB-side constructs here
-- are: tables, indexes, RLS policies (pure inline membership predicates), and a single
-- updated_at timestamp trigger reusing the existing convention.

-- ============================================================================
-- Helper: active-membership predicate is inlined into every policy (no SECURITY DEFINER
-- helper fn — avoids the RLS-recursion class fixed in migration 011).
-- "auth.uid() is an active member of <fitcircle_id>"
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. circle_messages — the linear per-circle timeline (member messages + system posts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fitcircle_id      uuid NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
    sender_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,   -- NULL = system post
    kind              text NOT NULL CHECK (kind IN ('user_text', 'user_photo', 'system_event')),
    body              text,                 -- pre-rendered human text (always set for system posts → forward-compat)
    photo_url         text,
    client_id         uuid,                 -- client-generated; echoed back for iOS optimistic de-dupe (Build Spec §6.1)
    system_event_type text CHECK (system_event_type IN (
                          'workout_done','notable_meal','streak_milestone','circle_streak',
                          'quest_done','challenge_milestone','challenge_resolved',
                          'daily_summary','member_joined','new_challenge')),
    system_event_ref  uuid,                 -- ref to the triggering log/quest/challenge row
    system_payload    jsonb,                -- render_hint inputs (stat_card / summary_card / completion_card)
    priority          text NOT NULL DEFAULT 'p1' CHECK (priority IN ('p0','p1','p2')),  -- engine-assigned (Build Spec §4.2)
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    -- Integrity: member messages have a sender; system posts have an event type.
    CONSTRAINT circle_messages_kind_shape CHECK (
        (kind = 'system_event' AND system_event_type IS NOT NULL)
        OR (kind IN ('user_text','user_photo') AND sender_id IS NOT NULL)
    ),
    -- De-dupe optimistic inserts per sender (client_id unique when present)
    CONSTRAINT circle_messages_client_id_uniq UNIQUE (sender_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_messages_circle_time
    ON circle_messages(fitcircle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circle_messages_sender
    ON circle_messages(sender_id) WHERE sender_id IS NOT NULL;

ALTER TABLE circle_messages ENABLE ROW LEVEL SECURITY;

-- Active members of the circle can read the timeline.
CREATE POLICY circle_messages_member_select ON circle_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM fitcircle_members m
            WHERE m.fitcircle_id = circle_messages.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- A member may post only AS themselves, and only into a circle they're active in.
-- (System posts are written by the service via the service_role key, which bypasses RLS.)
CREATE POLICY circle_messages_member_insert ON circle_messages
    FOR INSERT
    WITH CHECK (
        sender_id = auth.uid()
        AND kind IN ('user_text','user_photo')
        AND EXISTS (
            SELECT 1 FROM fitcircle_members m
            WHERE m.fitcircle_id = circle_messages.fitcircle_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- A member may edit/soft-delete only their own message (grace-window enforced in app layer).
CREATE POLICY circle_messages_owner_update ON circle_messages
    FOR UPDATE
    USING (sender_id = auth.uid())
    WITH CHECK (sender_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. circle_message_reactions — six-emoji tapback (shared vocabulary with the feed)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_message_reactions (
    message_id  uuid NOT NULL REFERENCES circle_messages(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reaction    text NOT NULL CHECK (reaction IN ('flame','clap','eyes','same','heart','laugh')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_circle_message_reactions_message
    ON circle_message_reactions(message_id);

ALTER TABLE circle_message_reactions ENABLE ROW LEVEL SECURITY;

-- Read reactions on any message in a circle you're an active member of.
CREATE POLICY circle_message_reactions_member_select ON circle_message_reactions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM circle_messages cm
            JOIN fitcircle_members m ON m.fitcircle_id = cm.fitcircle_id
            WHERE cm.id = circle_message_reactions.message_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- React as yourself, on a message in a circle you're active in.
CREATE POLICY circle_message_reactions_member_insert ON circle_message_reactions
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM circle_messages cm
            JOIN fitcircle_members m ON m.fitcircle_id = cm.fitcircle_id
            WHERE cm.id = circle_message_reactions.message_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
        )
    );

-- Remove only your own reaction.
CREATE POLICY circle_message_reactions_owner_delete ON circle_message_reactions
    FOR DELETE
    USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. circle_chat_state — per-(circle,user) read cursor + mute
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_chat_state (
    fitcircle_id uuid NOT NULL REFERENCES fitcircles(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_read_at timestamptz,
    muted        boolean NOT NULL DEFAULT false,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (fitcircle_id, user_id)
);

ALTER TABLE circle_chat_state ENABLE ROW LEVEL SECURITY;

-- A user sees and manages only their own chat state.
CREATE POLICY circle_chat_state_self_select ON circle_chat_state
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY circle_chat_state_self_insert ON circle_chat_state
    FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY circle_chat_state_self_update ON circle_chat_state
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. circle_message_reports — lightweight human-reviewed moderation queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_message_reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  uuid NOT NULL REFERENCES circle_messages(id) ON DELETE CASCADE,
    reporter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reason      text,
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT circle_message_reports_one_per_reporter UNIQUE (message_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_message_reports_open
    ON circle_message_reports(status, created_at) WHERE status = 'open';

ALTER TABLE circle_message_reports ENABLE ROW LEVEL SECURITY;

-- A reporter can file a report (as themselves) and see the reports they filed.
-- Review/actioning is done by the service (service_role) / a human reviewer.
CREATE POLICY circle_message_reports_reporter_insert ON circle_message_reports
    FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY circle_message_reports_reporter_select ON circle_message_reports
    FOR SELECT USING (reporter_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5. updated_at timestamp triggers (schema plumbing only)
-- ----------------------------------------------------------------------------
-- NOTE: the post-migration-014 convention is update_updated_at() (used by 026/031/033/
-- 036/051), NOT update_updated_at_column() — the latter was DROPPED ... CASCADE in 014
-- and never recreated. update_updated_at() is created in 001 and never dropped; we
-- re-declare it defensively (OR REPLACE) here so 052 is self-contained, matching how
-- the food-log/beverage migrations do it.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_circle_messages_updated_at
    BEFORE UPDATE ON circle_messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_circle_chat_state_updated_at
    BEFORE UPDATE ON circle_chat_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Realtime: expose chat tables on the supabase_realtime publication.
-- Per-subscriber RLS (policies above) scopes the live stream — verified in Gate 0:
-- a non-member receives nothing. REPLICA IDENTITY FULL so UPDATE/DELETE carry old values.
-- ----------------------------------------------------------------------------
ALTER TABLE circle_messages REPLICA IDENTITY FULL;
ALTER TABLE circle_message_reactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE circle_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE circle_message_reactions;

-- ----------------------------------------------------------------------------
-- 7. Grants (RLS still governs row visibility; these grant table-level access)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON circle_messages TO authenticated;
GRANT SELECT, INSERT, DELETE ON circle_message_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON circle_chat_state TO authenticated;
GRANT SELECT, INSERT ON circle_message_reports TO authenticated;
