-- Fitzy server-side conversation store.
-- Gives cross-device chat history AND a clean, queryable dataset (full turns + model + token
-- usage) for analysis and future SLM training. Tables + simple RLS only — no business logic in
-- the DB (that stays in FitzyConversationService).

CREATE TABLE IF NOT EXISTS fitzy_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fitzy_conversations_user
  ON fitzy_conversations(user_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS fitzy_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES fitzy_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  -- Analysis / cost / future-training metadata. Assistant turns carry the model + token usage;
  -- user turns leave these NULL.
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fitzy_messages_convo ON fitzy_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fitzy_messages_user ON fitzy_messages(user_id, created_at);

-- updated_at trigger (project convention; update_updated_at() exists since 001).
CREATE TRIGGER trg_fitzy_conversations_updated_at
  BEFORE UPDATE ON fitzy_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: a user may read AND write ONLY their own rows (auth.uid() = user_id). The service uses the
-- admin client, but these defend against any user-scoped access.
ALTER TABLE fitzy_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitzy_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fitzy_conversations_select_own" ON fitzy_conversations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fitzy_conversations_insert_own" ON fitzy_conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fitzy_conversations_update_own" ON fitzy_conversations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fitzy_conversations_delete_own" ON fitzy_conversations
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "fitzy_messages_select_own" ON fitzy_messages
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fitzy_messages_insert_own" ON fitzy_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fitzy_messages_delete_own" ON fitzy_messages
  FOR DELETE USING (auth.uid() = user_id);
