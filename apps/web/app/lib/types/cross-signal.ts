// Cross-Signal Insights — shared contract (FROZEN service signature).
// PRD v4 §6.10 (gentle correlational insights across already-tracked signals).
//
// HEALTHY-ENGAGEMENT FRAMING RULES (§6.7) — enforced everywhere copy is produced:
//  1. Correlation is NEVER presented as causation. Headlines/details use associative
//     language ("tend to", "looks like", "on days when") and never imply that changing
//     one signal will change another.
//  2. Tone is curious + gentle, never alarming. No urgency, no "should", no warnings.
//  3. Every insight passes the healthy-engagement gate: nothing readable as a push
//     toward restriction. We only ever phrase nutrition associations POSITIVELY
//     (e.g. "higher energy on higher-protein days"), never "eat less / cut X".
//  4. We surface the *positive direction* of an association; negative correlations are
//     reframed as a positive about the lower-value side (e.g. caffeine), never as a
//     deficiency the user must fix.

// ============================================================================
// Signals we correlate. Nutrition signals are the "input" side; outcome signals
// are the "wellbeing/activity" side. We only ever pair nutrition × outcome.
// ============================================================================
export type NutritionSignal = 'protein' | 'calories';
export type OutcomeSignal = 'mood' | 'energy' | 'caffeine' | 'steps';
export type Signal = NutritionSignal | OutcomeSignal;

export type Confidence = 'low' | 'medium';

// ============================================================================
// API DTO (camelCase) — what GET /api/mobile/insights returns.
// ============================================================================
export interface InsightDTO {
  /** Stable id for the pairing, e.g. "protein__energy". Lets clients dedupe/dismiss. */
  id: string;
  /** Short, gentle, curiosity-framed line. Never causal, never restrictive. */
  headline: string;
  /** One supporting sentence with the same framing rules. */
  detail: string;
  signalA: NutritionSignal;
  signalB: OutcomeSignal;
  /** Pearson r over paired days, range [-1, 1]. Rounded to 2dp. */
  correlation: number;
  /** Number of days where BOTH signals had a value (the n behind the r). */
  sampleDays: number;
  confidence: Confidence;
}

// ============================================================================
// Tuning constants — pure, so the math stays testable & deterministic.
// ============================================================================
/** Minimum paired-day count before a pairing is allowed to surface at all. */
export const MIN_SAMPLE_DAYS = 7;
/** Below this count, even a surfaced insight is only ever 'low' confidence. */
export const MEDIUM_CONFIDENCE_DAYS = 14;
/** |r| must clear this for a pairing to be considered a real (if gentle) signal. */
export const MIN_CORRELATION = 0.3;
/** Default + max lookback windows (days). */
export const DEFAULT_LOOKBACK_DAYS = 30;
export const MAX_LOOKBACK_DAYS = 90;
export const MIN_LOOKBACK_DAYS = 7;
