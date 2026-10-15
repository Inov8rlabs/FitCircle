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
// ≥ 0, clamped (calories, macros, quantities). The description is part of the JSON schema the
// model sees: Gemini 3.x in JSON mode otherwise sometimes emits a runaway decimal expansion
// ("0.25475656565656566869584321975708…" for thousands of tokens) until it hits the output
// cap and the whole parse is lost (seen 2026-10-14 on gemini-3.8-flash: 299/299 failures).
const nonNegative = z.preprocess(
  (v) => Math.max(0, toFiniteNumber(v)),
  z.number().nonnegative().describe('Non-negative number with at most one decimal place'),
);
// 0..1, clamped (per-item and overall confidence).
const unitInterval = z.preprocess(
  (v) => Math.min(1, Math.max(0, toFiniteNumber(v))),
  z.number().min(0).max(1).describe('0..1 with at most two decimal places'),
);

// The numeric fields above are self-healing; the STRING / object fields were not, and a
// single glitch there ("servingUnit": null, a missing "notes" or "quantityRange" key,
// an empty name for a garnish) rejected an otherwise perfect plate as
// "response did not match schema" (2026-09-22, claude-haiku-4.5, 1 333 output tokens of
// valid items thrown away). Same philosophy as the numbers: coerce, don't reject.
const trimmedText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
// A string that falls back to `fallback` when missing/blank/not a string.
const textOr = (fallback: string) => z.preprocess((v) => trimmedText(v) || fallback, z.string());
// A nullable string: missing/blank/non-string → null.
const textOrNull = z.preprocess((v) => trimmedText(v) || null, z.string().nullable());
// {min,max} or null; anything that isn't an object (missing key, "", 0) → null.
const rangeOrNull = z.preprocess(
  (v) => (v != null && typeof v === 'object' ? v : null),
  z.object({ min: nonNegative, max: nonNegative }).nullable(),
);

export const parsedFoodItemSchema = z.object({
  // Empty names are kept here so the plate-level schema can drop the item instead of
  // failing the whole parse; see photoParseResultSchema.
  name: textOr('').describe('Common food name, e.g. "grilled chicken breast"'),
  // Lookup key for reference-database grounding (Phase 1): the plainest generic name for the
  // same food in the same state, as a nutrition database lists it. Optional; stripped from the
  // client-facing draft.
  dbName: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined), z.string().optional()).describe(
    'Plain generic database name for this food in its cooked/raw state, e.g. "banana, raw", "rice, white, cooked", "chicken curry"',
  ),
  quantity: nonNegative.describe('Estimated amount in the serving unit (midpoint if a range)'),
  quantityRange: rangeOrNull.describe(
    'Min/max when the model is uncertain; null when confident. UI defaults to quantity (midpoint).',
  ),
  servingUnit: textOr('serving').describe(
    'Natural unit for THIS food, e.g. "skewer", "piece", "cup", "slice", "serving", or "g"',
  ),
  // Canonical edible weight — every macro scales linearly from this, and the client
  // converts between the natural unit and grams using gramsPerUnit.
  grams: nonNegative.describe('Total estimated edible weight of this item, in grams'),
  gramsPerUnit: nonNegative.describe('Weight in grams of ONE serving unit (so quantity × gramsPerUnit ≈ grams)'),
  calories: nonNegative,
  proteinG: nonNegative,
  carbsG: nonNegative,
  fatG: nonNegative,
  fiberG: nonNegative.describe('Dietary fiber, grams'),
  sugarG: nonNegative.describe('Sugars, grams'),
  sodiumMg: nonNegative.describe('Sodium, milligrams'),
  confidence: unitInterval.describe('Model confidence for THIS item, 0..1'),
});
export type ParsedFoodItem = z.infer<typeof parsedFoodItemSchema>;

// An alternate measurement the UI can offer for an item (the pill selector).
export interface UnitOption {
  label: string;        // "skewer", "g", "oz", "serving", …
  gramsPerUnit: number; // weight of one such unit, so the client can rescale macros by grams
}

// A draft item AFTER server enrichment: the parsed fields plus DB-grounding provenance
// and the unit choices the client renders. Macros here are authoritative (DB-grounded
// when matched, else the model's estimate).
export interface NutritionDraftItem extends ParsedFoodItem {
  matchedFoodId: string | null;   // foods.id when grounded against the DB, else null
  itemSource: NutritionSource;    // 'foods_db' when grounded, else 'llm_vision'
  unitOptions: UnitOption[];
  // "Did you mean…": up to 3 other reference foods the grounding step considered for this
  // item. Clients swap locally (name, matchedFoodId, per100g × grams). Absent on older drafts.
  alternates?: DraftAlternate[];
}

export interface DraftAlternate {
  foodId: string;
  name: string;
  per100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sugarG: number;
    sodiumMg?: number | null;
  };
}

// A "fix": the user's free-text correction plus the items as they currently see them
// (photo-parse re-runs the vision model with both and the original photo).
export const PHOTO_PARSE_MAX_CORRECTION_CHARS = 500;
export const refineDraftItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().nonnegative().optional(),
  servingUnit: z.string().trim().max(40).optional(),
  grams: z.number().nonnegative().optional(),
  calories: z.number().nonnegative().optional(),
  proteinG: z.number().nonnegative().optional(),
  carbsG: z.number().nonnegative().optional(),
  fatG: z.number().nonnegative().optional(),
});
export type RefineDraftItem = z.infer<typeof refineDraftItemSchema>;
export interface PhotoRefineRequest {
  correction: string;
  items: RefineDraftItem[];
  /** parseHash of the draft being corrected (provenance for the training signal). */
  previousParseHash?: string | null;
}
export const nutritionFeedbackSchema = z.object({
  parseHash: z.string().trim().min(8).max(128),
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(500).optional(),
});

// The full LLM result for one photo: the plate is an array of items + an overall confidence.
export const photoParseResultSchema = z.object({
  items: z
    .array(parsedFoodItemSchema)
    // An item the model could not name is noise, not a reason to fail the plate.
    .transform((items) => items.filter((item) => item.name.length > 0))
    .describe('Every distinct food component visible on the plate'),
  overallConfidence: unitInterval.describe('Confidence the plate as a whole was identified'),
  notes: textOrNull.describe('Optional caveat, e.g. "sauce contents uncertain"; null if none'),
});
export type PhotoParseResult = z.infer<typeof photoParseResultSchema>;

// ----------------------------------------------------------------------------
// Assumptions (text / voice parse): short, user-facing statements of what the model had to
// assume because the description did not say — a quantity, size or preparation. Shown under
// the "AI estimate" note so the user knows what to correct. Empty when the text was specific.
// Parsed leniently: anything that is not an array of strings becomes [] (never fails a parse).
// ----------------------------------------------------------------------------
export const DRAFT_ASSUMPTIONS_MAX = 3;
export const DRAFT_ASSUMPTION_MAX_CHARS = 60;

export type ParseInputSource = 'voice' | 'text';

/** Trim, de-bullet, de-dupe and cap the model's assumptions: ≤3 strings of ≤60 chars. */
export function normalizeAssumptions(value: unknown): string[] {
  // A lone string is one assumption; anything else that is not an array is noise.
  if (typeof value === 'string') value = [value];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    let text = raw.replace(/\s+/g, ' ').replace(/^[\s\-*•·–—]+/, '').trim();
    if (!text) continue;
    if (text.length > DRAFT_ASSUMPTION_MAX_CHARS) {
      const cut = text.slice(0, DRAFT_ASSUMPTION_MAX_CHARS - 1);
      const space = cut.lastIndexOf(' ');
      text = `${(space >= 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.(]+$/, '')}…`;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= DRAFT_ASSUMPTIONS_MAX) break;
  }
  return out;
}

const assumptionsList = z.preprocess(normalizeAssumptions, z.array(z.string()));

// The text/voice parse result: the photo shape plus `assumptions`.
export const textParseResultSchema = photoParseResultSchema.extend({
  assumptions: assumptionsList.describe(
    'Up to 3 short user-facing notes (max 60 chars each) naming a quantity, size or preparation you ASSUMED because the text did not state it; [] when the text was specific',
  ),
});
export type TextParseResult = z.infer<typeof textParseResultSchema>;

// ============================================================================
// API DTO (camelCase) — the photo-parse endpoint response. This is a DRAFT, not a committed log.
// ============================================================================
export interface NutritionDraftDTO {
  items: NutritionDraftItem[];
  overallConfidence: number;
  notes: string | null;
  inputMethod: NutritionInputMethod;   // 'photo'
  nutritionSource: NutritionSource;    // 'llm_vision'
  model: string;                        // which model produced it (provenance)
  cached: boolean;                      // true if served from the perceptual-hash cache (no LLM bill)
  // Totals are a convenience sum the client can show immediately; client may still edit per-item.
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; sugarG: number; sodiumMg: number };
  // 0–10 per-meal health score (heuristic over the totals), or null if not computable.
  healthScore: number | null;
  // Text/voice parse only: what the model assumed because the description did not say
  // (0–3 strings, ≤60 chars each; [] when the text was specific). Absent on photo drafts.
  assumptions?: string[];
  // Content hash of the parse input (images+note / transcript / item+portion). Lets a
  // saved entry be tied back to its draft (nutrition_training_samples.parse_hash).
  // Shipped clients ignore unknown keys (Swift CodingKeys / kotlinx ignoreUnknownKeys).
  parseHash?: string;
}

// ============================================================================
// Confidence threshold below which the client should show manual-entry instead of a guess
// (PRD §12; the value is re-derivable by the eval's calibration but a sane default lives here).
// ============================================================================
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// Per-user daily soft cap on premium vision calls (PRD §9.2 cost governance). Beyond this,
// the endpoint returns a soft-fail asking the user to use search/manual instead.
export const PHOTO_PARSE_DAILY_SOFT_CAP = 25;

// Per-request caps for photo-parse, shared by the route and every web client surface so
// they cannot drift. (Native clients mirror these values — keep them in sync.)
export const PHOTO_PARSE_MAX_IMAGES = 5;
export const PHOTO_PARSE_MAX_NOTE_CHARS = 500;

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
