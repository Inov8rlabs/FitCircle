// Circle Chat — push fan-out into the NotificationOrchestrator.
//
// Member messages produce a 'chat_message' push to every active member except
// the sender, skipping members who have muted the circle's chat. @mentions
// upgrade the recipient to a higher-priority 'chat_mention' that pierces the
// mute (but still respects the recipient's own 'social' category toggle, which
// NotificationOrchestrator.send() already checks).
//
// System posts (rallies, streaks, workouts) and meal cards are posted per
// circle, but PUSHED once per recipient per underlying event
// (docs/PUSH_NOTIFICATIONS.md §2): callers hand notifySystemEvent() every
// circle's post for the event, and planEventPushes() — pure — computes the
// recipient set across all those circles, minus the actor(s), minus anyone who
// muted every one of them (rallies respect mute too), and one push each.
//
// Every fan-out is fire-and-forget and failure-isolated: a notification failure
// must never break a message send or a post write.

import { createAdminSupabase } from '../supabase-admin';
import { stripEmoji } from '../text/strip-emoji';

import {
  NotificationOrchestrator,
  type NotificationData,
  type NotificationType,
} from './notification-orchestrator';

const PREVIEW_MAX_LENGTH = 80;
const PHOTO_PREVIEW = 'sent a photo';

export interface ActiveMember {
  userId: string;
  muted: boolean;
}

/**
 * One circle's post for an underlying event, as far as push is concerned.
 * Several intents with the same eventKey (the same event posted to several
 * circles) become ONE push per recipient.
 *  - rally:       P0 celebration → chat_rally
 *  - system:      ordinary system post (workout, quest, join…) → chat_message
 *  - member_post: a member's own content posted as a card (meal) → chat_message
 *                 with the member as Communication Notification sender
 */
export interface SystemPushIntent {
  kind: 'rally' | 'system' | 'member_post';
  /** Identical for every circle the event was posted to; scopes the dedupeKey. */
  eventKey: string;
  circleId: string;
  circleName: string;
  /** The in-app post body. */
  body: string;
  eventType: string;
  /** Members the post is about — never pushed about it. */
  actorUserIds: string[];
  actorName: string;
  /** A real user behind the post (avatar / senderId); null for circle-level events. */
  senderUserId?: string | null;
  messageId?: string | null;
  /** Additional members not to push (e.g. the covered friend, who gets a dedicated push). */
  excludeUserIds?: string[];
}

export interface PlannedPush {
  userId: string;
  type: NotificationType;
  data: NotificationData;
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
      const senderAvatarUrl = await this.avatarUrlOf(senderId);

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
        // friendName feeds the notification templates; senderName is the
        // cross-platform push-data key (the orchestrator puts it on the wire).
        void NotificationOrchestrator.send(member.userId, type, {
          circleName,
          friendName: senderName,
          senderName,
          senderId,
          senderAvatarUrl,
          preview: truncatedPreview,
          deepLink,
          messageId,
          circleId,
          dedupeKey: `msg:${messageId}`,
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
   * Who gets told about a reaction: the message's author, or for a system
   * post (meal card, streak) the member it is about — never the reactor
   * themselves, never a post with no person behind it (daily summary).
   * Pure; unit-tested.
   */
  static reactionRecipient(
    message: { sender_id: string | null; system_payload?: Record<string, unknown> | null },
    reactorId: string
  ): string | null {
    let recipient: string | null = message.sender_id;
    if (!recipient) {
      const actors = (message.system_payload as { actors?: unknown } | null)?.actors;
      const first = Array.isArray(actors) ? actors[0] : undefined;
      const id = first && typeof first === 'object' ? (first as { id?: unknown }).id : undefined;
      recipient = typeof id === 'string' && id.length > 0 ? id : null;
    }
    return recipient && recipient !== reactorId ? recipient : null;
  }

  /**
   * Someone reacted to a message. Tell the author (once per new reaction —
   * the caller only invokes this when a row was actually inserted). Honours
   * the recipient's mute for this circle. Never throws.
   */
  static async notifyReaction(params: {
    circleId: string;
    circleName: string;
    messageId: string;
    recipientId: string;
    reactorId: string;
    reactorName: string;
    emoji: string;
    preview: string;
  }): Promise<void> {
    try {
      const members = await this.getActiveMembers(params.circleId);
      const recipient = members.find((m) => m.userId === params.recipientId);
      if (!recipient || recipient.muted) return;

      await NotificationOrchestrator.send(params.recipientId, 'chat_reaction', {
        circleName: params.circleName,
        friendName: params.reactorName,
        senderName: params.reactorName,
        senderId: params.reactorId,
        senderAvatarUrl: await this.avatarUrlOf(params.reactorId),
        emoji: params.emoji,
        preview: this.truncatePreview(params.preview),
        deepLink: `fitcircle://circles/${params.circleId}/chat`,
        messageId: params.messageId,
        circleId: params.circleId,
        dedupeKey: `react:${params.messageId}:${params.reactorId}:${params.emoji}`,
      });
    } catch (err) {
      console.error(
        `[ChatNotificationService.notifyReaction] Failed for message ${params.messageId}:`,
        err
      );
    }
  }

  /**
   * Single-circle convenience wrapper: an ordinary (non-rally) system post.
   * Skips the actor and muted members. Never throws.
   */
  static async notifySystemPost(
    circleId: string,
    circleName: string,
    body: string,
    actorUserId: string | null,
    actorName: string,
    eventKey: string = `system:${circleId}:${actorUserId ?? 'circle'}:${body}`
  ): Promise<void> {
    await this.notifySystemEvent([
      {
        kind: 'system',
        eventKey,
        circleId,
        circleName,
        body,
        eventType: 'system',
        actorUserIds: actorUserId ? [actorUserId] : [],
        actorName,
        senderUserId: actorUserId,
      },
    ]);
  }

  /**
   * Single-circle convenience wrapper: a P0 "rally" post. Never pushes the
   * actor; respects mute. Never throws.
   */
  static async notifyRallyPost(
    circleId: string,
    circleName: string,
    body: string,
    eventType: string,
    actorUserIds: string[] = [],
    eventKey: string = `rally:${circleId}:${eventType}:${body}`
  ): Promise<void> {
    await this.notifySystemEvent([
      { kind: 'rally', eventKey, circleId, circleName, body, eventType, actorUserIds, actorName: '' },
    ]);
  }

  /**
   * Push a system event that was posted to one or more circles: ONE push per
   * recipient per eventKey (see planEventPushes). Returns what was planned
   * (for tests / logs). Never throws.
   */
  static async notifySystemEvent(intents: SystemPushIntent[]): Promise<PlannedPush[]> {
    try {
      if (intents.length === 0) return [];
      const circleIds = [...new Set(intents.map((i) => i.circleId))];
      const membersByCircle = new Map<string, ActiveMember[]>();
      await Promise.all(
        circleIds.map(async (circleId) => {
          try {
            membersByCircle.set(circleId, await this.getActiveMembers(circleId));
          } catch (err) {
            console.error(`[ChatNotificationService.notifySystemEvent] members of ${circleId}:`, err);
            membersByCircle.set(circleId, []);
          }
        })
      );
      const senderIds = [...new Set(intents.map((i) => i.senderUserId).filter((id): id is string => !!id))];
      const avatars = new Map<string, string | null>();
      await Promise.all(senderIds.map(async (id) => avatars.set(id, await this.avatarUrlOf(id))));

      const planned = this.planEventPushes(intents, membersByCircle, avatars);
      for (const push of planned) {
        // Fire-and-forget per member; a single failure never affects others.
        void NotificationOrchestrator.send(push.userId, push.type, push.data).catch((err) => {
          console.error(
            `[ChatNotificationService.notifySystemEvent] Failed for member ${push.userId}:`,
            err
          );
        });
      }
      return planned;
    } catch (err) {
      console.error('[ChatNotificationService.notifySystemEvent] Failed:', err);
      return [];
    }
  }

  /**
   * PURE fan-out planner. For each eventKey:
   *   recipients = ∪ active members of the event's circles
   *                − the actor(s) − excludeUserIds
   *                − members who muted EVERY one of those circles they are in;
   * one push each, about the first circle (in the caller's order) the
   * recipient shares unmuted with the event, naming how many others.
   */
  static planEventPushes(
    intents: SystemPushIntent[],
    membersByCircle: Map<string, ActiveMember[]>,
    avatars: Map<string, string | null> = new Map()
  ): PlannedPush[] {
    const groups = new Map<string, SystemPushIntent[]>();
    for (const intent of intents) {
      const list = groups.get(intent.eventKey) ?? [];
      // Same circle twice for one event (a retried post) still counts once.
      if (!list.some((i) => i.circleId === intent.circleId)) list.push(intent);
      groups.set(intent.eventKey, list);
    }

    const out: PlannedPush[] = [];
    for (const [eventKey, group] of groups) {
      const excluded = new Set(group.flatMap((i) => [...i.actorUserIds, ...(i.excludeUserIds ?? [])]));
      // recipient -> the event's circles they hear about (unmuted), in order.
      const audience = new Map<string, SystemPushIntent[]>();
      for (const intent of group) {
        for (const member of membersByCircle.get(intent.circleId) ?? []) {
          if (excluded.has(member.userId) || member.muted) continue;
          audience.set(member.userId, [...(audience.get(member.userId) ?? []), intent]);
        }
      }

      for (const [userId, circles] of audience) {
        const primary = circles[0];
        const others = circles.length - 1;
        const deepLink = `fitcircle://circles/${primary.circleId}/chat`;
        const common: NotificationData = {
          circleName: primary.circleName,
          circleId: primary.circleId,
          deepLink,
          dedupeKey: `evt:${eventKey}`,
          ...(others > 0 ? { otherCircleCount: others } : {}),
        };
        if (primary.kind === 'rally') {
          out.push({
            userId,
            type: 'chat_rally',
            data: {
              ...common,
              body: primary.body,
              eventType: primary.eventType,
              ...(others > 0 ? { headline: this.rallyHeadline(primary.body) } : {}),
            },
          });
          continue;
        }
        const sender = primary.senderUserId ?? null;
        out.push({
          userId,
          type: 'chat_message',
          data: {
            ...common,
            friendName: primary.actorName,
            senderName: primary.actorName,
            ...(sender ? { senderId: sender, senderAvatarUrl: avatars.get(sender) ?? null } : {}),
            preview: this.truncatePreview(primary.body),
            ...(primary.messageId ? { messageId: primary.messageId } : {}),
          },
        });
      }
    }
    return out;
  }

  /** "Ani's on a 7-day streak — nice" → "Ani's on a 7-day streak" (title use). */
  static rallyHeadline(body: string): string {
    return stripEmoji((body ?? '').replace(/\s+—\s+nice\b/, '').trim());
  }

  /** Active members of a circle with their per-circle mute state (public for DailySummaryService). */
  static async activeMembersOf(circleId: string): Promise<ActiveMember[]> {
    return this.getActiveMembers(circleId);
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
   * The sender's public avatar URL for the iOS Communication Notification, or
   * null. One lookup per message (not per recipient); never throws.
   */
  private static async avatarUrlOf(userId: string): Promise<string | null> {
    try {
      const { data } = await createAdminSupabase()
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle();
      const url = (data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
      return typeof url === 'string' && url.startsWith('https://') ? url : null;
    } catch {
      return null;
    }
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
