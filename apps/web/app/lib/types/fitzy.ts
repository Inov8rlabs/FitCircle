/**
 * Fitzy — the FitCircle AI coach (an evolution of the §6.9 Nutrition Coach into a full
 * fitness + nutrition assistant). Multi-turn chat, grounded in the user's own data
 * (food log, workouts, weight trend, streaks, circles). Replies are Markdown.
 *
 * History is now persisted SERVER-SIDE (migration 066: fitzy_conversations + fitzy_messages) for
 * cross-device sync and a clean dataset (full turns + model/token usage) for analysis and future
 * SLM training. The chat endpoint stays backward-compatible: clients may still send recent turns;
 * each exchange is also persisted. Safety guardrails (no medical/clinical advice, no disordered-
 * eating triggers, body-/food-neutral) are enforced server-side regardless of what's sent.
 */

export type FitzyRole = 'user' | 'assistant';

/** One turn in the conversation. `content` is plain text (assistant turns may contain Markdown). */
export interface FitzyMessage {
  role: FitzyRole;
  content: string;
}

/** Inbound: the recent conversation (oldest→newest), optionally scoped to a circle for context. */
export interface FitzyChatRequest {
  messages: FitzyMessage[];
  /** Optional circle to ground encouragement in (active challenge, etc.). */
  circleId?: string;
  /** Target conversation; when omitted the user's active conversation is used (get-or-create). */
  conversationId?: string;
}

/** Outbound: the assistant's Markdown reply + a standing educational/medical disclaimer. */
export interface FitzyChatResponse {
  answer: string;
  disclaimer: string;
  /** The conversation this exchange was persisted to (clients store it for follow-ups + history). */
  conversationId?: string;
}

/** A persisted message (from the server store), for cross-device history/scrollback. */
export interface FitzyStoredMessage {
  id: string;
  role: FitzyRole;
  content: string;
  createdAt: string;
}

/** GET history response: a page of messages (oldest→newest), with cursor pagination into the past. */
export interface FitzyHistoryResponse {
  conversationId: string;
  messages: FitzyStoredMessage[];
  hasMore: boolean;
  nextBefore: string | null; // pass back as `before` to page further into the past
}

/** A turn to persist (assistant turns carry model + token usage for analysis/training). */
export interface FitzyTurnToPersist {
  role: FitzyRole;
  content: string;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** FROZEN service signature — routes/callers depend on this shape. */
export interface IFitzyService {
  chat(
    userId: string,
    messages: FitzyMessage[],
    circleId?: string,
    conversationId?: string
  ): Promise<FitzyChatResponse>;
}
