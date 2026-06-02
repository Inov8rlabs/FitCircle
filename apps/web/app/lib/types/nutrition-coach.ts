/**
 * AI Nutrition Coach types (PRD v4 §6.9).
 *
 * A circle-aware coaching layer over the LLM (Vercel AI Gateway). For v1 it is a stateless
 * Q&A: no conversation history is persisted, so there is no migration. The coach can answer
 * general educational nutrition questions, give gentle contextual nudges grounded in the
 * user's OWN logged data + the circle's active challenge, and summarize the circle's week.
 *
 * Hard guardrails (§6.9 + §6.7) — body-neutral and food-neutral throughout. See
 * NutritionCoachService for how these are enforced (system prompt + output check).
 */

/** Inbound request: a free-text question, optionally scoped to a circle for context. */
export interface CoachRequest {
  /** The user's question. Non-empty, max ~500 chars (validated at the route). */
  question: string;
  /** Optional circle to ground the answer in (active challenge, encouraging week summary). */
  circleId?: string;
}

/** Outbound response: the coach's answer plus a standing educational/medical disclaimer. */
export interface CoachResponse {
  /** The coach's answer. Always passes the body-/food-neutral output guard. */
  answer: string;
  /** Standing notice that this is educational, not medical/clinical advice (§6.9). */
  disclaimer: string;
}

/**
 * FROZEN NutritionCoachService signature. Routes and any future callers depend on this exact
 * shape — do not change without a coordinated migration.
 */
export interface INutritionCoachService {
  /**
   * Answer a nutrition question for a user, optionally grounded in one of their circles.
   * Always returns a guardrail-safe CoachResponse (never throws on unsafe model output —
   * unsafe output is replaced with a safe fallback).
   */
  ask(userId: string, question: string, circleId?: string): Promise<CoachResponse>;
}
