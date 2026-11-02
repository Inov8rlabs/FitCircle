// Leaderboard cheers — POST /api/mobile/circles/:id/cheers
// (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §3).
//
// A cheer is a circle chat message from the sender: an ordinary `user_text`
// row (so every shipped client shows its body as a text bubble) whose
// system_payload carries the structured { cheer } new clients render as a
// cheer bubble. The recipient's stat snapshot is computed here from the steps
// leaderboard, never taken from the client. Rate limits count the sender's
// existing cheer rows (durable across serverless instances; no limiter store).

import { canonicalizeChatReaction, reactionEmoji } from '../chat/reactions';
import { createAdminSupabase } from '../supabase-admin';
import {
  CHEER_DAILY_LIMIT,
  CHEER_MESSAGE_MAX_LENGTH,
  CHEER_PAIR_COOLDOWN_MS,
  type ChatMessageDTO,
  type ChatReactionValue,
  type CheerSource,
  type CheerStatSnapshot,
  type CircleMessageRow,
  type MessageCheer,
} from '../types/circle-chat';

import { ChatNotificationService } from './chat-notification-service';
import { ChatSafetyService } from './chat-safety-service';
import { CircleChatService } from './circle-chat-service';
import { CircleStepsLeaderboardService } from './circle-steps-leaderboard-service';
import { logIgnoredQueryError } from '@/lib/api/route-errors';

const MESSAGE_COLUMNS =
  'id, fitcircle_id, sender_id, kind, body, photo_url, client_id, system_event_type, system_event_ref, system_payload, priority, edited_at, deleted_at, created_at, updated_at';

const DAY_MS = 86_400_000;

export interface SendCheerInput {
  toUserId: string;
  reaction?: string | null;
  message?: string | null;
  source?: CheerSource | null;
  clientId?: string | null;
  /** X-Client-Timezone of the sender (only used to resolve the board's period). */
  clientTimezone?: string | null;
}

/** Thrown for every expected refusal; the route maps `code` to a status. */
export class CheerError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_ERROR'
      | 'CANNOT_CHEER_SELF'
      | 'FORBIDDEN'
      | 'BLOCKED'
      | 'RECIPIENT_NOT_FOUND'
      | 'RATE_LIMITED',
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'CheerError';
  }
}

export type CheerLimitVerdict =
  | { ok: true }
  | { ok: false; reason: 'pair_cooldown' | 'daily_limit'; retryAfterSeconds: number };

/**
 * Rate-limit decision from the sender's cheers in this circle over the last
 * 24 h (newest first or any order). Pure.
 */
export function cheerLimitVerdict(
  recent: ReadonlyArray<{ to_user_id: string | null; created_at: string }>,
  toUserId: string,
  now: number
): CheerLimitVerdict {
  const inDay = recent.filter((r) => now - Date.parse(r.created_at) < DAY_MS);
  const lastToPair = inDay
    .filter((r) => r.to_user_id === toUserId)
    .map((r) => Date.parse(r.created_at))
    .sort((a, b) => b - a)[0];
  if (lastToPair !== undefined && now - lastToPair < CHEER_PAIR_COOLDOWN_MS) {
    return { ok: false, reason: 'pair_cooldown', retryAfterSeconds: Math.ceil((CHEER_PAIR_COOLDOWN_MS - (now - lastToPair)) / 1000) };
  }
  if (inDay.length >= CHEER_DAILY_LIMIT) {
    const oldest = Math.min(...inDay.map((r) => Date.parse(r.created_at)));
    return { ok: false, reason: 'daily_limit', retryAfterSeconds: Math.max(1, Math.ceil((oldest + DAY_MS - now) / 1000)) };
  }
  return { ok: true };
}

/** "👏 @Raveesh Keep going!" — the plain-text body shipped clients show. Pure. */
export function cheerBody(emoji: string, toName: string, message: string | null): string {
  const name = toName.trim() || 'friend';
  return `${emoji} @${name}${message ? ` ${message}` : ''}`;
}

/** The recipient's row of the steps board → snapshot, or null (hidden / no steps). Pure. */
export function snapshotFromRow(
  row: { steps_visible: boolean; today_steps: number | null; daily_goal_steps: number; goal_pct_today: number | null; days: Array<{ date: string }> } | undefined,
  fallbackDate: string
): CheerStatSnapshot | null {
  if (!row || !row.steps_visible || row.today_steps === null) return null;
  return {
    metric: 'steps',
    date: row.days.at(-1)?.date ?? fallbackDate,
    today_steps: row.today_steps,
    daily_goal_steps: row.daily_goal_steps,
    goal_pct_today: row.goal_pct_today,
  };
}

export class CircleCheerService {
  static async sendCheer(circleId: string, senderId: string, input: SendCheerInput): Promise<ChatMessageDTO> {
    const toUserId = (input.toUserId ?? '').trim();
    if (!toUserId) throw new CheerError('VALIDATION_ERROR', 'to_user_id is required', { to_user_id: 'Required' });
    if (toUserId.toLowerCase() === senderId.toLowerCase()) {
      throw new CheerError('CANNOT_CHEER_SELF', "You can't cheer yourself");
    }

    const reaction: ChatReactionValue | null =
      input.reaction === undefined || input.reaction === null || input.reaction === ''
        ? 'clap'
        : canonicalizeChatReaction(input.reaction);
    if (!reaction) {
      throw new CheerError('VALIDATION_ERROR', 'Reaction must be a named kind or a single emoji', {
        reaction: 'Invalid reaction',
      });
    }
    const message = (input.message ?? '').trim() || null;
    if (message && message.length > CHEER_MESSAGE_MAX_LENGTH) {
      throw new CheerError('VALIDATION_ERROR', `Message exceeds ${CHEER_MESSAGE_MAX_LENGTH} characters`, {
        message: `Max ${CHEER_MESSAGE_MAX_LENGTH} characters`,
      });
    }
    const source: CheerSource = input.source === 'member_sheet' ? 'member_sheet' : 'leaderboard_long_press';

    const db = createAdminSupabase();

    // Both must be active members.
    const { data: memberRows, error: memberError } = await db
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('status', 'active')
      .in('user_id', [senderId, toUserId]);
    if (memberError) throw memberError;
    const memberIds = new Set(((memberRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    if (!memberIds.has(senderId)) throw new CheerError('FORBIDDEN', 'You are not a member of this circle');
    if (!memberIds.has(toUserId)) throw new CheerError('RECIPIENT_NOT_FOUND', 'That member is not in this circle');

    // Retry-safe: the same (sender, client_id) returns the cheer already sent.
    const clientId = input.clientId ?? null;
    if (clientId) {
      const { data: existing, error } = await db
        .from('circle_messages')
        .select(MESSAGE_COLUMNS)
        .eq('sender_id', senderId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      if (existing) return CircleChatService.toDTO(existing as CircleMessageRow, senderId);
    }

    if ((await ChatSafetyService.getBlockedIdsFor(senderId)).includes(toUserId)) {
      throw new CheerError('BLOCKED', "You can't cheer this member.");
    }

    const now = Date.now();
    const recipientName = await this.displayNameOf(toUserId);
    const verdict = cheerLimitVerdict(await this.recentCheers(circleId, senderId, now), toUserId, now);
    if (!verdict.ok) {
      throw new CheerError(
        'RATE_LIMITED',
        verdict.reason === 'pair_cooldown'
          ? `You just cheered ${recipientName || 'them'} — give it a minute`
          : "That's a lot of cheering for today — try again tomorrow",
        { reason: verdict.reason, retry_after_seconds: verdict.retryAfterSeconds }
      );
    }

    const snapshot = await this.statSnapshot(circleId, senderId, toUserId, input.clientTimezone ?? null);
    const emoji = reactionEmoji(reaction);
    const cheer: MessageCheer = {
      to_user_id: toUserId,
      to_display_name: recipientName,
      reaction,
      emoji,
      message,
      source,
      stat_snapshot: snapshot,
    };

    const { data: inserted, error: insertError } = await db
      .from('circle_messages')
      .insert({
        fitcircle_id: circleId,
        sender_id: senderId,
        kind: 'user_text',
        body: cheerBody(emoji, recipientName, message),
        photo_url: null,
        client_id: clientId,
        priority: 'p1',
        system_payload: { cheer },
      })
      .select(MESSAGE_COLUMNS)
      .single();
    if (insertError) throw insertError;

    const dto = await CircleChatService.toDTO(inserted as CircleMessageRow, senderId);

    // Pushes are fire-and-forget: the recipient gets the always-alerting cheer
    // push; everyone else the ordinary (burst-quiet) chat push.
    const senderName = dto.sender?.name || 'Someone';
    void CircleChatService.circleNameOf(circleId)
      .then((circleName) =>
        Promise.all([
          ChatNotificationService.notifyCheer({
            circleId,
            circleName,
            messageId: dto.id,
            senderId,
            senderName,
            recipientId: toUserId,
            emoji,
            message,
          }),
          ChatNotificationService.notifyNewMessage(circleId, senderId, senderName, circleName, dto.id, dto.body ?? '', {
            excludeUserIds: [toUserId],
          }),
        ])
      )
      .catch(() => {});

    return dto;
  }

  /** The sender's cheers in this circle over the last 24 h (for the rate limits). */
  static async recentCheers(
    circleId: string,
    senderId: string,
    now: number
  ): Promise<Array<{ to_user_id: string | null; created_at: string }>> {
    const { data, error } = await createAdminSupabase()
      .from('circle_messages')
      .select('created_at, system_payload')
      .eq('fitcircle_id', circleId)
      .eq('sender_id', senderId)
      .eq('kind', 'user_text')
      .not('system_payload->cheer', 'is', null)
      .gte('created_at', new Date(now - DAY_MS).toISOString())
      .limit(CHEER_DAILY_LIMIT * 5);
    if (error) throw error;
    return ((data ?? []) as Array<{ created_at: string; system_payload: Record<string, any> | null }>)
      .filter((r) => r.system_payload?.cheer)
      .map((r) => ({
        to_user_id: typeof r.system_payload?.cheer?.to_user_id === 'string' ? r.system_payload.cheer.to_user_id : null,
        created_at: r.created_at,
      }));
  }

  /**
   * The recipient's steps today from the circle's steps board (their own local
   * day). Best-effort: any failure → null (the cheer still goes out).
   */
  static async statSnapshot(
    circleId: string,
    viewerId: string,
    recipientId: string,
    clientTimezone: string | null
  ): Promise<CheerStatSnapshot | null> {
    try {
      const result = await CircleStepsLeaderboardService.build(circleId, viewerId, clientTimezone);
      if (!result.ok) return null;
      const row = result.board.members.find((m) => m.user_id.toLowerCase() === recipientId.toLowerCase());
      return snapshotFromRow(row, result.board.today);
    } catch (err: any) {
      console.warn('[CircleCheerService.statSnapshot] skipped:', err?.message ?? err);
      return null;
    }
  }

  private static async displayNameOf(userId: string): Promise<string> {
    const { data, error: dataError } = await createAdminSupabase().from('profiles').select('display_name').eq('id', userId).maybeSingle();
    logIgnoredQueryError('CircleCheerService.displayNameOf', dataError);
    return ((data?.display_name as string | null) ?? '').trim();
  }
}
