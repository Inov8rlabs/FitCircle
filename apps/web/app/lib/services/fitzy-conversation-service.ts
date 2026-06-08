import { createAdminSupabase } from '../supabase-admin';
import type { FitzyHistoryResponse, FitzyStoredMessage, FitzyTurnToPersist } from '../types/fitzy';

/**
 * FitzyConversationService — the server-side Fitzy conversation store (migration 066).
 *
 * Persists every chat turn (user + assistant, with model + token usage on assistant turns) so
 * history syncs across devices and accumulates as a clean dataset for analysis / future SLM
 * training. All access is scoped to the owning user. Persistence is best-effort from the caller's
 * perspective — a store failure must never break the live chat response (the route/service wrap it).
 */
export class FitzyConversationService {
  /** Default page size for history reads. */
  private static readonly HISTORY_LIMIT = 50;

  /**
   * Return the user's active conversation id, creating one if none exists. "Active" = the most
   * recent conversation (single ongoing thread per user for v1; the schema already supports many).
   * If `conversationId` is provided and belongs to the user, it's used as-is.
   */
  static async getOrCreateActiveConversation(userId: string, conversationId?: string): Promise<string> {
    const supabase = createAdminSupabase();

    if (conversationId) {
      const { data } = await supabase
        .from('fitzy_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (data?.id) return data.id as string;
      // Fall through to active/create when the id is unknown or not the user's.
    }

    const { data: existing } = await supabase
      .from('fitzy_conversations')
      .select('id')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id as string;

    const { data: created, error } = await supabase
      .from('fitzy_conversations')
      .insert({ user_id: userId })
      .select('id')
      .single();
    if (error || !created) throw new Error(`Fitzy conversation create failed: ${error?.message ?? 'no row'}`);
    return created.id as string;
  }

  /** Append turns (oldest→newest) to a conversation and bump its last_message_at. */
  static async appendTurns(conversationId: string, userId: string, turns: FitzyTurnToPersist[]): Promise<void> {
    if (turns.length === 0) return;
    const supabase = createAdminSupabase();
    const now = new Date().toISOString();

    const rows = turns.map((t) => ({
      conversation_id: conversationId,
      user_id: userId,
      role: t.role,
      content: t.content,
      model: t.model ?? null,
      input_tokens: t.inputTokens ?? null,
      output_tokens: t.outputTokens ?? null,
    }));

    const { error } = await supabase.from('fitzy_messages').insert(rows);
    if (error) throw new Error(`Fitzy message insert failed: ${error.message}`);

    await supabase
      .from('fitzy_conversations')
      .update({ last_message_at: now })
      .eq('id', conversationId)
      .eq('user_id', userId);
  }

  /**
   * Recent turns (oldest→newest) for grounding the model with server-side memory. Returns at most
   * `limit` of the LATEST turns, in chronological order.
   */
  static async getRecentTurns(
    conversationId: string,
    userId: string,
    limit: number
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('fitzy_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    const rows = (data ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>;
    return rows.reverse();
  }

  /**
   * Paginated history for scrollback/cross-device. Returns up to `limit` messages ending at
   * `before` (exclusive), in oldest→newest order. `nextBefore` is the cursor to page further back.
   */
  static async getHistory(
    userId: string,
    opts: { conversationId?: string; before?: string; limit?: number } = {}
  ): Promise<FitzyHistoryResponse> {
    const limit = Math.min(Math.max(opts.limit ?? this.HISTORY_LIMIT, 1), 100);
    const conversationId = await this.getOrCreateActiveConversation(userId, opts.conversationId);
    const supabase = createAdminSupabase();

    let query = supabase
      .from('fitzy_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit + 1); // fetch one extra to compute hasMore
    if (opts.before) query = query.lt('created_at', opts.before);

    const { data } = await query;
    const rows = (data ?? []) as Array<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }>;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextBefore = hasMore ? page[page.length - 1].created_at : null;

    const messages: FitzyStoredMessage[] = page
      .map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }))
      .reverse(); // oldest→newest for direct rendering

    return { conversationId, messages, hasMore, nextBefore };
  }

  /** Delete all messages in the user's (or a given) conversation — backs the "clear history" action. */
  static async clear(userId: string, conversationId?: string): Promise<{ conversationId: string }> {
    const id = await this.getOrCreateActiveConversation(userId, conversationId);
    const supabase = createAdminSupabase();
    await supabase.from('fitzy_messages').delete().eq('conversation_id', id).eq('user_id', userId);
    await supabase.from('fitzy_conversations').update({ last_message_at: null }).eq('id', id).eq('user_id', userId);
    return { conversationId: id };
  }
}
