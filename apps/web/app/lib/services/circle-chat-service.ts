import { canonicalizeChatReaction, isCheerReaction, reactionEmoji } from '../chat/reactions';
import { createAdminSupabase } from '../supabase-admin';
import {
  type ChatMessageDTO,
  type CircleMessageRow,
  type CircleMessageReactionRow,
  type ListMessagesParams,
  type ListMessagesResult,
  type MessagePriority,
  type MessageReactionSummary,
  type MessageCheer,
  type MessageReactor,
  type MessageSender,
  type MessageSystemBlock,
  type RenderHint,
  type ReportStatus,
  type SendMessageInput,
  type SystemEventType,
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_EDIT_BODY_MAX_LENGTH,
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
} from '../types/circle-chat';

import { ChatNotificationService } from './chat-notification-service';
import { ChatSafetyService } from './chat-safety-service';
import { logIgnoredQueryError } from '@/lib/api/route-errors';

/** A replacement this soon after the reactor's previous reaction does not push. */
export const REACTION_PUSH_QUIET_MS = 60_000;

/**
 * message+reactor -> when we last pushed for that reactor's reaction. Catches
 * remove-then-re-add of a different emoji inside the quiet window (the removed
 * row's created_at is gone by then). Process-local and best-effort, like the
 * orchestrator's InProcessSendGuard; bounded by pruning expired entries.
 */
const recentReactionPushes = new Map<string, number>();

function reactionPushKey(messageId: string, reactorId: string): string {
  return `${messageId}:${reactorId}`;
}

function pushedRecently(messageId: string, reactorId: string, now: number): boolean {
  const at = recentReactionPushes.get(reactionPushKey(messageId, reactorId));
  return at !== undefined && now - at < REACTION_PUSH_QUIET_MS;
}

function rememberReactionPush(messageId: string, reactorId: string, now: number): void {
  recentReactionPushes.set(reactionPushKey(messageId, reactorId), now);
  if (recentReactionPushes.size > 5_000) {
    for (const [key, at] of recentReactionPushes) {
      if (now - at >= REACTION_PUSH_QUIET_MS) recentReactionPushes.delete(key);
    }
  }
}

/** Test hook: forget remembered reaction pushes. */
export function resetReactionPushMemory(): void {
  recentReactionPushes.clear();
}

// Columns selected for circle_messages rows mapped to ChatMessageDTO.
const MESSAGE_COLUMNS =
  'id, fitcircle_id, sender_id, kind, body, photo_url, client_id, system_event_type, system_event_ref, system_payload, priority, edited_at, deleted_at, created_at, updated_at';

export class CircleChatService {
  // ============================================================================
  // AUTHORIZATION
  // ============================================================================

  /**
   * Throws Error('Forbidden') if the user is not an active member of the circle.
   * Authorization is enforced explicitly here (RLS is defense in depth).
   */
  static async assertActiveMember(circleId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Forbidden');
  }

  /**
   * Resolve the circle a message belongs to.
   * Throws Error('NotFound') if the message does not exist.
   */
  static async getMessageCircleId(messageId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('circle_messages')
      .select('fitcircle_id')
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('NotFound');

    return data.fitcircle_id;
  }

  // ============================================================================
  // MESSAGES
  // ============================================================================

  /**
   * GET /circles/:id/messages — reverse-chronological page of the timeline.
   */
  static async listMessages(
    circleId: string,
    userId: string,
    params: ListMessagesParams
  ): Promise<ListMessagesResult> {
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const limit = this.clampLimit(params.limit);

    let query = supabaseAdmin
      .from('circle_messages')
      .select(MESSAGE_COLUMNS)
      .eq('fitcircle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (params.before) {
      query = query.lt('created_at', params.before);
    }

    // Hide messages from members this user has blocked (or who blocked them).
    // System posts have sender_id = null, and SQL `NULL NOT IN (…)` is NULL
    // (row dropped), so keep them explicitly.
    const hiddenIds = await ChatSafetyService.getBlockedIdsFor(userId);
    if (hiddenIds.length > 0) {
      query = query.or(`sender_id.is.null,sender_id.not.in.(${hiddenIds.join(',')})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as CircleMessageRow[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const messages = await this.mapRowsToDTOs(pageRows, userId, hiddenIds);

    const nextBefore =
      hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].created_at : null;

    return { messages, hasMore, nextBefore };
  }

  /**
   * POST /circles/:id/messages — member message (user_text | user_photo).
   * Validates kind/body/photo and de-dupes on client_id.
   */
  static async sendMessage(
    circleId: string,
    userId: string,
    input: SendMessageInput
  ): Promise<ChatMessageDTO> {
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    if (input.kind !== 'user_text' && input.kind !== 'user_photo') {
      throw new Error('Invalid message kind');
    }

    let body: string | null = null;
    let photoUrl: string | null = null;

    if (input.kind === 'user_text') {
      const trimmed = (input.body ?? '').trim();
      if (trimmed.length === 0) {
        throw new Error('Message body is required');
      }
      if (trimmed.length > MESSAGE_BODY_MAX_LENGTH) {
        throw new Error(`Message body exceeds ${MESSAGE_BODY_MAX_LENGTH} characters`);
      }
      body = trimmed;
    } else {
      if (!input.photoUrl) {
        throw new Error('Photo URL is required');
      }
      photoUrl = input.photoUrl;
    }

    const clientId = input.clientId ?? null;

    // Idempotent de-dupe: a prior insert with the same (sender_id, client_id).
    if (clientId) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('circle_messages')
        .select(MESSAGE_COLUMNS)
        .eq('sender_id', userId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        const [dto] = await this.mapRowsToDTOs([existing as CircleMessageRow], userId);
        return dto;
      }
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('circle_messages')
      .insert({
        fitcircle_id: circleId,
        sender_id: userId,
        kind: input.kind,
        body,
        photo_url: photoUrl,
        client_id: clientId,
        priority: 'p1',
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (insertError) throw insertError;

    const [dto] = await this.mapRowsToDTOs([inserted as CircleMessageRow], userId);

    // Fire-and-forget chat push fan-out. Never affects the send response.
    const senderName = dto.sender?.name ?? 'Someone';
    const preview = dto.kind === 'user_photo' ? '' : dto.body ?? '';
    void this.resolveCircleName(circleId)
      .then((circleName) =>
        ChatNotificationService.notifyNewMessage(
          circleId,
          userId,
          senderName,
          circleName,
          dto.id,
          preview
        )
      )
      .catch(() => {});

    return dto;
  }

  /**
   * Best-effort circle display name lookup (used for notification copy).
   */
  private static async resolveCircleName(circleId: string): Promise<string> {
    try {
      const supabaseAdmin = createAdminSupabase();
      const { data, error: dataError } = await supabaseAdmin
        .from('fitcircles')
        .select('name')
        .eq('id', circleId)
        .maybeSingle();
      logIgnoredQueryError('CircleChatService.resolveCircleName', dataError);
      return (data?.name as string | undefined) ?? 'your circle';
    } catch {
      return 'your circle';
    }
  }

  /**
   * PATCH /messages/:id — sender edits their own user_text message.
   * Allowed only within MESSAGE_EDIT_WINDOW_MS of created_at and never on a
   * tombstone. Sets edited_at and returns the re-mapped DTO.
   */
  static async editMessage(
    userId: string,
    messageId: string,
    body: string
  ): Promise<ChatMessageDTO> {
    const row = await this.getMessageRowForOwnerAction(messageId, userId);

    if (row.sender_id !== userId) throw new Error('Forbidden');
    if (row.deleted_at) throw new Error('MessageDeleted');
    if (row.kind !== 'user_text') throw new Error('InvalidMessageKind');
    // A cheer's body is generated from its structured data; editing would desync them.
    if (this.cheerOf(row)) throw new Error('InvalidMessageKind');

    const createdAtMs = new Date(row.created_at).getTime();
    if (Date.now() - createdAtMs > MESSAGE_EDIT_WINDOW_MS) {
      throw new Error('EditWindowExpired');
    }

    const trimmed = (body ?? '').trim();
    if (trimmed.length === 0) {
      throw new Error('Message body is required');
    }
    if (trimmed.length > MESSAGE_EDIT_BODY_MAX_LENGTH) {
      throw new Error(`Message body exceeds ${MESSAGE_EDIT_BODY_MAX_LENGTH} characters`);
    }

    const supabaseAdmin = createAdminSupabase();

    const { data: updated, error } = await supabaseAdmin
      .from('circle_messages')
      .update({ body: trimmed, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) throw error;

    const [dto] = await this.mapRowsToDTOs([updated as CircleMessageRow], userId);
    return dto;
  }

  /**
   * DELETE /messages/:id — sender soft-deletes their own message.
   * Tombstone semantics: deleted_at set, body cleared, photo_url nulled.
   * Idempotent — deleting an already-deleted message returns the tombstone.
   */
  static async deleteMessage(userId: string, messageId: string): Promise<ChatMessageDTO> {
    const row = await this.getMessageRowForOwnerAction(messageId, userId);

    if (row.sender_id !== userId) throw new Error('Forbidden');
    if (row.kind === 'system_event') throw new Error('InvalidMessageKind');

    if (row.deleted_at) {
      const [existing] = await this.mapRowsToDTOs([row], userId);
      return existing;
    }

    const supabaseAdmin = createAdminSupabase();

    const { data: updated, error } = await supabaseAdmin
      .from('circle_messages')
      .update({ deleted_at: new Date().toISOString(), body: null, photo_url: null })
      .eq('id', messageId)
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) throw error;

    const [dto] = await this.mapRowsToDTOs([updated as CircleMessageRow], userId);
    return dto;
  }

  /**
   * Fetch a full message row for an owner edit/delete. Non-members get
   * Error('NotFound') (not 'Forbidden') so message existence is never leaked
   * outside the circle.
   */
  private static async getMessageRowForOwnerAction(
    messageId: string,
    userId: string
  ): Promise<CircleMessageRow> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('circle_messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('NotFound');

    const row = data as CircleMessageRow;

    try {
      await this.assertActiveMember(row.fitcircle_id, userId);
    } catch (err) {
      if (err instanceof Error && err.message === 'Forbidden') {
        throw new Error('NotFound');
      }
      throw err;
    }

    return row;
  }

  /**
   * Used by the system-post engine (NOT exposed via a member route). Writes a
   * kind='system_event' row (sender_id=null) and returns the mapped DTO.
   * actorUserIds + renderHint are folded into system_payload as
   * { render_hint, actors: [{ id }], ...systemPayload }.
   */
  static async emitSystemPost(params: {
    fitcircleId: string;
    eventType: SystemEventType;
    priority: MessagePriority;
    renderHint: RenderHint;
    body: string;
    refId?: string | null;
    actorUserIds?: string[];
    systemPayload?: Record<string, unknown>;
  }): Promise<ChatMessageDTO> {
    const supabaseAdmin = createAdminSupabase();

    const systemPayload: Record<string, unknown> = {
      render_hint: params.renderHint,
      actors: (params.actorUserIds ?? []).map((id) => ({ id })),
      ...(params.systemPayload ?? {}),
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('circle_messages')
      .insert({
        fitcircle_id: params.fitcircleId,
        sender_id: null,
        kind: 'system_event',
        body: params.body,
        system_event_type: params.eventType,
        system_event_ref: params.refId ?? null,
        system_payload: systemPayload,
        priority: params.priority,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (insertError) throw insertError;

    // No viewer context for system writes; pass a sentinel so reactedByMe=false.
    const [dto] = await this.mapRowsToDTOs([inserted as CircleMessageRow], '');
    return dto;
  }

  /**
   * Map one stored row to the client DTO as `viewerId` sees it (used by the
   * cheer service after its insert).
   */
  static async toDTO(row: CircleMessageRow, viewerId: string): Promise<ChatMessageDTO> {
    const [dto] = await this.mapRowsToDTOs([row], viewerId);
    return dto;
  }

  /** Resolve a circle's display name for notification copy ('your circle' on failure). */
  static async circleNameOf(circleId: string): Promise<string> {
    return this.resolveCircleName(circleId);
  }

  /**
   * The structured cheer on a row, normalized to the wire shape, or null (not
   * a cheer, deleted, or malformed). Pure.
   */
  static cheerOf(row: Pick<CircleMessageRow, 'kind' | 'system_payload' | 'deleted_at'>): MessageCheer | null {
    if (row.kind !== 'user_text' || row.deleted_at) return null;
    const raw = (row.system_payload as { cheer?: unknown } | null)?.cheer;
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.to_user_id !== 'string' || !c.to_user_id) return null;
    const reaction = typeof c.reaction === 'string' && c.reaction ? c.reaction : 'clap';
    const snap = c.stat_snapshot && typeof c.stat_snapshot === 'object' ? (c.stat_snapshot as Record<string, unknown>) : null;
    return {
      to_user_id: c.to_user_id,
      to_display_name: typeof c.to_display_name === 'string' ? c.to_display_name : '',
      reaction,
      emoji: typeof c.emoji === 'string' && c.emoji ? c.emoji : reactionEmoji(reaction),
      message: typeof c.message === 'string' && c.message ? c.message : null,
      source: c.source === 'member_sheet' ? 'member_sheet' : 'leaderboard_long_press',
      stat_snapshot:
        snap && typeof snap.today_steps === 'number' && typeof snap.daily_goal_steps === 'number'
          ? {
              metric: 'steps',
              date: typeof snap.date === 'string' ? snap.date : '',
              today_steps: snap.today_steps,
              daily_goal_steps: snap.daily_goal_steps,
              goal_pct_today: typeof snap.goal_pct_today === 'number' ? snap.goal_pct_today : null,
            }
          : null,
    };
  }

  // ============================================================================
  // REACTIONS
  // ============================================================================

  /**
   * PUT /messages/:id/reactions (v2) — set the viewer's ONE reaction on a
   * message, replacing any previous one (iMessage/WhatsApp rule). `reaction` is
   * a named kind or a single emoji; a named kind's emoji is stored as the kind.
   * Returns the recomputed reaction summary for the message.
   */
  static async setReaction(
    messageId: string,
    userId: string,
    reaction: string
  ): Promise<MessageReactionSummary[]> {
    const value = canonicalizeChatReaction(reaction);
    if (!value) throw new Error('InvalidReaction');

    const circleId = await this.getMessageCircleId(messageId);
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    // Tombstones cannot collect new reactions.
    const { data: messageRow, error: messageError } = await supabaseAdmin
      .from('circle_messages')
      .select('deleted_at')
      .eq('id', messageId)
      .maybeSingle();

    if (messageError) throw messageError;
    if (messageRow?.deleted_at) throw new Error('MessageDeleted');

    // The viewer's current row(s). Pre-v2 data may hold several per user; the
    // replace below collapses them to one.
    const { data: priorData, error: priorError } = await supabaseAdmin
      .from('circle_message_reactions')
      .select('reaction, created_at')
      .eq('message_id', messageId)
      .eq('user_id', userId);
    if (priorError) throw priorError;
    const prior = (priorData ?? []) as Array<{ reaction: string; created_at: string }>;

    const alreadyHasValue = prior.some((r) => r.reaction === value);
    const others = prior.filter((r) => r.reaction !== value);

    if (others.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('circle_message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .neq('reaction', value);
      if (deleteError) throw deleteError;
    }

    if (!alreadyHasValue) {
      const { error } = await supabaseAdmin
        .from('circle_message_reactions')
        .upsert(
          { message_id: messageId, user_id: userId, reaction: value },
          { onConflict: 'message_id,user_id,reaction', ignoreDuplicates: true }
        );
      if (error) throw error;
    }

    // Tell the author (fire-and-forget; never affects the reaction response).
    // A re-tap / retry never re-notifies, and neither does fiddling: a
    // replacement within REACTION_PUSH_QUIET_MS of the previous reaction, or a
    // remove-then-re-add within that window of the last push for this reactor.
    const now = Date.now();
    if (this.shouldNotifyReaction(prior, value, now) && !pushedRecently(messageId, userId, now)) {
      rememberReactionPush(messageId, userId, now);
      void this.notifyReactionAuthor(circleId, messageId, userId, value).catch(() => {});
    }

    // Re-check after the write: a concurrent delete may have tombstoned the
    // message between the check above and the upsert. Roll the reaction back
    // so no stale rows land on tombstones.
    const { data: recheckRow, error: recheckError } = await supabaseAdmin
      .from('circle_messages')
      .select('deleted_at')
      .eq('id', messageId)
      .maybeSingle();

    if (recheckError) throw recheckError;
    if (recheckRow?.deleted_at) {
      await supabaseAdmin
        .from('circle_message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('reaction', value);
      throw new Error('MessageDeleted');
    }

    const summaries = await this.buildReactionSummaries([messageId], userId);
    return summaries.get(messageId) ?? [];
  }

  /**
   * Legacy POST /messages/:id/reactions (shipped clients). Same replace
   * semantics as PUT so old and new clients agree on one reaction per person.
   */
  static async addReaction(
    messageId: string,
    userId: string,
    reaction: string
  ): Promise<MessageReactionSummary[]> {
    return this.setReaction(messageId, userId, reaction);
  }

  /**
   * DELETE /messages/:id/reactions (v2) — clear whatever the viewer reacted with.
   * Idempotent. Never pushes.
   */
  static async clearReaction(
    messageId: string,
    userId: string
  ): Promise<MessageReactionSummary[]> {
    const circleId = await this.getMessageCircleId(messageId);
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);

    if (error) throw error;

    const summaries = await this.buildReactionSummaries([messageId], userId);
    return summaries.get(messageId) ?? [];
  }

  /**
   * Legacy DELETE /messages/:id/reactions/:reaction — remove one specific
   * reaction (a no-op when the viewer's reaction is something else).
   * Returns the recomputed reaction summary for the message.
   */
  static async removeReaction(
    messageId: string,
    userId: string,
    reaction: string
  ): Promise<MessageReactionSummary[]> {
    const value = canonicalizeChatReaction(reaction);
    if (!value) throw new Error('InvalidReaction');

    const circleId = await this.getMessageCircleId(messageId);
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('reaction', value);

    if (error) throw error;

    const summaries = await this.buildReactionSummaries([messageId], userId);
    return summaries.get(messageId) ?? [];
  }

  /**
   * GET /messages/:id/reactions — who reacted with what. One row per member
   * (their newest reaction), the viewer first, then newest first.
   */
  static async listReactors(messageId: string, userId: string): Promise<MessageReactor[]> {
    const circleId = await this.getMessageCircleId(messageId);
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('circle_message_reactions')
      .select('user_id, reaction, created_at')
      .eq('message_id', messageId);
    if (error) throw error;

    // Members the viewer blocked (or who blocked the viewer) are invisible here,
    // matching the counts in buildReactionSummaries.
    const hidden = new Set(await ChatSafetyService.getBlockedIdsFor(userId));
    const newest = this.newestPerUser(
      ((data ?? []) as Array<{ user_id: string; reaction: string; created_at: string }>)
        .filter((r) => !hidden.has(r.user_id))
        .map((r) => ({ ...r, message_id: messageId }))
    );
    if (newest.length === 0) return [];

    const ids = Array.from(new Set(newest.map((r) => r.user_id)));
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', ids);
    if (profileError) throw profileError;
    const profileById = new Map(
      ((profiles ?? []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>).map(
        (p) => [p.id, p]
      )
    );

    return newest
      .map((r) => ({
        user_id: r.user_id,
        display_name: profileById.get(r.user_id)?.display_name ?? '',
        avatar_url: profileById.get(r.user_id)?.avatar_url ?? null,
        reaction: r.reaction,
        emoji: reactionEmoji(r.reaction),
        reacted_at: r.created_at,
      }))
      .sort((a, b) => {
        if (a.user_id === userId) return -1;
        if (b.user_id === userId) return 1;
        return Date.parse(b.reacted_at) - Date.parse(a.reacted_at);
      });
  }

  /**
   * Push only for a reaction that is actually new for this reactor, and not
   * when it replaces one they set less than REACTION_PUSH_QUIET_MS ago (no spam
   * while someone fiddles with the picker). Removals never push. Pure.
   */
  static shouldNotifyReaction(
    prior: ReadonlyArray<{ reaction: string; created_at: string }>,
    value: string,
    now: number = Date.now()
  ): boolean {
    if (prior.some((r) => r.reaction === value)) return false;
    return !prior.some((r) => {
      const at = Date.parse(r.created_at);
      return Number.isFinite(at) && now - at < REACTION_PUSH_QUIET_MS;
    });
  }

  /**
   * A NEW reaction landed on a message: push the author (or, for a system
   * post, the member it is about). Resolves names/preview here so the
   * notification layer stays free of chat-row knowledge. Never throws.
   */
  private static async notifyReactionAuthor(
    circleId: string,
    messageId: string,
    reactorId: string,
    reaction: string
  ): Promise<void> {
    try {
      const supabaseAdmin = createAdminSupabase();
      const { data: row, error: rowError } = await supabaseAdmin
        .from('circle_messages')
        .select('sender_id, kind, body, system_payload')
        .eq('id', messageId)
        .maybeSingle();
      logIgnoredQueryError('CircleChatService.notifyReactionAuthor', rowError);
      if (!row) return;

      const recipientId = ChatNotificationService.reactionRecipient(
        row as { sender_id: string | null; system_payload?: Record<string, unknown> | null },
        reactorId
      );
      if (!recipientId) return;
      // A blocked pair never hears about each other's reactions.
      if ((await ChatSafetyService.getBlockedIdsFor(recipientId)).includes(reactorId)) return;

      const [{ data: reactor }, circleName] = await Promise.all([
        supabaseAdmin.from('profiles').select('display_name').eq('id', reactorId).maybeSingle(),
        this.resolveCircleName(circleId),
      ]);

      const preview =
        row.kind === 'user_photo'
          ? 'your photo'
          : ((row.body as string | null) ?? '').trim();

      await ChatNotificationService.notifyReaction({
        circleId,
        circleName,
        messageId,
        recipientId,
        reactorId,
        reactorName: (reactor?.display_name as string | null) ?? 'Someone',
        emoji: reactionEmoji(reaction),
        cheer: isCheerReaction(reaction),
        subject: row.kind === 'user_photo' ? 'photo' : row.kind === 'system_event' ? 'post' : 'message',
        preview,
      });
    } catch (err) {
      console.error(`[CircleChatService.notifyReactionAuthor] swallowed for ${messageId}:`, err);
    }
  }

  // ============================================================================
  // CHAT STATE (read cursor + mute)
  // ============================================================================

  /**
   * POST /circles/:id/read — mark read up to now.
   */
  static async markRead(circleId: string, userId: string): Promise<{ lastReadAt: string }> {
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const lastReadAt = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('circle_chat_state')
      .upsert(
        { fitcircle_id: circleId, user_id: userId, last_read_at: lastReadAt },
        { onConflict: 'fitcircle_id,user_id' }
      );

    if (error) throw error;

    return { lastReadAt };
  }

  /**
   * POST /circles/:id/mute — set per-circle chat mute.
   */
  static async setMute(
    circleId: string,
    userId: string,
    muted: boolean
  ): Promise<{ muted: boolean }> {
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_chat_state')
      .upsert(
        { fitcircle_id: circleId, user_id: userId, muted },
        { onConflict: 'fitcircle_id,user_id' }
      );

    if (error) throw error;

    return { muted };
  }

  // ============================================================================
  // MODERATION
  // ============================================================================

  /**
   * POST /messages/:id/report — file a report (one per reporter per message).
   */
  static async reportMessage(
    messageId: string,
    userId: string,
    reason: string | null
  ): Promise<{ reportId: string; status: ReportStatus }> {
    const circleId = await this.getMessageCircleId(messageId);
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const { data: inserted, error } = await supabaseAdmin
      .from('circle_message_reports')
      .insert({ message_id: messageId, reporter_id: userId, reason })
      .select('id, status')
      .single();

    if (inserted) {
      return { reportId: inserted.id, status: inserted.status as ReportStatus };
    }

    // Unique (message_id, reporter_id) conflict -> return the existing report.
    if (error && this.isUniqueViolation(error)) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('circle_message_reports')
        .select('id, status')
        .eq('message_id', messageId)
        .eq('reporter_id', userId)
        .single();

      if (existingError) throw existingError;
      return { reportId: existing.id, status: existing.status as ReportStatus };
    }

    if (error) throw error;
    throw new Error('Failed to create report');
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private static clampLimit(limit?: number): number {
    if (limit === undefined || limit === null || Number.isNaN(limit)) {
      return MESSAGE_PAGE_DEFAULT_LIMIT;
    }
    const floored = Math.floor(limit);
    return Math.min(Math.max(floored, 1), MESSAGE_PAGE_MAX_LIMIT);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static isUniqueViolation(error: any): boolean {
    return error?.code === '23505';
  }

  /**
   * Map circle_messages rows -> ChatMessageDTO[], batching sender-profile and
   * reaction lookups (no N+1). Preserves input order.
   */
  private static async mapRowsToDTOs(
    rows: CircleMessageRow[],
    userId: string,
    hiddenIds?: readonly string[]
  ): Promise<ChatMessageDTO[]> {
    if (rows.length === 0) return [];

    const supabaseAdmin = createAdminSupabase();

    // Batch profiles for all distinct sender_ids AND system-event actor ids.
    // System posts store actors as `{ id }` only (the copy is pre-rendered into
    // `body`), but the wire contract promises `{ id, name }` — the iOS client
    // failed to decode whole pages when `name` was absent.
    const senderIds = rows.map((r) => r.sender_id).filter((id): id is string => !!id);
    const actorIds = rows.flatMap((r) => this.actorIdsOf(r));
    const profileIds = Array.from(new Set([...senderIds, ...actorIds]));
    const senderById = new Map<string, MessageSender>();
    if (profileIds.length > 0) {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', profileIds);
      if (error) throw error;
      for (const p of profiles ?? []) {
        senderById.set(p.id, {
          id: p.id,
          name: p.display_name ?? '',
          avatarUrl: p.avatar_url ?? null,
        });
      }
    }

    // Batch reaction summaries for all message ids.
    const messageIds = rows.map((r) => r.id);
    const reactionsByMessage = await this.buildReactionSummaries(messageIds, userId, hiddenIds);

    return rows.map((row) => {
      const sender = row.sender_id ? senderById.get(row.sender_id) ?? null : null;
      const system = row.kind === 'system_event' ? this.buildSystemBlock(row, senderById) : null;
      // Deleted rows always serialize as tombstones (no body, no photo),
      // regardless of what the stored row still holds.
      const isDeleted = !!row.deleted_at;

      return {
        id: row.id,
        circleId: row.fitcircle_id,
        kind: row.kind,
        sender,
        body: isDeleted ? null : row.body,
        photoUrl: isDeleted ? null : row.photo_url,
        system,
        reactions: reactionsByMessage.get(row.id) ?? [],
        clientId: row.client_id,
        createdAt: row.created_at,
        editedAt: row.edited_at ?? null,
        deletedAt: row.deleted_at ?? null,
        cheer: this.cheerOf(row),
      };
    });
  }

  /** Actor ids referenced by a system post's payload (for the profile batch). */
  private static actorIdsOf(row: CircleMessageRow): string[] {
    if (row.kind !== 'system_event') return [];
    const payload = (row.system_payload ?? {}) as { actors?: unknown };
    if (!Array.isArray(payload.actors)) return [];
    return payload.actors
      .map((a) => (a && typeof a === 'object' ? (a as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  /**
   * Normalize stored actors to the `{ id, name }` wire shape. Names come from
   * the payload when present, else the batched profile lookup, else ''. Entries
   * without a usable id are dropped rather than sent malformed.
   */
  static normalizeActors(
    raw: unknown,
    nameById: ReadonlyMap<string, { name: string }>
  ): Array<{ id: string; name: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ id: string; name: string }> = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, name } = entry as { id?: unknown; name?: unknown };
      if (typeof id !== 'string' || id.length === 0) continue;
      out.push({
        id,
        name: typeof name === 'string' && name.length > 0 ? name : nameById.get(id)?.name ?? '',
      });
    }
    return out;
  }

  private static buildSystemBlock(
    row: CircleMessageRow,
    nameById: ReadonlyMap<string, { name: string }> = new Map()
  ): MessageSystemBlock {
    const payload = (row.system_payload ?? {});
    const renderHint = (
      typeof payload.render_hint === 'string' ? (payload.render_hint as RenderHint) : 'text'
    );
    const actors = this.normalizeActors(payload.actors, nameById);

    return {
      eventType: row.system_event_type as SystemEventType,
      refId: row.system_event_ref,
      renderHint,
      actors,
      payload,
    };
  }

  /**
   * The reaction that counts for each (message, user): their newest row. Pre-v2
   * data can hold several rows per user (the PK includes `reaction`); the next
   * PUT/POST from that user collapses them. Ties keep the first row seen. Pure.
   */
  static newestPerUser<T extends { message_id: string; user_id: string; created_at: string }>(
    rows: readonly T[]
  ): T[] {
    const byKey = new Map<string, T>();
    for (const row of rows) {
      const key = `${row.message_id}:${row.user_id}`;
      const current = byKey.get(key);
      if (!current || Date.parse(row.created_at) > Date.parse(current.created_at)) {
        byKey.set(key, row);
      }
    }
    return Array.from(byKey.values());
  }

  /**
   * Fold reaction rows into MessageReactionSummary[] per message (newest row per
   * user counts). Order: count desc, then the reaction that appeared first. Pure.
   */
  static summarizeReactions(
    rows: ReadonlyArray<Pick<CircleMessageReactionRow, 'message_id' | 'user_id' | 'reaction' | 'created_at'>>,
    messageIds: readonly string[],
    userId: string
  ): Map<string, MessageReactionSummary[]> {
    const result = new Map<string, MessageReactionSummary[]>();

    // message_id -> reaction -> { count, reactedByMe, firstAt }
    const agg = new Map<string, Map<string, { count: number; reactedByMe: boolean; firstAt: number }>>();

    for (const row of this.newestPerUser(rows)) {
      let perMessage = agg.get(row.message_id);
      if (!perMessage) {
        perMessage = new Map();
        agg.set(row.message_id, perMessage);
      }
      const at = Date.parse(row.created_at);
      const entry = perMessage.get(row.reaction) ?? { count: 0, reactedByMe: false, firstAt: at };
      entry.count += 1;
      if (row.user_id === userId) entry.reactedByMe = true;
      if (at < entry.firstAt) entry.firstAt = at;
      perMessage.set(row.reaction, entry);
    }

    for (const messageId of messageIds) {
      const perMessage = agg.get(messageId);
      if (!perMessage) {
        result.set(messageId, []);
        continue;
      }
      const summaries = Array.from(perMessage, ([reaction, e]) => ({ reaction, ...e }))
        .sort((a, b) => b.count - a.count || (a.firstAt || 0) - (b.firstAt || 0))
        .map(({ reaction, count, reactedByMe }) => ({
          reaction,
          emoji: reactionEmoji(reaction),
          count,
          reactedByMe,
        }));
      result.set(messageId, summaries);
    }

    return result;
  }

  /**
   * Aggregate circle_message_reactions into MessageReactionSummary[] per message
   * in a single query across all supplied message ids, as the viewer sees them
   * (blocked members excluded).
   */
  private static async buildReactionSummaries(
    messageIds: string[],
    userId: string,
    hiddenIds?: readonly string[]
  ): Promise<Map<string, MessageReactionSummary[]>> {
    if (messageIds.length === 0) return new Map();

    // Reactions from members the viewer blocked / who blocked the viewer are
    // left out of the counts (same rule as the hidden messages in listMessages).
    // System writes pass userId '' — no viewer, nothing to hide.
    const hidden = new Set(hiddenIds ?? (userId ? await ChatSafetyService.getBlockedIdsFor(userId) : []));

    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('circle_message_reactions')
      .select('message_id, user_id, reaction, created_at')
      .in('message_id', messageIds);

    if (error) throw error;

    const rows = ((data ?? []) as Pick<
      CircleMessageReactionRow,
      'message_id' | 'user_id' | 'reaction' | 'created_at'
    >[]).filter((r) => !hidden.has(r.user_id));

    return this.summarizeReactions(rows, messageIds, userId);
  }
}
