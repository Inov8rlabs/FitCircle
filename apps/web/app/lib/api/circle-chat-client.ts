import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Circle Chat client — typed wrappers over the frozen mobile chat routes.
// Mirrors the camelCase DTO contract in app/lib/types/circle-chat.ts.
// Realtime is handled separately in CircleChat.tsx via the supabase browser
// client; this module covers the REST reads/writes.
// ---------------------------------------------------------------------------

export type MessageKind = 'user_text' | 'user_photo' | 'system_event';

export type RenderHint = 'text' | 'stat_card' | 'completion_card' | 'summary_card';

export type ReactionKind = 'flame' | 'clap' | 'eyes' | 'same' | 'heart' | 'laugh';

export const REACTION_KINDS: ReactionKind[] = [
  'flame',
  'clap',
  'eyes',
  'same',
  'heart',
  'laugh',
];

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
  error: { code: string; message: string } | null;
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
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
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

  addReaction: (messageId: string, reaction: ReactionKind) =>
    authedFetch<{ reactions: MessageReactionSummary[] }>(
      `/api/mobile/messages/${messageId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ reaction }),
      }
    ),

  removeReaction: (messageId: string, reaction: ReactionKind) =>
    authedFetch<{ reactions: MessageReactionSummary[] }>(
      `/api/mobile/messages/${messageId}/reactions/${reaction}`,
      { method: 'DELETE' }
    ),

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
