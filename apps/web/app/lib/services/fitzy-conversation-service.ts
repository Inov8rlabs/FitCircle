/**
 * Server-held Fitzy conversations (docs/FITZY_V2_SPEC.md §2, §3.3).
 * Free users see only their latest conversation (history is a Pro feature).
 */
import { createAdminSupabase } from '../supabase-admin';
import type { FitzyAction, FitzyMessage, FitzyStoredMessage, FitzyTier } from '../types/fitzy';

export class FitzyNotFoundError extends Error {
  constructor(what = 'Conversation') {
    super(`${what} not found`);
    this.name = 'FitzyNotFoundError';
  }
}

export class FitzyLockedError extends Error {
  constructor(public readonly trigger: 'weekly_plan' | 'memory' | 'history') {
    super('UPGRADE_REQUIRED');
    this.name = 'FitzyLockedError';
  }
}

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions: string[] | null;
  actions: FitzyAction[] | null;
  created_at: string;
}

/** History turns sent to the model. */
export const HISTORY_TURNS = 20;
/** Old-route (client-held history) calls append to the latest conversation if touched within this window. */
export const LEGACY_REUSE_HOURS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const titleFrom = (message: string) => {
  const t = message.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 47).trimEnd()}…` : t;
};

const toStored = (m: MessageRow): FitzyStoredMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  suggestions: m.suggestions ?? [],
  actions: m.actions ?? [],
  createdAt: m.created_at,
});

export class FitzyConversationService {
  static async owned(userId: string, conversationId: string): Promise<ConversationRow> {
    if (!UUID.test(conversationId)) throw new FitzyNotFoundError();
    const { data, error } = await createAdminSupabase().from('fitzy_conversations').select('*').eq('id', conversationId).maybeSingle();
    if (error) throw error;
    const row = data as ConversationRow | null;
    if (!row || row.user_id !== userId || row.archived_at) throw new FitzyNotFoundError();
    return row;
  }

  static async create(userId: string, firstMessage: string): Promise<ConversationRow> {
    const now = new Date().toISOString();
    const { data, error } = await createAdminSupabase()
      .from('fitzy_conversations')
      .insert({ user_id: userId, title: titleFrom(firstMessage), created_at: now, updated_at: now, archived_at: null })
      .select('*')
      .single();
    if (error) throw error;
    return data as ConversationRow;
  }

  static async latest(userId: string): Promise<ConversationRow | null> {
    const { data, error } = await createAdminSupabase()
      .from('fitzy_conversations')
      .select('*')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return ((data ?? []) as ConversationRow[])[0] ?? null;
  }

  /** Last `limit` turns, oldest → newest. */
  static async history(conversationId: string, limit = HISTORY_TURNS): Promise<FitzyMessage[]> {
    const { data, error } = await createAdminSupabase()
      .from('fitzy_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse().map((m) => ({ role: m.role, content: m.content }));
  }

  static async addMessage(
    userId: string,
    conversationId: string,
    m: {
      role: 'user' | 'assistant';
      content: string;
      suggestions?: string[];
      actions?: FitzyAction[];
      model?: string | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
      guardTripped?: boolean;
      createdAt?: string;
    }
  ): Promise<string> {
    const supabase = createAdminSupabase();
    // Keep created_at strictly increasing within a conversation (stable ordering even when
    // turns land in the same millisecond).
    const { data: conv } = await supabase.from('fitzy_conversations').select('updated_at').eq('id', conversationId).maybeSingle();
    const floor = Date.parse((conv as { updated_at?: string } | null)?.updated_at ?? '') + 1 || 0;
    const at = new Date(Math.max(Date.parse(m.createdAt ?? '') || Date.now(), floor)).toISOString();
    const { data, error } = await supabase
      .from('fitzy_messages')
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role: m.role,
        content: m.content,
        suggestions: m.suggestions ?? [],
        actions: m.actions ?? [],
        model: m.model ?? null,
        input_tokens: m.inputTokens ?? null,
        output_tokens: m.outputTokens ?? null,
        guard_tripped: !!m.guardTripped,
        created_at: at,
      })
      .select('id')
      .single();
    if (error) throw error;
    await supabase.from('fitzy_conversations').update({ updated_at: at }).eq('id', conversationId);
    return (data as { id: string }).id;
  }

  /** Persist older local history once (first call from an updated app). */
  static async seed(userId: string, conversationId: string, messages: FitzyMessage[]): Promise<void> {
    const base = Date.now() - messages.length * 1000 - 1000;
    for (const [i, m] of messages.slice(-HISTORY_TURNS).entries()) {
      await this.addMessage(userId, conversationId, { role: m.role, content: m.content, createdAt: new Date(base + i * 1000).toISOString() });
    }
  }

  static async list(userId: string, tier: FitzyTier): Promise<{ conversations: Array<{ id: string; title: string; updatedAt: string; preview: string }>; historyLocked: boolean }> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('fitzy_conversations')
      .select('*')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(tier === 'pro' ? 100 : 1);
    if (error) throw error;
    const rows = (data ?? []) as ConversationRow[];
    const conversations = [];
    for (const c of rows) {
      const { data: last } = await supabase
        .from('fitzy_messages')
        .select('content')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1);
      const text = ((last ?? []) as Array<{ content: string }>)[0]?.content ?? '';
      conversations.push({ id: c.id, title: c.title, updatedAt: c.updated_at, preview: text.replace(/\s+/g, ' ').trim().slice(0, 100) });
    }
    return { conversations, historyLocked: tier !== 'pro' };
  }

  static async get(userId: string, tier: FitzyTier, conversationId: string): Promise<{ id: string; title: string; messages: FitzyStoredMessage[] }> {
    const row = await this.owned(userId, conversationId);
    if (tier !== 'pro') {
      const latest = await this.latest(userId);
      if (latest?.id !== row.id) throw new FitzyLockedError('history');
    }
    const { data, error } = await createAdminSupabase()
      .from('fitzy_messages')
      .select('*')
      .eq('conversation_id', row.id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    return { id: row.id, title: row.title, messages: ((data ?? []) as MessageRow[]).map(toStored) };
  }

  static async remove(userId: string, conversationId: string): Promise<void> {
    const row = await this.owned(userId, conversationId);
    const { error } = await createAdminSupabase().from('fitzy_conversations').delete().eq('id', row.id);
    if (error) throw error;
  }
}
