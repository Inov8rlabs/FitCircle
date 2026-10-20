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
  /** v2 (FITZY_V2_SPEC §3.2) — absent only on the safe empty-input path. */
  conversationId?: string;
  messageId?: string;
  suggestions?: string[];
  actions?: FitzyAction[];
  remaining?: number | null;
  tier?: FitzyTier;
}

// ---------------------------------------------------------------- v2 (docs/FITZY_V2_SPEC.md)

export type FitzyTier = 'free' | 'pro';

export type FitzyActionType = 'log_meal' | 'log_workout' | 'start_plan' | 'share_tip' | 'invite_buddy' | 'open_circle';

export interface FitzyAction {
  type: FitzyActionType;
  label: string; // ≤ 28
  payload?: { text?: string; circleId?: string };
}

export type PaywallTrigger = 'fitzy_quota' | 'weekly_plan' | 'memory' | 'history';

export interface FitzyPaywall {
  trigger: PaywallTrigger;
  headline: string;
  bullets: string[];
  cta: 'Unlock Fitzy Pro';
}

export type CommitmentKind = 'move' | 'eat' | 'hydrate' | 'sleep' | 'circle' | 'mind';

export interface FitzyCommitment {
  id: string;
  kind: CommitmentKind;
  title: string; // ≤ 48
  detail: string; // ≤ 140
  target: { count: number; per: 'week' };
  doneDates: string[];
}

export interface FitzyPlan {
  id: string;
  weekOf: string; // Monday, YYYY-MM-DD
  goal: string;
  note: string;
  commitments: FitzyCommitment[];
  createdAt: string;
}

export interface FitzyPlanPreview {
  goal: string;
  firstCommitment: FitzyCommitment;
  moreCount: number;
}

export interface FitzyDailyFocus {
  date: string;
  headline: string; // ≤ 70
  body: string; // ≤ 240
  cta: { label: string; action: FitzyAction };
  kind: 'tip' | 'recap' | 'plan_nudge' | 'welcome';
  tier: FitzyTier;
}

export type MemoryKind = 'goal' | 'preference' | 'routine' | 'constraint';

export interface FitzyMemoryItem {
  id: string;
  text: string;
  kind: MemoryKind;
  createdAt: string;
}

export interface FitzyStoredMessage {
  id: string;
  role: FitzyRole;
  content: string;
  suggestions: string[];
  actions: FitzyAction[];
  createdAt: string;
}

/** FROZEN service signature — routes/callers depend on this shape. */
export interface IFitzyService {
  chat(userId: string, messages: FitzyMessage[], circleId?: string): Promise<FitzyChatResponse>;
}
