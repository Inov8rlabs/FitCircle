// Circle Chat — push fan-out into the NotificationOrchestrator.
//
// Member messages produce a 'chat_message' push to every active member except
// the sender, skipping members who have muted the circle's chat. @mentions
// upgrade the recipient to a higher-priority 'chat_mention' that pierces the
// mute (but still respects the recipient's own 'social' category toggle, which
// NotificationOrchestrator.send() already checks).
//
// P0 system "rally" posts produce a celebratory 'chat_rally' push to all active
// members.
//
// Every fan-out is fire-and-forget and failure-isolated: a notification failure
// must never break a message send or a post write.

import { createAdminSupabase } from '../supabase-admin';

import { NotificationOrchestrator } from './notification-orchestrator';

const PREVIEW_MAX_LENGTH = 80;
const PHOTO_PREVIEW = '📷 sent a photo';

interface ActiveMember {
  userId: string;
  muted: boolean;
}

export class ChatNotificationService {
  /**
   * Notify active circle members (except the sender) of a new member message.
   * Muted members are skipped, except when they are @mentioned — a mention
   * upgrades to 'chat_mention' and pierces the mute. Never throws.
   */
  static async notifyNewMessage(
    circleId: string,
    senderId: string,
    senderName: string,
    circleName: string,
    messageId: string,
    preview: string
  ): Promise<void> {
    try {
      const members = await this.getActiveMembers(circleId);
      const recipients = members.filter((m) => m.userId !== senderId);
      if (recipients.length === 0) return;

      const truncatedPreview = this.truncatePreview(preview);
      const deepLink = `fitcircle://circles/${circleId}/chat`;

      // Resolve display names of recipients so we can match @mentions.
      const mentionedIds = await this.resolveMentionedMemberIds(
        preview,
        recipients.map((r) => r.userId)
      );

      for (const member of recipients) {
        const isMentioned = mentionedIds.has(member.userId);

        // Muted members only hear about mentions (which pierce the mute).
        if (member.muted && !isMentioned) continue;

        const type = isMentioned ? 'chat_mention' : 'chat_message';

        // Fire-and-forget per member; a single failure never affects others.
        void NotificationOrchestrator.send(member.userId, type, {
          circleName,
          friendName: senderName,
          preview: truncatedPreview,
          deepLink,
          messageId,
          circleId,
        }).catch((err) => {
          console.error(
            `[ChatNotificationService.notifyNewMessage] Failed for member ${member.userId}:`,
            err
          );
        });
      }
    } catch (err) {
      console.error(
        `[ChatNotificationService.notifyNewMessage] Failed for circle ${circleId}:`,
        err
      );
    }
  }

  /**
   * Notify all active members of a P0 "rally" system post. Caller must only
   * invoke this for priority='p0' posts. Never throws.
   */
  static async notifyRallyPost(
    circleId: string,
    circleName: string,
    body: string,
    eventType: string
  ): Promise<void> {
    try {
      const members = await this.getActiveMembers(circleId);
      if (members.length === 0) return;

      const deepLink = `fitcircle://circles/${circleId}/chat`;

      for (const member of members) {
        void NotificationOrchestrator.send(member.userId, 'chat_rally', {
          circleName,
          body,
          eventType,
          deepLink,
          circleId,
        }).catch((err) => {
          console.error(
            `[ChatNotificationService.notifyRallyPost] Failed for member ${member.userId}:`,
            err
          );
        });
      }
    } catch (err) {
      console.error(
        `[ChatNotificationService.notifyRallyPost] Failed for circle ${circleId}:`,
        err
      );
    }
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  /**
   * Active members of a circle joined with their per-circle mute state.
   */
  private static async getActiveMembers(circleId: string): Promise<ActiveMember[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data: memberRows, error: membersError } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('status', 'active');

    if (membersError) throw membersError;

    const memberIds = (memberRows ?? [])
      .map((r) => r.user_id as string)
      .filter((id): id is string => !!id);

    if (memberIds.length === 0) return [];

    const { data: stateRows, error: stateError } = await supabaseAdmin
      .from('circle_chat_state')
      .select('user_id, muted')
      .eq('fitcircle_id', circleId)
      .in('user_id', memberIds);

    if (stateError) throw stateError;

    const mutedById = new Map<string, boolean>();
    for (const row of stateRows ?? []) {
      mutedById.set(row.user_id as string, !!row.muted);
    }

    return memberIds.map((userId) => ({
      userId,
      muted: mutedById.get(userId) ?? false,
    }));
  }

  /**
   * Parse simple @name tokens from a message body and match them (case-
   * insensitively) against the display_names of the supplied candidate member
   * ids. Returns the set of matched member ids.
   */
  private static async resolveMentionedMemberIds(
    body: string,
    candidateIds: string[]
  ): Promise<Set<string>> {
    const mentioned = new Set<string>();
    if (!body || candidateIds.length === 0) return mentioned;

    // Extract @-prefixed tokens (letters, digits, underscore, hyphen, dot).
    const tokens = body.match(/@([\w.-]+)/g);
    if (!tokens || tokens.length === 0) return mentioned;

    const mentionTokens = new Set(
      tokens.map((t) => t.slice(1).toLowerCase())
    );

    const supabaseAdmin = createAdminSupabase();
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', candidateIds);

    if (error) throw error;

    for (const p of profiles ?? []) {
      const displayName = (p.display_name as string | null) ?? '';
      if (!displayName) continue;
      // Match against the full name and a no-spaces variant so "@JaneDoe"
      // matches "Jane Doe".
      const normalized = displayName.toLowerCase();
      const compact = normalized.replace(/\s+/g, '');
      if (mentionTokens.has(normalized) || mentionTokens.has(compact)) {
        mentioned.add(p.id as string);
      }
    }

    return mentioned;
  }

  private static truncatePreview(preview: string): string {
    const trimmed = (preview ?? '').trim();
    if (trimmed.length === 0) return PHOTO_PREVIEW;
    if (trimmed.length <= PREVIEW_MAX_LENGTH) return trimmed;
    return `${trimmed.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
  }
}
