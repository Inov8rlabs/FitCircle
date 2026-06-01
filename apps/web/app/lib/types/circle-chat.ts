// Circle Chat — shared type contract (FROZEN).
// Build Spec v1.2 §6.1. Mirrors migration 052_circle_chat.sql exactly.
//
// This file is the single source of truth for the chat feature's shapes and the
// CircleChatService API surface. The service and all route handlers build against
// it; nothing here changes without updating the service + every route together.

// ============================================================================
// Enums / literal unions (must match 052 CHECK constraints)
// ============================================================================

export type MessageKind = 'user_text' | 'user_photo' | 'system_event';

export type SystemEventType =
  | 'workout_done'
  | 'notable_meal'
  | 'streak_milestone'
  | 'circle_streak'
  | 'quest_done'
  | 'challenge_milestone'
  | 'challenge_resolved'
  | 'daily_summary'
  | 'member_joined'
  | 'new_challenge';

export type MessagePriority = 'p0' | 'p1' | 'p2';

export type ReactionKind = 'flame' | 'clap' | 'eyes' | 'same' | 'heart' | 'laugh';
export const REACTION_KINDS: ReactionKind[] = ['flame', 'clap', 'eyes', 'same', 'heart', 'laugh'];

export type RenderHint = 'text' | 'stat_card' | 'completion_card' | 'summary_card';

export type ReportStatus = 'open' | 'reviewed' | 'actioned';

// ============================================================================
// DB row shapes (snake_case — as stored)
// ============================================================================

export interface CircleMessageRow {
  id: string;
  fitcircle_id: string;
  sender_id: string | null;
  kind: MessageKind;
  body: string | null;
  photo_url: string | null;
  client_id: string | null;
  system_event_type: SystemEventType | null;
  system_event_ref: string | null;
  system_payload: Record<string, unknown> | null;
  priority: MessagePriority;
  created_at: string;
  updated_at: string;
}

export interface CircleMessageReactionRow {
  message_id: string;
  user_id: string;
  reaction: ReactionKind;
  created_at: string;
}

export interface CircleChatStateRow {
  fitcircle_id: string;
  user_id: string;
  last_read_at: string | null;
  muted: boolean;
  updated_at: string;
}

export interface CircleMessageReportRow {
  id: string;
  message_id: string;
  reporter_id: string;
  reason: string | null;
  status: ReportStatus;
  created_at: string;
}

// ============================================================================
// API DTO (camelCase — what the client contract returns; Build Spec §6.1)
// The service maps rows -> this shape. Clients render this; never re-derive.
// ============================================================================

export interface MessageSender {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MessageReactionSummary {
  reaction: ReactionKind;
  count: number;
  reactedByMe: boolean;
}

export interface MessageSystemBlock {
  eventType: SystemEventType;
  refId: string | null;
  renderHint: RenderHint;
  actors: Array<{ id: string; name: string }>;
  payload: Record<string, unknown>;
}

export interface ChatMessageDTO {
  id: string;
  circleId: string;
  kind: MessageKind;
  sender: MessageSender | null; // null for system posts
  body: string | null;
  photoUrl: string | null;
  system: MessageSystemBlock | null; // present iff kind === 'system_event'
  reactions: MessageReactionSummary[];
  clientId: string | null;
  createdAt: string;
}

// ============================================================================
// Service input shapes
// ============================================================================

export interface ListMessagesParams {
  before?: string; // ISO timestamp; return messages created strictly before this
  limit?: number; // default 30, max 100
}

export interface ListMessagesResult {
  messages: ChatMessageDTO[]; // reverse-chronological (newest first)
  hasMore: boolean;
  nextBefore: string | null; // pass back as `before` for the next page
}

export interface SendMessageInput {
  kind: 'user_text' | 'user_photo'; // members can only send these two
  body?: string | null;
  photoUrl?: string | null;
  clientId?: string | null; // for optimistic de-dupe
}

export const MESSAGE_PAGE_DEFAULT_LIMIT = 30;
export const MESSAGE_PAGE_MAX_LIMIT = 100;
export const MESSAGE_BODY_MAX_LENGTH = 4000;

// ============================================================================
// CircleChatService API surface (FROZEN signatures)
// ----------------------------------------------------------------------------
// The service is implemented as a class of static methods (matching CircleService),
// using createAdminSupabase() (service_role; RLS is enforced separately as defense
// in depth, but the service authorizes explicitly via assertActiveMember()).
//
// REQUIRED methods (exact signatures — service impl + route handlers must agree):
//
//   class CircleChatService {
//     // Authorization helper — throws Error('Forbidden') if user is not an
//     // active member (fitcircle_members.status === 'active') of the circle.
//     static async assertActiveMember(circleId: string, userId: string): Promise<void>
//
//     // Resolve the circle a message belongs to (throws Error('NotFound') if missing).
//     static async getMessageCircleId(messageId: string): Promise<string>
//
//     // GET /circles/:id/messages
//     static async listMessages(circleId: string, userId: string, params: ListMessagesParams): Promise<ListMessagesResult>
//
//     // POST /circles/:id/messages  (member message; validates kind/body/photo + client_id dedupe)
//     static async sendMessage(circleId: string, userId: string, input: SendMessageInput): Promise<ChatMessageDTO>
//
//     // POST /messages/:id/reactions   { reaction }
//     static async addReaction(messageId: string, userId: string, reaction: ReactionKind): Promise<MessageReactionSummary[]>
//
//     // DELETE /messages/:id/reactions/:reaction
//     static async removeReaction(messageId: string, userId: string, reaction: ReactionKind): Promise<MessageReactionSummary[]>
//
//     // POST /circles/:id/read   (marks read up to now; upserts circle_chat_state)
//     static async markRead(circleId: string, userId: string): Promise<{ lastReadAt: string }>
//
//     // POST /circles/:id/mute   { muted }   (toggle/set per-circle chat mute)
//     static async setMute(circleId: string, userId: string, muted: boolean): Promise<{ muted: boolean }>
//
//     // POST /messages/:id/report   { reason }
//     static async reportMessage(messageId: string, userId: string, reason: string | null): Promise<{ reportId: string; status: ReportStatus }>
//
//     // Used by the system-post engine (later task) — NOT exposed via a member route.
//     // Writes a kind='system_event' row. Signature reserved here so routes never call it.
//     // static async emitSystemPost(...): Promise<ChatMessageDTO>
//   }
//
// Error contract (service throws plain Error with these messages; routes map them):
//   'Unauthorized' -> 401   (from requireMobileAuth)
//   'Forbidden'    -> 403   (not an active member)
//   'NotFound'     -> 404   (message/circle missing)
//   ZodError       -> 400   (route-level input validation)
//   else           -> 500
// ============================================================================
