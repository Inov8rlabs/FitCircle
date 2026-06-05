// Nutrition Intelligence — shared contract (FROZEN).
// PRD v4 §6.1 (photo→nutrition), §7.6 (LLM call patterns), §7.2.1 (single-source-of-truth:
// all nutrition logic server-side; clients are thin renderers that render this, never re-derive).
//
// The photo-parse endpoint returns a DRAFT the user confirms before it commits to a food log
// entry. "Approximate, never exact" (§6.1): quantities may be ranges; confidence is surfaced.

import { z } from 'zod';

// ============================================================================
// How a nutrition value got onto an entry (food_log_entries.input_method / nutrition_source)
// ============================================================================
export type NutritionInputMethod = 'photo' | 'voice' | 'barcode' | 'search' | 'recent' | 'manual' | 'imported';
export type NutritionSource = 'llm_vision' | 'llm_voice' | 'foods_db' | 'user' | 'healthkit' | 'healthconnect' | 'mfp';

// ============================================================================
// The structured shape the LLM must return (Zod = validation + AI SDK output schema).
// Per-item: name, estimated quantity (+ optional range), serving unit, macros, confidence.
// Macros are per the WHOLE item as logged (already scaled to the estimated quantity).
// ============================================================================

// Robustness clamps (applied at the validation boundary).
//
// Macros/quantities are physically non-negative and confidence is a 0..1 probability, but the
// vision model occasionally emits a glitch value (observed in the §8.3 eval: carbsG: -1). A bare
// `z.number().nonnegative()` REJECTS the whole object on one bad field, which surfaced as
// NoObjectGeneratedError -> ParseFailed and discarded an otherwise-usable parse. Instead we
// `preprocess` impossible values into range BEFORE the bound check runs, so a single hallucinated
// field is corrected (−1 g -> 0 g) rather than failing the entire photo. Non-finite / missing
// coerce to the conservative floor (0): a glitchy confidence must never read as HIGH confidence.
const toFiniteNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
// ≥ 0, clamped (calories, macros, quantities).
const nonNegative = z.preprocess((v) => Math.max(0, toFiniteNumber(v)), z.number().nonnegative());
// 0..1, clamped (per-item and overall confidence).
const unitInterval = z.preprocess((v) => Math.min(1, Math.max(0, toFiniteNumber(v))), z.number().min(0).max(1));

export const parsedFoodItemSchema = z.object({
  name: z.string().min(1).describe('Common food name, e.g. "grilled chicken breast"'),
  quantity: nonNegative.describe('Estimated amount in the serving unit (midpoint if a range)'),
  quantityRange: z
    .object({ min: nonNegative, max: nonNegative })
    .nullable()
    .describe('Min/max when the model is uncertain; null when confident. UI defaults to quantity (midpoint).'),
  servingUnit: z.string().min(1).describe('Unit for quantity, e.g. "g", "cup", "piece", "slice"'),
  calories: nonNegative,
  proteinG: nonNegative,
  carbsG: nonNegative,
  fatG: nonNegative,
  confidence: unitInterval.describe('Model confidence for THIS item, 0..1'),
});
export type ParsedFoodItem = z.infer<typeof parsedFoodItemSchema>;

// The full LLM result for one photo: the plate is an array of items + an overall confidence.
export const photoParseResultSchema = z.object({
  items: z.array(parsedFoodItemSchema).describe('Every distinct food component visible on the plate'),
  overallConfidence: unitInterval.describe('Confidence the plate as a whole was identified'),
  notes: z.string().nullable().describe('Optional caveat, e.g. "sauce contents uncertain"; null if none'),
});
export type PhotoParseResult = z.infer<typeof photoParseResultSchema>;

// ============================================================================
// API DTO (camelCase) — the photo-parse endpoint response. This is a DRAFT, not a committed log.
// ============================================================================
export interface NutritionDraftDTO {
  items: ParsedFoodItem[];
  overallConfidence: number;
  notes: string | null;
  inputMethod: NutritionInputMethod;   // 'photo'
  nutritionSource: NutritionSource;    // 'llm_vision'
  model: string;                        // which model produced it (provenance)
  cached: boolean;                      // true if served from the perceptual-hash cache (no LLM bill)
  // Totals are a convenience sum the client can show immediately; client may still edit per-item.
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
}

// ============================================================================
// Confidence threshold below which the client should show manual-entry instead of a guess
// (PRD §12; the value is re-derivable by the eval's calibration but a sane default lives here).
// ============================================================================
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// Per-user daily soft cap on premium vision calls (PRD §9.2 cost governance). Beyond this,
// the endpoint returns a soft-fail asking the user to use search/manual instead.
export const PHOTO_PARSE_DAILY_SOFT_CAP = 25;

// ============================================================================
// nutrition-intelligence-service API surface (FROZEN signatures)
// ----------------------------------------------------------------------------
// class NutritionIntelligenceService {
//   // Parse a meal photo into a structured nutrition draft via the AI Gateway vision model.
//   // imageBytes: the raw image (Buffer/Uint8Array) or a base64 string. Returns a draft;
//   // does NOT write a food log entry (confirm-then-commit happens via the existing food-log route).
//   // Throws Error('RateLimited') when the per-user daily soft cap is exceeded;
//   //        Error('ParseFailed') when the model output can't be validated after retries.
//   static async parsePhoto(userId: string, imageBytes: Buffer, mimeType: string): Promise<NutritionDraftDTO>
//
//   // Perceptual-hash cache lookup/store so an identical photo doesn't re-bill (PRD §7.6).
//   // (private helpers; listed for the implementer)
// }
//
// Model: 'anthropic/claude-sonnet-4.6' via the AI SDK default gateway provider
// (AI_GATEWAY_API_KEY env, or Vercel OIDC). Structured output via generateText + Output.object
// with photoParseResultSchema. p95 target < 2.5s (§7.6).
// ============================================================================
