import { createAdminSupabase } from '../supabase-admin';
import { type ReportStatus } from '../types/circle-chat';

// ============================================================================
// Public shapes for the safety surface (block list + moderation queue).
// Mirrors the circle-chat-service style: snake_case in DB, camelCase in DTOs.
// ============================================================================

export interface BlockedUser {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface ModerationQueueRow {
  reportId: string;
  status: ReportStatus;
  reason: string | null;
  reportedAt: string;
  message: {
    id: string;
    circleId: string;
    kind: string;
    body: string | null;
    senderId: string | null;
    senderName: string | null;
  } | null;
  reporter: {
    id: string;
    name: string | null;
  } | null;
}

export type ModerationAction = 'reviewed' | 'actioned';

/**
 * ChatSafetyService — block list + moderation/report-queue read+action.
 *
 * Style mirrors CircleChatService: static methods, createAdminSupabase(),
 * error contract throws Error('Forbidden' | 'NotFound') which routes map to HTTP.
 * No stored procedures — all logic lives here.
 *
 * Report SUBMISSION lives in CircleChatService.reportMessage (do not duplicate);
 * this service owns BLOCK + the moderation-queue read/action side.
 */
export class ChatSafetyService {
  // ============================================================================
  // BLOCK LIST
  // ============================================================================

  /**
   * Block another user app-wide. Idempotent: a duplicate (blocker, blocked) edge
   * is silently ignored. Throws Error('Forbidden') on self-block.
   */
  static async blockMember(
    blockerId: string,
    blockedId: string
  ): Promise<{ blocked: true }> {
    if (blockerId === blockedId) {
      throw new Error('Forbidden');
    }

    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_member_blocks')
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }
      );

    if (error) throw error;

    return { blocked: true };
  }

  /**
   * Remove a block edge. Idempotent: deleting a non-existent edge is a no-op.
   */
  static async unblockMember(
    blockerId: string,
    blockedId: string
  ): Promise<{ blocked: false }> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_member_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);

    if (error) throw error;

    return { blocked: false };
  }

  /**
   * List the users the caller has blocked, enriched with profile display data.
   */
  static async listBlocked(blockerId: string): Promise<BlockedUser[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data: blocks, error } = await supabaseAdmin
      .from('circle_member_blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = (blocks ?? []) as Array<{ blocked_id: string; created_at: string }>;
    if (rows.length === 0) return [];

    const blockedIds = rows.map((r) => r.blocked_id);

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', blockedIds);

    if (profileError) throw profileError;

    const profileById = new Map<string, { display_name: string | null; avatar_url: string | null }>();
    for (const p of profiles ?? []) {
      profileById.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url ?? null });
    }

    return rows.map((r) => {
      const p = profileById.get(r.blocked_id);
      return {
        id: r.blocked_id,
        name: p?.display_name ?? null,
        avatarUrl: p?.avatar_url ?? null,
        createdAt: r.created_at,
      };
    });
  }

  /**
   * The bidirectional hide set for a user: every id they have blocked OR who has
   * blocked them. Used to filter chat timelines (see integration note in the
   * service header / PR — CircleChatService.listMessages should call this and
   * exclude sender_ids in the returned set).
   *
   * Returns a de-duplicated string[] (excludes the caller's own id defensively).
   */
  static async getBlockedIdsFor(userId: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();

    // Edges where the user is on either side.
    const { data, error } = await supabaseAdmin
      .from('circle_member_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

    if (error) throw error;

    const rows = (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>;

    const hidden = new Set<string>();
    for (const row of rows) {
      // The "other side" of every edge touching the user is hidden.
      const other = row.blocker_id === userId ? row.blocked_id : row.blocker_id;
      if (other && other !== userId) hidden.add(other);
    }

    return Array.from(hidden);
  }

  // ============================================================================
  // MODERATION QUEUE (human-reviewed)
  // ============================================================================
  //
  // Per spec, moderation is a human decision. This service exposes the read +
  // status-action side only; it does NOT auto-remove content. The handler must
  // gate these to a reviewer.
  //
  // ADMIN GATING: profiles has no is_admin / role flag today (verified against the
  // schema), so we cannot enforce reviewer authority in-service yet. These methods
  // accept a reviewerId and trust the caller (an internal/admin-gated route) to
  // have authorized it.
  // TODO(admin): when a profiles.is_admin (or role) column lands, assert it here
  // and throw Error('Forbidden') for non-reviewers.

  /**
   * Read the open moderation queue: open reports joined to their message (body,
   * sender) and the reporting user's profile. Newest-first.
   */
  static async listOpenReports(): Promise<ModerationQueueRow[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data: reports, error } = await supabaseAdmin
      .from('circle_message_reports')
      .select('id, message_id, reporter_id, reason, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const rows = (reports ?? []) as Array<{
      id: string;
      message_id: string;
      reporter_id: string;
      reason: string | null;
      status: ReportStatus;
      created_at: string;
    }>;

    if (rows.length === 0) return [];

    const messageIds = Array.from(new Set(rows.map((r) => r.message_id)));
    const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_id)));

    // Batch the message rows.
    const { data: messages, error: msgError } = await supabaseAdmin
      .from('circle_messages')
      .select('id, fitcircle_id, kind, body, sender_id')
      .in('id', messageIds);

    if (msgError) throw msgError;

    const messageById = new Map<
      string,
      { id: string; fitcircle_id: string; kind: string; body: string | null; sender_id: string | null }
    >();
    for (const m of messages ?? []) {
      messageById.set(m.id, m);
    }

    // Batch all involved profiles (reporters + message senders) in one query.
    const senderIds = (messages ?? [])
      .map((m) => m.sender_id)
      .filter((id): id is string => !!id);
    const profileIds = Array.from(new Set([...reporterIds, ...senderIds]));

    const profileById = new Map<string, { display_name: string | null }>();
    if (profileIds.length > 0) {
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name')
        .in('id', profileIds);

      if (profileError) throw profileError;

      for (const p of profiles ?? []) {
        profileById.set(p.id, { display_name: p.display_name });
      }
    }

    return rows.map((r) => {
      const msg = messageById.get(r.message_id) ?? null;
      const senderName =
        msg?.sender_id ? profileById.get(msg.sender_id)?.display_name ?? null : null;

      return {
        reportId: r.id,
        status: r.status,
        reason: r.reason,
        reportedAt: r.created_at,
        message: msg
          ? {
              id: msg.id,
              circleId: msg.fitcircle_id,
              kind: msg.kind,
              body: msg.body,
              senderId: msg.sender_id,
              senderName,
            }
          : null,
        reporter: {
          id: r.reporter_id,
          name: profileById.get(r.reporter_id)?.display_name ?? null,
        },
      };
    });
  }

  /**
   * Action an open report: set its status to 'reviewed' (no action needed) or
   * 'actioned' (a reviewer took/aims to take content action). This only records
   * the human decision — actual content removal is a separate, deliberate step
   * (e.g. the reviewer soft-deletes the message via the owner-update path) and is
   * intentionally NOT performed here.
   *
   * Throws Error('NotFound') if the report id does not exist.
   */
  static async actionReport(
    reportId: string,
    reviewerId: string,
    action: ModerationAction
  ): Promise<{ reportId: string; status: ReportStatus }> {
    // TODO(admin): assert reviewerId is an authorized reviewer once a role/is_admin
    // flag exists. reviewerId is referenced here so the audit intent is explicit.
    void reviewerId;

    if (action !== 'reviewed' && action !== 'actioned') {
      throw new Error('Invalid moderation action');
    }

    const supabaseAdmin = createAdminSupabase();

    const { data: updated, error } = await supabaseAdmin
      .from('circle_message_reports')
      .update({ status: action })
      .eq('id', reportId)
      .select('id, status')
      .maybeSingle();

    if (error) throw error;
    if (!updated) throw new Error('NotFound');

    return { reportId: updated.id, status: updated.status as ReportStatus };
  }
}
