import { createAdminSupabase } from '../supabase-admin';
import {
  type ChatMessageDTO,
  type CircleMessageRow,
  type CircleMessageReactionRow,
  type ListMessagesParams,
  type ListMessagesResult,
  type MessagePriority,
  type MessageReactionSummary,
  type MessageSender,
  type MessageSystemBlock,
  type ReactionKind,
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
    // System posts have sender_id = null, so `.not in` never excludes them.
    const hiddenIds = await ChatSafetyService.getBlockedIdsFor(userId);
    if (hiddenIds.length > 0) {
      query = query.not('sender_id', 'in', `(${hiddenIds.join(',')})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as CircleMessageRow[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const messages = await this.mapRowsToDTOs(pageRows, userId);

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
      const { data } = await supabaseAdmin
        .from('fitcircles')
        .select('name')
        .eq('id', circleId)
        .maybeSingle();
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

  // ============================================================================
  // REACTIONS
  // ============================================================================

  /**
   * POST /messages/:id/reactions — add a reaction (idempotent on the PK).
   * Returns the recomputed reaction summary for the message.
   */
  static async addReaction(
    messageId: string,
    userId: string,
    reaction: ReactionKind
  ): Promise<MessageReactionSummary[]> {
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

    const { error } = await supabaseAdmin
      .from('circle_message_reactions')
      .upsert(
        { message_id: messageId, user_id: userId, reaction },
        { onConflict: 'message_id,user_id,reaction', ignoreDuplicates: true }
      );

    if (error) throw error;

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
        .eq('reaction', reaction);
      throw new Error('MessageDeleted');
    }

    const summaries = await this.buildReactionSummaries([messageId], userId);
    return summaries.get(messageId) ?? [];
  }

  /**
   * DELETE /messages/:id/reactions/:reaction — remove a reaction.
   * Returns the recomputed reaction summary for the message.
   */
  static async removeReaction(
    messageId: string,
    userId: string,
    reaction: ReactionKind
  ): Promise<MessageReactionSummary[]> {
    const circleId = await this.getMessageCircleId(messageId);
    await this.assertActiveMember(circleId, userId);

    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('reaction', reaction);

    if (error) throw error;

    const summaries = await this.buildReactionSummaries([messageId], userId);
    return summaries.get(messageId) ?? [];
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
    userId: string
  ): Promise<ChatMessageDTO[]> {
    if (rows.length === 0) return [];

    const supabaseAdmin = createAdminSupabase();

    // Batch sender profiles for all distinct sender_ids.
    const senderIds = Array.from(
      new Set(rows.map((r) => r.sender_id).filter((id): id is string => !!id))
    );

    const senderById = new Map<string, MessageSender>();
    if (senderIds.length > 0) {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', senderIds);

      if (error) throw error;

      for (const p of profiles ?? []) {
        senderById.set(p.id, {
          id: p.id,
          name: p.display_name,
          avatarUrl: p.avatar_url ?? null,
        });
      }
    }

    // Batch reaction summaries for all message ids.
    const messageIds = rows.map((r) => r.id);
    const reactionsByMessage = await this.buildReactionSummaries(messageIds, userId);

    return rows.map((row) => {
      const sender = row.sender_id ? senderById.get(row.sender_id) ?? null : null;
      const system = row.kind === 'system_event' ? this.buildSystemBlock(row) : null;
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
      };
    });
  }

  private static buildSystemBlock(row: CircleMessageRow): MessageSystemBlock {
    const payload = (row.system_payload ?? {});

    const renderHint = (
      typeof payload.render_hint === 'string' ? (payload.render_hint as RenderHint) : 'text'
    );

    const actors = Array.isArray(payload.actors)
      ? (payload.actors as Array<{ id: string; name: string }>)
      : [];

    return {
      eventType: row.system_event_type as SystemEventType,
      refId: row.system_event_ref,
      renderHint,
      actors,
      payload,
    };
  }

  /**
   * Aggregate circle_message_reactions into MessageReactionSummary[] per message
   * in a single query across all supplied message ids.
   */
  private static async buildReactionSummaries(
    messageIds: string[],
    userId: string
  ): Promise<Map<string, MessageReactionSummary[]>> {
    const result = new Map<string, MessageReactionSummary[]>();
    if (messageIds.length === 0) return result;

    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('circle_message_reactions')
      .select('message_id, user_id, reaction')
      .in('message_id', messageIds);

    if (error) throw error;

    const rows = (data ?? []) as Pick<
      CircleMessageReactionRow,
      'message_id' | 'user_id' | 'reaction'
    >[];

    // message_id -> reaction -> { count, reactedByMe }
    const agg = new Map<string, Map<ReactionKind, { count: number; reactedByMe: boolean }>>();

    for (const row of rows) {
      let perMessage = agg.get(row.message_id);
      if (!perMessage) {
        perMessage = new Map();
        agg.set(row.message_id, perMessage);
      }
      const entry = perMessage.get(row.reaction) ?? { count: 0, reactedByMe: false };
      entry.count += 1;
      if (row.user_id === userId) entry.reactedByMe = true;
      perMessage.set(row.reaction, entry);
    }

    for (const messageId of messageIds) {
      const perMessage = agg.get(messageId);
      if (!perMessage) {
        result.set(messageId, []);
        continue;
      }
      const summaries: MessageReactionSummary[] = [];
      for (const [reaction, { count, reactedByMe }] of perMessage) {
        summaries.push({ reaction, count, reactedByMe });
      }
      result.set(messageId, summaries);
    }

    return result;
  }
}
