/**
 * Fitzy — the FitCircle AI coach (an evolution of the §6.9 Nutrition Coach into a full
 * fitness + nutrition assistant). Multi-turn chat, grounded in the user's own data
 * (food log, workouts, weight trend, streaks, circles). Replies are Markdown.
 *
 * History is held CLIENT-SIDE for v1: the client persists the thread and sends the recent
 * turns on each request, so the backend stays stateless (no migration). Safety guardrails
 * (no medical/clinical advice, no disordered-eating triggers, body-/food-neutral) are
 * enforced server-side regardless of what the client sends — see FitzyService.
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
}

/** Outbound: the assistant's Markdown reply + a standing educational/medical disclaimer. */
export interface FitzyChatResponse {
  answer: string;
  disclaimer: string;
}

/** FROZEN service signature — routes/callers depend on this shape. */
export interface IFitzyService {
  chat(userId: string, messages: FitzyMessage[], circleId?: string): Promise<FitzyChatResponse>;
}
