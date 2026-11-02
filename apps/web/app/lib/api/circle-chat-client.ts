import type { ChatInbox, InboxChat, InboxLastMessage } from '@/lib/services/chat-inbox-service';
import type { ChatReactionValue, CheerSource, MessageCheer, MessageReactor } from '@/lib/types/circle-chat';
import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Circle Chat client — typed wrappers over the frozen mobile chat routes.
// Mirrors the camelCase DTO contract in app/lib/types/circle-chat.ts.
// Realtime is handled separately in CircleChat.tsx via the supabase browser
// client; this module covers the REST reads/writes.
// ---------------------------------------------------------------------------

export type MessageKind = 'user_text' | 'user_photo' | 'system_event';

export type RenderHint = 'text' | 'stat_card' | 'completion_card' | 'summary_card' | 'meal_card';

// Chat Reactions v2 (docs/CHAT_REACTIONS_V2.md): a named kind or a single emoji.
export {
  CHAT_REACTION_BAR,
  REACTION_EMOJI,
  type ChatReactionKind as ReactionKind,
  type ChatReactionValue,
} from '@/lib/types/circle-chat';
export type { MessageReactor, MessageCheer, CheerSource, ChatInbox, InboxChat, InboxLastMessage };

export interface MessageSender {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MessageReactionSummary {
  /** Named kind or the custom emoji itself. */
  reaction: ChatReactionValue;
  /** Always present: what to draw. */
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface MessageSystemBlock {
  eventType: string;
  refId: string | null;
  renderHint: RenderHint;
  actors: Array<{ id: string; name: string }>;
  payload: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  circleId: string;
  kind: MessageKind;
  sender: MessageSender | null;
  body: string | null;
  photoUrl: string | null;
  system: MessageSystemBlock | null;
  reactions: MessageReactionSummary[];
  clientId: string | null;
  createdAt: string;
  editedAt: string | null; // ISO — set when the sender edited the message
  deletedAt: string | null; // ISO — set = tombstone (body/photoUrl always null)
  /** Leaderboard cheer (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §3); null/absent otherwise. */
  cheer?: MessageCheer | null;
}

export interface SendCheerInput {
  to_user_id: string;
  reaction?: ChatReactionValue;
  message?: string;
  source: CheerSource;
  client_id?: string;
}

/** A failed chat API call; `code` / `details` come from the envelope when present. */
export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

export interface ListMessagesResult {
  messages: ChatMessage[]; // reverse-chronological (newest first)
  hasMore: boolean;
  nextBefore: string | null;
}

export interface SendMessageInput {
  kind: 'user_text' | 'user_photo';
  body?: string | null;
  photoUrl?: string | null;
  clientId?: string | null;
}

// Standard mobile-API envelope: { success, data, error, meta }
interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
  meta: unknown;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Same opt-in the v2 mobile clients send (custom-emoji reactions).
      'X-Client-Features': 'reactions_v2',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? `Request failed (${res.status})`;
    throw new ChatApiError(
      typeof msg === 'string' ? msg : 'Request failed',
      res.status,
      json?.error?.code ?? null,
      json?.error?.details ?? {}
    );
  }
  return json.data as T;
}

export const chatClient = {
  listMessages: (circleId: string, opts?: { before?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.before) qs.set('before', opts.before);
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authedFetch<ListMessagesResult>(
      `/api/mobile/circles/${circleId}/messages${suffix}`
    );
  },

  sendMessage: (circleId: string, input: SendMessageInput) =>
    authedFetch<ChatMessage>(`/api/mobile/circles/${circleId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  editMessage: (messageId: string, body: string) =>
    authedFetch<{ message: ChatMessage }>(`/api/mobile/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),

  deleteMessage: (messageId: string) =>
    authedFetch<{ message: ChatMessage }>(`/api/mobile/messages/${messageId}`, {
      method: 'DELETE',
    }),

  /** PUT — set the viewer's one reaction (replaces any previous). */
  setReaction: (messageId: string, reaction: ChatReactionValue) =>
    authedFetch<{ reactions: MessageReactionSummary[] }>(
      `/api/mobile/messages/${messageId}/reactions`,
      {
        method: 'PUT',
        body: JSON.stringify({ reaction }),
      }
    ),

  /** DELETE (no suffix) — clear the viewer's reaction. */
  clearReaction: (messageId: string) =>
    authedFetch<{ reactions: MessageReactionSummary[] }>(
      `/api/mobile/messages/${messageId}/reactions`,
      { method: 'DELETE' }
    ),

  /** GET — who reacted with what (viewer first, then newest). */
  listReactors: (messageId: string) =>
    authedFetch<{ reactors: MessageReactor[] }>(`/api/mobile/messages/${messageId}/reactions`),

  /** GET /api/mobile/chats — every circle chat with unread counts + the top-nav target. */
  listChats: () => authedFetch<ChatInbox>('/api/mobile/chats'),

  /** POST — cheer a member from the leaderboard; returns the cheer message. */
  sendCheer: (circleId: string, input: SendCheerInput) =>
    authedFetch<{ message: ChatMessage }>(`/api/mobile/circles/${circleId}/cheers`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  markRead: (circleId: string) =>
    authedFetch<{ lastReadAt: string }>(`/api/mobile/circles/${circleId}/read`, {
      method: 'POST',
    }),

  setMute: (circleId: string, muted: boolean) =>
    authedFetch<{ muted: boolean }>(`/api/mobile/circles/${circleId}/mute`, {
      method: 'POST',
      body: JSON.stringify({ muted }),
    }),

  reportMessage: (messageId: string, reason: string | null) =>
    authedFetch<{ reportId: string; status: string }>(
      `/api/mobile/messages/${messageId}/report`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),
};
