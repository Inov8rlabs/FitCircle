import { createHash } from 'crypto';

import * as Sentry from '@sentry/nextjs';
import { generateText, Output } from 'ai';


import { createAdminSupabase } from '../supabase-admin';
import type { FoodDTO } from '../types/foods';
import {
  type NutritionDraftDTO,
  type NutritionDraftItem,
  type ParsedFoodItem,
  type PhotoParseResult,
  type UnitOption,
  parsedFoodItemSchema,
  photoParseResultSchema,
} from '../types/nutrition';

import { FoodLogImageService } from './food-log-image-service';
import { FoodLogService } from './food-log-service';
import { FoodsSemanticService, type SemanticCandidate } from './foods-semantic-service';
import { FoodsService } from './foods-service';
import { NutritionGroundingService, type GroundingMode } from './nutrition-grounding-service';
import { UsageService } from './usage-service';

/**
 * NutritionIntelligenceService — the server-side "brain" for nutrition (PRD §6.1, §7.2.1).
 * Turns a meal photo into a structured, validated nutrition DRAFT via the Vercel AI Gateway
 * vision model. All nutrition logic lives here; clients render the draft and never re-derive it.
 *
 * Confirm-then-commit: this returns a draft only. The user confirms, then the existing
 * food-log create/PATCH route writes the entry (carrying input_method/nutrition_source).
 */

// Vision model via the AI Gateway (slug verified against the live model list).
// Gateway auth: AI_GATEWAY_API_KEY env, or Vercel OIDC in deployment.
//
// SPEED: Haiku 4.5 is materially faster than Sonnet 4.6 on the photo→nutrition
// call (the user's "takes too long / times out" pain). Macro accuracy is largely
// preserved because we DB-ground each matched item's macros from the foods table
// and the user reviews the draft before committing; the model's main job here is
// to identify foods + estimate portions, which Haiku handles well. To trade speed
// back for Sonnet's portion nuance, set this to 'anthropic/claude-sonnet-4.6'.
// Both are env-overridable so a bake-off winner can be promoted (or rolled back) without a
// deploy: NUTRITION_VISION_MODEL / NUTRITION_FALLBACK_MODEL (gateway slugs).
const VISION_MODEL = process.env.NUTRITION_VISION_MODEL?.trim() || 'anthropic/claude-haiku-4.5';
const FAST_FALLBACK_MODEL = process.env.NUTRITION_FALLBACK_MODEL?.trim() || 'google/gemini-3-flash';

/**
 * Internal knobs for the eval runner / bake-offs. Production callers pass nothing.
 * - model / fallbackModel: override the vision models (fallbackModel null = no fallback).
 * - bypassCache: skip the content-hash cache read AND write (every call is a fresh model call
 *   and never pollutes the production cache).
 * - bypassQuota: skip the per-user daily quota (the eval's system user has no tier).
 * - promptVariant: pick a system prompt from PHOTO_PROMPT_VARIANTS (default: production).
 */
export interface ParsePhotoOptions {
  model?: string;
  fallbackModel?: string | null;
  bypassCache?: boolean;
  bypassQuota?: boolean;
  promptVariant?: string;
  /** Grounding strategy (default: NUTRITION_GROUNDING_MODE env, else 'generic'). Eval/bake-off seam. */
  grounding?: GroundingMode;
}

export interface ParsePhotoStats {
  draft: NutritionDraftDTO;
  model: string;
  cached: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** The vision model's items BEFORE grounding (eval ablations: same model output, grounding on/off). */
  rawItems?: ParsedFoodItem[];
  /** Matched reference kcal/100 g per draft item (null = unmatched), from the grounding step. */
  dbKcalPer100g?: Array<number | null>;
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
}

// Voice parsing is text-only (no image) — kept on Sonnet 4.6 for slightly better
// free-text parsing. p95 target < 1.2s (§7.6).
const VOICE_MODEL = 'anthropic/claude-sonnet-4.6';

// Single-item re-estimate ("tap to fix"). This was on Sonnet 4.6 with a 25s abort and
// was timing out in production ("AbortError: Delay was aborted" — the model overran the
// budget and the retry backoff got killed), so the re-estimate silently failed. Like the
// photo path, the result is DB-grounded and user-reviewed, so Haiku 4.5 — materially
// faster — gives the accuracy we need with far better reliability.
const ITEM_MODEL = 'anthropic/claude-haiku-4.5';

// Use short, bounded attempts rather than one 45-50s call with an SDK retry. In production the
// SDK retry backoff consumed the whole abort budget ("Delay was aborted"), so tapping Retry just
// repeated the same failure. A second provider/model now gets a real chance inside the 60s route.
const PHOTO_PRIMARY_TIMEOUT_MS = 28_000;
const PHOTO_FALLBACK_TIMEOUT_MS = 22_000;
const TEXT_PRIMARY_TIMEOUT_MS = 15_000;
const TEXT_FALLBACK_TIMEOUT_MS = 20_000;

// The pre-2026-10-14 production prompt ("when torn, choose the SMALLER / revise DOWN"). Kept as the
// `shrink` eval variant; it under-estimated plates over 400 kcal by 31–47% (plan doc §3a/§3c).
const SHRINK_SYSTEM_PROMPT = [
  'You are a careful nutrition estimation assistant. Given a photo of a meal, identify every distinct',
  'food component and estimate its quantity and macros.',
  'Rules:',
  '- Estimate, never claim exactness. When unsure of a quantity, set quantityRange {min,max} and',
  '  set quantity to the midpoint; when confident, set quantityRange to null.',
  '- servingUnit is the NATURAL unit a person would use for THIS food: e.g. "skewer" for a kebab,',
  '  "piece" for chicken tikka, "cup" for rice, "slice" for bread, "serving" for a salad, or "g".',
  '- quantity is how many of that unit. gramsPerUnit is the weight of ONE such unit, and grams is the',
  '  TOTAL edible weight (quantity × gramsPerUnit). Always provide grams — it is the source of truth.',
  '- Macros are for the WHOLE item at the estimated grams: calories, proteinG, carbsG, fatG, fiberG,',
  '  sugarG (grams) and sodiumMg (milligrams). Give your best estimate for every field.',
  '- confidence (per item) and overallConfidence are 0..1.',
  '- dbName is the plainest generic name for the SAME food in the SAME state as a nutrition database lists it,',
  '  noun first: "banana, raw", "rice, white, cooked", "egg, scrambled", "chicken curry", "tomatoes, cherry, raw".',
  '  Keep brand, dish and garnish words out of dbName; name stays the friendly display name.',
  '- NUMBER FORMAT: every number is a plain decimal with AT MOST ONE decimal place (e.g. 12.5, 0.3, 180).',
  '  Never write long decimal expansions.',
  '- Do not invent foods you cannot see. If the plate is unclear, return fewer items with lower confidence.',
  '- Be body- and food-neutral: never judge the food, never comment on the eater. Just identify and estimate.',
  'PORTION REALISM — this is where estimates most often go wrong, so weigh it heavily:',
  '- Estimate the amount that is ACTUALLY VISIBLE on the plate, not a default "standard serving".',
  '  Use on-image scale cues: a dinner plate rim is ~26-28cm, a small katori/side bowl holds ~150ml,',
  '  a teaspoon ~5ml, a tablespoon ~15ml. Judge each portion against these, not against a generic recipe.',
  '- Shared platters, thalis, tasting/sampler plates and buffet plates show MODEST amounts of each item —',
  '  frequently half a standard serving or less. A small mound of rice is ~½ cup (~80g), not a full cup;',
  '  a few spoons of curry is ~½ cup (~100-120g), not a brimming bowl.',
  '- When torn between two portion sizes, choose the SMALLER. Over-estimation is the more common and the',
  '  more harmful error here.',
  '- Only count edible food actually present. Bones, peels, pits, garnish and packaging are not food weight.',
  '  A dry roasted or grilled vegetable is mostly the vegetable plus a little oil — do not inflate its fat.',
  '- Sanity-check the whole plate: the sum of calories should look right for the total volume of food shown.',
  '  If the total seems high for the amount visible, revise the portions DOWN before returning.',
].join(' ');

// toDraft carries the matched reference density as an eval side channel; it is not part of the DTO.
function stripDbDensity<T extends { dbKcalPer100g?: unknown }>(d: T): Omit<T, 'dbKcalPer100g'> {
  const { dbKcalPer100g: _ignored, ...rest } = d;
  return rest;
}

// Structured output for the photo parse. PHOTO_OUTPUT_JSON_MODE keeps the same Zod parsing but
// asks the provider for plain JSON mode instead of json_schema (see modelCallOptions.nativeSchema).
const PHOTO_OUTPUT = Output.object({ schema: photoParseResultSchema });
const PHOTO_OUTPUT_JSON_MODE: typeof PHOTO_OUTPUT = {
  ...PHOTO_OUTPUT,
  responseFormat: Promise.resolve({ type: 'json' as const }),
};

// Appended to the system prompt when a model is called WITHOUT a native JSON schema (see
// modelCallOptions.nativeSchema): the exact shape the Zod schema expects, so the model is not
// guessing key names from the rules above.
const RESPONSE_SHAPE_PROMPT = [
  'RESPONSE FORMAT: reply with ONE JSON object and nothing else — no prose, no markdown fences:',
  '{"items":[{"name":string,"dbName":string,"quantity":number,"quantityRange":{"min":number,"max":number}|null,',
  '"servingUnit":string,"grams":number,"gramsPerUnit":number,"calories":number,"proteinG":number,',
  '"carbsG":number,"fatG":number,"fiberG":number,"sugarG":number,"sodiumMg":number,"confidence":number}],',
  '"overallConfidence":number,"notes":string|null}',
].join(' ');

// Hidden-fat rule (candidate): the NIH metabolic-kitchen test of four photo apps (NUTRITION 2026)
// found every app, Cal AI included, ~33% low on calories and ~30 g/meal low on fat — cooking oil,
// butter, ghee, dressings and cheese that the photo does not show. Our own fat MAPE is 74–111%.
const HIDDEN_FAT_RULES = [
  'HIDDEN FAT — the most common reason estimates run low: assume the normal cooking fat for how a food was',
  'prepared and include it in that item\'s fatG and calories. Sautéed, stir-fried or pan-fried vegetables/meat:',
  '+1 tsp oil (5 g, 45 kcal) per ~100 g; roasted vegetables: +1 tsp oil per cup; fried or breaded items:',
  '15-25% of weight is absorbed fat; curries, dals and gravies: 1-2 tbsp oil/ghee/cream per serving; dressed',
  'salads: 1-2 tbsp dressing (10-20 g fat); buttered toast/rice/vegetables: +1 tsp butter each; cheese on',
  'anything: 15-30 g. Restaurant and takeout dishes use MORE fat than home cooking. Only skip added fat',
  'when the food is clearly steamed, boiled, raw or dry.',
].join(' ');

// PRODUCTION prompt (promoted 2026-10-14, plan doc §3c): the shrink-biased rules replaced by
// plate-coverage anchors and a symmetric sanity check. Eval vs the shrink prompt, same grounding:
// SNAPMe kcal±40% 61–63% → 66% (bias −7% → −2%), Nutrition5k 67% → 69% (bias +5% → −3%).
// (The joined prompt has irregular spacing at line breaks, hence regex replacement.)
const SYSTEM_PROMPT = SHRINK_SYSTEM_PROMPT
  .replace(
    /- When torn between two portion sizes, choose the SMALLER\.[\s\S]*?more harmful error here\./,
    '- When torn between two portion sizes, use the plate coverage to decide: food covering a full dinner plate to the rim is typically 400-700 g in total, a half-covered plate 200-350 g, a side bowl or katori 100-180 g, a small snack plate under 150 g. Do not shrink a clearly full plate.',
  )
  .replace(
    /- Sanity-check the whole plate:[\s\S]*?revise the portions DOWN before returning\./,
    '- Sanity-check the whole plate: the total grams should match the plate coverage above and the sum of calories should look right for that weight. Revise portions UP or DOWN as needed before returning; a full plate of rice, meat and vegetables is rarely under 500 kcal, a small snack rarely over 250 kcal.',
  );

// Named prompt variants for the eval harness (`--prompt=<id>`). `production` is what ships;
// new candidates are added here, measured against it on the golden sets, and promoted by
// becoming the new SYSTEM_PROMPT. Unknown ids fall back to production.
const PHOTO_PROMPT_VARIANTS: Record<string, string> = {
  production: SYSTEM_PROMPT,
  // The previous production prompt, for regression comparisons.
  shrink: SHRINK_SYSTEM_PROMPT,
  // Same as production (kept so older eval reports' `--prompt=scale` runs stay reproducible).
  scale: SYSTEM_PROMPT,
  // Candidate: explicit hidden-fat accounting on top of the old prompt (see HIDDEN_FAT_RULES).
  fat: `${SHRINK_SYSTEM_PROMPT} ${HIDDEN_FAT_RULES}`,
};
// Candidate: production + hidden-fat accounting.
PHOTO_PROMPT_VARIANTS.scale_fat = `${SYSTEM_PROMPT} ${HIDDEN_FAT_RULES}`;


// Single-item re-estimate: the user corrected a food's name (or set a portion) and wants its
// macros recomputed for that exact food and amount. Text-only — same model family as voice.
const ITEM_SYSTEM_PROMPT = [
  'You are a careful nutrition estimation assistant. The user names ONE food and the portion they ate.',
  'Return that single item with its best-estimate macros for THAT portion.',
  'Rules:',
  '- grams is the total edible weight of the portion and is the source of truth; every macro is for the',
  '  WHOLE portion at that gram weight. If the user gave grams, use exactly that; otherwise estimate a',
  '  realistic portion for the stated quantity/unit (or a typical single serving if none was given).',
  '- servingUnit is the natural unit for the food; gramsPerUnit is the weight of one such unit so that',
  '  quantity × gramsPerUnit ≈ grams.',
  '- Provide calories, proteinG, carbsG, fatG, fiberG, sugarG (grams) and sodiumMg (milligrams).',
  '- Prefer realistic, slightly conservative values; do not inflate. confidence is 0..1.',
  '- Be body- and food-neutral: just identify and estimate.',
].join(' ');

const VOICE_SYSTEM_PROMPT = [
  'You are a nutrition estimation assistant. The user spoke a description of what they ate and it',
  'was transcribed to text. Parse that text into every distinct food item with estimated quantity and macros.',
  'Rules:',
  '- Estimate, never claim exactness. Infer reasonable quantities from the words: "two eggs" → quantity 2,',
  '  servingUnit "egg"; "a bowl of rice" → a typical bowl. When the amount is vague or unstated, set',
  '  quantityRange {min,max} to a plausible span and quantity to its midpoint; when the speaker gave a clear',
  '  count or measure, set quantityRange to null.',
  '- servingUnit is the natural unit for the food ("egg", "cup", "slice", "serving", or "g"); quantity is',
  '  how many; gramsPerUnit is the weight of one; grams is the TOTAL edible weight (always provide it).',
  '- Macros are for the WHOLE item at the estimated grams: calories, proteinG, carbsG, fatG, fiberG,',
  '  sugarG (grams), sodiumMg (milligrams). Give your best estimate for every field.',
  '- confidence (per item) and overallConfidence are 0..1; lower it when the transcript is ambiguous.',
  '- Only include foods the transcript actually mentions. Ignore filler words and non-food chatter.',
  '- If the transcript names no food at all, return an empty items array with low overallConfidence.',
  '- Be body- and food-neutral: never judge the food, never comment on the eater. Just identify and estimate.',
].join(' ');

export interface ParsePhotoImage {
  bytes: Buffer;
  mimeType: string;
}

export class NutritionIntelligenceService {
  /**
   * Parse one meal — photographed in 1..N images (angles / extra dishes of the SAME meal) —
   * into a structured nutrition draft, in a single vision call. `note` is an optional caption
   * the user typed about the meal; it is fed to the model as trusted context (identification,
   * preparation, portion hints).
   * @throws Error('RateLimited') when the per-user daily soft cap is exceeded
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static async parsePhoto(
    userId: string,
    images: ParsePhotoImage[],
    note?: string | null,
  ): Promise<NutritionDraftDTO> {
    return (await this.parsePhotoWithStats(userId, images, note)).draft;
  }

  /**
   * parsePhoto plus per-call observability (model actually used, latency, tokens). Used by the
   * eval runner for bake-offs; `opts` lets it pin a model and bypass cache/quota. Production
   * behaviour with no opts is identical to parsePhoto.
   */
  static async parsePhotoWithStats(
    userId: string,
    images: ParsePhotoImage[],
    note?: string | null,
    opts: ParsePhotoOptions = {},
  ): Promise<ParsePhotoStats> {
    if (images.length === 0) throw new Error('ParseFailed');
    const hint = note?.trim() || null;
    const primaryModel = opts.model ?? VISION_MODEL;
    const fallbackModel = opts.fallbackModel === undefined ? FAST_FALLBACK_MODEL : opts.fallbackModel;
    const systemPrompt = this.photoPromptVariant(opts.promptVariant);

    // 1. Cost guard — content hash cache so an identical request never re-bills (§7.6).
    //    The key covers every image plus the note (a different note must not hit a stale
    //    result); a single image with no note hashes exactly as before, preserving the
    //    existing cache rows.
    // Multi-image/note keys hash per-image DIGESTS plus a count and a tagged note —
    // fixed-width blocks with domain separation, so image partitions ([A,B] vs the single
    // file A||B) and image-vs-note boundaries can never collide. The single-image no-note
    // key stays the raw byte hash for backward compatibility with existing cache rows.
    const hasher = createHash('sha256');
    if (images.length === 1 && !hint) {
      hasher.update(images[0].bytes);
    } else {
      hasher.update(`v2:${images.length}:`);
      for (const img of images) hasher.update(createHash('sha256').update(img.bytes).digest());
      if (hint) hasher.update(`note:${hint}`);
    }
    const imageHash = hasher.digest('hex');
    const cached = opts.bypassCache ? null : await this.getCachedResult(imageHash);
    if (cached) {
      const { dbKcalPer100g, ...draft } = await this.toDraft(userId, cached, VISION_MODEL, true, 'photo', 'llm_vision', opts.grounding);
      return {
        draft: { ...draft, parseHash: imageHash },
        model: VISION_MODEL,
        cached: true,
        latencyMs: 0,
        rawItems: cached.items,
        dbKcalPer100g,
      };
    }

    // 2. Tier-aware per-user daily quota on premium vision calls (§9.2 + MONETIZATION-PLAN).
    //    Caching is checked first so repeat/identical photos don't count against the quota.
    //    A multi-image request is ONE model call and counts as one parse.
    //    Throws UpgradeRequiredError (free limit, paywall trigger) or Error('RateLimited').
    if (!opts.bypassQuota) await UsageService.assertFoodAiQuota(userId);

    // 3. Structured vision call via the AI Gateway. generateText + Output.object validates
    //    the result against the Zod schema; explicit failover below handles a failed attempt.
    const promptBits = [
      images.length > 1
        ? `These ${images.length} photos are ONE logging session: they may show the same plate from ` +
          'different angles, OR separate dishes/servings of the same meal. Count each PHYSICAL plate or ' +
          'dish once: when two photos show the same physical plate (identical arrangement, background, ' +
          'plate position — i.e. re-takes or angles), count its food once; when photos show distinct ' +
          'servings or dishes — even of identical-looking food, such as two separate plates of the same ' +
          'item — count each serving separately. Estimate quantities and macros for the total.'
        : 'Identify the foods on this plate and estimate quantities and macros.',
    ];
    if (hint) {
      promptBits.push(
        `The user added this note about the meal: "${hint}". Treat it as reliable context: use it to ` +
          'identify foods correctly (e.g. paneer vs tofu), capture preparation details that change macros ' +
          '(e.g. cooked in ghee), calibrate portions, and include foods it explicitly mentions even if they ' +
          'are partially hidden in the photos.',
      );
    }
    let result: PhotoParseResult;
    let usage: ModelUsage = {};
    let model = primaryModel;
    const startedAt = Date.now();
    try {
      ({ result, usage } = await this.callPhotoModel(
        primaryModel,
        userId,
        systemPrompt,
        promptBits.join('\n\n'),
        images,
        PHOTO_PRIMARY_TIMEOUT_MS,
      ));
    } catch (primaryError) {
      if (!fallbackModel) {
        this.logParseFailure('photo', userId, primaryModel, Date.now() - startedAt, {
          imageCount: images.length,
          mimeType: images[0].mimeType,
          imageBytes: images.reduce((a, img) => a + img.bytes.length, 0),
          hasNote: !!hint,
          imageHash: imageHash.slice(0, 12),
          primaryModel,
          fallback: 'disabled',
        }, primaryError);
        throw new Error('ParseFailed');
      }
      model = fallbackModel;
      try {
        ({ result, usage } = await this.callPhotoModel(
          fallbackModel,
          userId,
          systemPrompt,
          promptBits.join('\n\n'),
          images,
          PHOTO_FALLBACK_TIMEOUT_MS,
        ));
      } catch (fallbackError) {
        this.logParseFailure('photo', userId, fallbackModel, Date.now() - startedAt, {
          imageCount: images.length,
          mimeType: images[0].mimeType,
          imageBytes: images.reduce((a, img) => a + img.bytes.length, 0),
          hasNote: !!hint,
          imageHash: imageHash.slice(0, 12),
          primaryModel,
          primaryError: this.describeParseError(primaryError),
        }, fallbackError);
        throw new Error('ParseFailed');
      }
    }
    const latencyMs = Date.now() - startedAt;

    // 4. Record the call (for the daily cap) and cache the result by image hash. A bake-off
    //    run bypasses the cache entirely so it never seeds production with eval outputs.
    if (!opts.bypassCache) await this.recordParse(userId, imageHash, result);

    const { dbKcalPer100g, ...draft } = await this.toDraft(userId, result, model, false, 'photo', 'llm_vision', opts.grounding);
    return {
      draft: { ...draft, parseHash: imageHash },
      model,
      cached: false,
      latencyMs,
      rawItems: result.items,
      dbKcalPer100g,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }

  /**
   * Parse a spoken (client-STT-transcribed) food description into a structured nutrition draft.
   * Text-only — the native Speech framework / Web Speech API ran on the client and produced the
   * transcript; we just turn it into the same draft shape as parsePhoto for confirm-then-commit.
   *
   * We still record the call in nutrition_parse_log for accounting/observability (failure-isolated)
   * and gate it on the daily cap. No content cache: free-text transcripts are near-unique, so a hash
   * cache would rarely hit; cached is always false. p95 target < 1.2s (§7.6).
   *
   * @throws Error('RateLimited') when the per-user daily soft cap is exceeded
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static async parseVoice(userId: string, transcript: string): Promise<NutritionDraftDTO> {
    // Tier-aware daily quota — COMBINED across all paid parses (photo/voice/item); every
    // recorded parse counts toward the same daily budget. May throw UpgradeRequiredError.
    await UsageService.assertFoodAiQuota(userId);

    let result: PhotoParseResult;
    let model = VOICE_MODEL;
    const startedAt = Date.now();
    try {
      result = await this.callVoiceModel(VOICE_MODEL, userId, transcript, TEXT_PRIMARY_TIMEOUT_MS);
    } catch (primaryError) {
      model = FAST_FALLBACK_MODEL;
      try {
        result = await this.callVoiceModel(
          FAST_FALLBACK_MODEL,
          userId,
          transcript,
          TEXT_FALLBACK_TIMEOUT_MS,
        );
      } catch (fallbackError) {
        this.logParseFailure('voice', userId, FAST_FALLBACK_MODEL, Date.now() - startedAt, {
          transcriptLength: transcript.length,
          primaryModel: VOICE_MODEL,
          primaryError: this.describeParseError(primaryError),
        }, fallbackError);
        throw new Error('ParseFailed');
      }
    }

    // Cap accounting (no cache). The hash is over the transcript so the log row matches
    // the not-null image_hash column convention; it is not used for lookups.
    const transcriptHash = createHash('sha256').update(transcript).digest('hex');
    await this.recordParseLog(userId, transcriptHash);

    return {
      ...stripDbDensity(await this.toDraft(userId, result, model, false, 'voice', 'llm_voice')),
      parseHash: transcriptHash,
    };
  }

  /**
   * Re-estimate the macros for ONE food the user corrected on the confirm card (§6.1 "tap to fix").
   * The user fixed the name (e.g. the model said "eggplant" but it was "stuffed bitter gourd") and/or
   * set the portion; we re-run the estimate for that exact food + amount and ground it against the
   * foods DB the same way the photo flow does, so the corrected calories/macros are authoritative.
   *
   * @throws Error('RateLimited') when the per-user daily soft cap is exceeded
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static resolveItemPortion(
    grams?: number,
    quantity?: number,
    servingUnit?: string,
  ): { grams?: number; quantity?: number; servingUnit?: string } {
    const positive = (n: number | undefined): number | undefined =>
      n != null && Number.isFinite(n) && n > 0 ? n : undefined;
    let resolvedGrams = positive(grams);
    const resolvedQuantity = positive(quantity);
    const unit = servingUnit?.trim() || undefined;
    const gramsPerUnit: Record<string, number> = {
      g: 1,
      gram: 1,
      grams: 1,
      oz: 28.3495,
      ounce: 28.3495,
      ounces: 28.3495,
      kg: 1000,
      mg: 0.001,
      lb: 453.592,
      lbs: 453.592,
      pound: 453.592,
      pounds: 453.592,
      ml: 1,
      milliliter: 1,
      millilitre: 1,
      l: 1000,
      liter: 1000,
      litre: 1000,
      cup: 240,
      cups: 240,
      tbsp: 15,
      tablespoon: 15,
      tablespoons: 15,
      tsp: 5,
      teaspoon: 5,
      teaspoons: 5,
    };

    const multiplier = unit ? gramsPerUnit[unit.toLowerCase()] : undefined;
    if (resolvedQuantity && multiplier) {
      const expectedGrams = resolvedQuantity * multiplier;
      const ratio = resolvedGrams ? resolvedGrams / expectedGrams : 0;
      // Allow food-density differences, but reject impossible payloads such as
      // "2 cups, 2 g total" produced by the old iOS unit fallback.
      if (!resolvedGrams || ratio < 0.2 || ratio > 5) resolvedGrams = expectedGrams;
    }

    return {
      grams: resolvedGrams,
      quantity: resolvedQuantity,
      servingUnit: unit,
    };
  }

  static async estimateItem(
    userId: string,
    name: string,
    grams?: number,
    quantity?: number,
    servingUnit?: string,
  ): Promise<NutritionDraftItem> {
    const cleanName = name.trim();
    const resolved = this.resolveItemPortion(grams, quantity, servingUnit);
    const portionBits: string[] = [];
    if (resolved.quantity) {
      portionBits.push(`${resolved.quantity} ${resolved.servingUnit || 'serving'}`);
    }
    if (resolved.grams) portionBits.push(`${Math.round(resolved.grams)} g total`);
    const portion = portionBits.length ? portionBits.join(', ') : 'one typical serving';
    const itemHash = createHash('sha256')
      .update(`item:v2:${JSON.stringify({ name: cleanName.toLowerCase(), ...resolved })}`)
      .digest('hex');

    // A successful re-estimate is deterministic for the same food/portion. Check the cache
    // before the daily cap so a user retry is instant and never incurs another model call.
    const cached = await this.getCachedResult(itemHash);
    if (cached?.items[0]) {
      return await this.finalizeEstimatedItem(userId, cleanName, resolved, cached.items[0]);
    }

    // Tier-aware daily quota — COMBINED across all paid parses (photo/voice/item); every
    // recorded parse counts toward the same daily budget. May throw UpgradeRequiredError.
    await UsageService.assertFoodAiQuota(userId);

    let llm: ParsedFoodItem;
    const startedAt = Date.now();
    try {
      llm = await this.callItemModel(ITEM_MODEL, userId, cleanName, portion, TEXT_PRIMARY_TIMEOUT_MS);
    } catch (primaryError) {
      try {
        llm = await this.callItemModel(
          FAST_FALLBACK_MODEL,
          userId,
          cleanName,
          portion,
          TEXT_FALLBACK_TIMEOUT_MS,
        );
      } catch (fallbackError) {
        this.logParseFailure('item', userId, FAST_FALLBACK_MODEL, Date.now() - startedAt, {
          name: cleanName,
          portion,
          primaryModel: ITEM_MODEL,
          primaryError: this.describeParseError(primaryError),
        }, fallbackError);
        throw new Error('ParseFailed');
      }
    }

    await this.recordParse(userId, itemHash, {
      items: [llm],
      overallConfidence: llm.confidence,
      notes: null,
    });
    return await this.finalizeEstimatedItem(userId, cleanName, resolved, llm);
  }

  /**
   * Fallback for a FAILED / rate-limited photo parse (§6.1, "Option B"): persist the user's
   * photo as a normal food-log entry with macros left blank, so their input is NEVER lost and
   * shows up exactly like any logged meal — they (or a later re-parse) fill in the nutrition.
   * Confirm-then-commit still governs the SUCCESS path; this only catches the failure path.
   *
   * Returns the new entry id + uploaded image URLs so the route can hand the client straight to
   * that entry's edit screen. Best-effort: a failed image upload still yields the (text) entry.
   */
  static async saveUnparsedPhoto(
    userId: string,
    note: string | null,
  ): Promise<{ entryId: string }> {
    const supabase = createAdminSupabase();
    const { data: entry, error } = await FoodLogService.createEntry(
      userId,
      {
        entry_type: 'food',
        meal_type: this.defaultMealType(),
        title: note?.trim() || 'Food photo',
        notes: "Saved from a photo we couldn't auto-analyze — add the details.",
      },
      supabase,
    );
    if (error || !entry) {
      throw new Error(`FallbackSaveFailed: ${error?.message ?? 'no entry returned'}`);
    }
    return { entryId: entry.id };
  }

  /**
   * True when `entryId` is a live (not deleted) food-log entry owned by `userId`.
   * Used by the parse routes before they echo a client-supplied `existing_entry_id`
   * back as `savedEntryId`: an id that is unknown, deleted or someone else's is never
   * confirmed. Fail-closed — any lookup error reads as "not owned".
   */
  static async ownsFoodLogEntry(userId: string, entryId: string): Promise<boolean> {
    try {
      const supabase = createAdminSupabase();
      const { data, error } = await supabase
        .from('food_log_entries')
        .select('id')
        .eq('id', entryId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle();
      return !error && !!data;
    } catch {
      return false;
    }
  }

  /**
   * Attach the photos of a failed parse to its fallback entry. Runs AFTER the route has
   * responded (via `after()`): a failed parse has already spent most of the function
   * budget, and processing/uploading up to 5 images must not push the response past
   * maxDuration. Best-effort — uploadImages records per-file failures.
   */
  static async attachFallbackImages(entryId: string, userId: string, files: File[]): Promise<void> {
    if (files.length === 0) return;
    try {
      const supabase = createAdminSupabase();
      const { failed } = await FoodLogImageService.uploadImages(entryId, userId, files, supabase);
      if (failed.length > 0) {
        console.error('[NutritionIntelligenceService.attachFallbackImages] some uploads failed:', failed);
      }
    } catch (err) {
      // Non-fatal: the entry + text are already saved; a failed image upload must not lose them.
      console.error('[NutritionIntelligenceService.attachFallbackImages] upload failed:', err);
    }
  }

  /**
   * Fallback for a FAILED / rate-limited voice parse: persist the transcript as a normal
   * food-log entry (no image) so the user's spoken note isn't lost. Mirrors saveUnparsedPhoto.
   */
  static async saveUnparsedVoice(
    userId: string,
    transcript: string,
  ): Promise<{ entryId: string }> {
    const supabase = createAdminSupabase();
    const text = transcript.trim();
    const { data: entry, error } = await FoodLogService.createEntry(
      userId,
      {
        entry_type: 'food',
        meal_type: this.defaultMealType(),
        title: text.length > 80 ? `${text.slice(0, 77)}…` : text || 'Voice note',
        description: text || undefined,
        notes: "Saved from a voice note we couldn't auto-analyze — add the details.",
      },
      supabase,
    );
    if (error || !entry) {
      throw new Error(`FallbackSaveFailed: ${error?.message ?? 'no entry returned'}`);
    }
    return { entryId: entry.id };
  }

  // ---- private helpers -------------------------------------------------------

  /** Best-guess meal slot from the server clock; the user can change it on the entry. */
  private static defaultMealType(): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
    const h = new Date().getUTCHours();
    if (h >= 4 && h < 11) return 'breakfast';
    if (h >= 11 && h < 15) return 'lunch';
    if (h >= 17 && h < 22) return 'dinner';
    return 'snack';
  }

  private static gatewayOptions(
    userId: string,
    source: 'photo' | 'voice' | 'item',
  ): { sort: 'ttft'; user: string; tags: string[] } {
    return {
      sort: 'ttft',
      user: userId,
      tags: ['nutrition', `source:${source}`],
    };
  }

  /**
   * Generation limits per model. `answerTokens` is what the JSON answer itself needs.
   *
   * Gemini 3 is a reasoning model and its thinking tokens count toward
   * `maxOutputTokens`. With the old flat 2 000 / 800-token cap the model spent the
   * whole budget thinking, the answer was cut off (finishReason "length"), the SDK
   * had nothing to parse, and every fallback ended in AI_NoOutputGeneratedError
   * with zero diagnostics — so the fallback never actually rescued anything
   * (2026-09-16 item, 2026-09-22 photo). Ask Gemini for minimal thinking and leave
   * headroom for whatever it still spends.
   */
  /** The photo system prompt for a named variant (eval harness `--prompt=`); unknown ids → production. */
  static photoPromptVariant(id?: string): string {
    return PHOTO_PROMPT_VARIANTS[id ?? 'production'] ?? SYSTEM_PROMPT;
  }

  static modelCallOptions(model: string, answerTokens: number): {
    maxOutputTokens: number;
    providerOptions: Record<string, Record<string, unknown>>;
    /**
     * false → call the model in plain JSON mode (no json_schema response_format) and describe
     * the shape in the prompt instead. Qwen 3.8 Flash answered a bare `[]` (2 output tokens)
     * on a third of plates when the gateway sent our schema (2026-10-14 screen); in plain JSON
     * mode the same plates parse. Our Zod parse + repairPhotoJson still validate the reply.
     */
    nativeSchema: boolean;
  } {
    const isGemini = model.startsWith('google/gemini');
    // OpenAI reasoning models (gpt-5.x) also spend output budget on reasoning, and their
    // strict structured-output mode rejects our self-healing schema (z.preprocess fields are
    // not "required" in the generated JSON schema) — so ask for low effort, extra headroom and
    // non-strict schema validation; our Zod parse still validates the answer.
    const isOpenAI = model.startsWith('openai/');
    // Gemini 3.5+ / 4 reject thinkingLevel "minimal" (400 "Thinking level MINIMAL is not
    // supported"); "low" is their floor. Gemini 3 / 3.1 accept "minimal".
    const geminiThinking = /gemini-(3\.[5-9]|[4-9])/.test(model) ? 'low' : 'minimal';
    // Open-weight-style vendors on the gateway (Qwen, Kimi, GLM, DeepSeek, StepFun) reason by
    // default: with our prompt that is 2–3k thinking tokens and 20–40 s per call, past the
    // 28 s abort (every Qwen call "timed out" in the 2026-10-14 bake-off), and Kimi spends
    // the whole output budget thinking and returns nothing. Each vendor only honours its own
    // switch (probed 2026-10-14 via @ai-sdk/gateway providerOptions keyed by vendor slug).
    const vendor = model.split('/')[0];
    const thinkingOff: Record<string, Record<string, unknown>> = {
      alibaba: { enableThinking: false },
      stepfun: { enableThinking: false },
      moonshotai: { thinking: { type: 'disabled' } },
      zai: { thinking: { type: 'disabled' } },
      deepseek: { thinking: { type: 'disabled' } },
    };
    return {
      // Headroom for models that spend output budget on reasoning: Gemini, OpenAI, and the
      // vendors above when their switch is not honoured (GLM 5.3 Flash still "thinks" ~1.4k
      // tokens with thinking disabled and hit the 2k cap on 7/100 plates, 2026-10-14).
      maxOutputTokens: isGemini || isOpenAI || thinkingOff[vendor] ? answerTokens + 4_000 : answerTokens,
      nativeSchema: !thinkingOff[vendor],
      providerOptions: thinkingOff[vendor]
        ? { [vendor]: thinkingOff[vendor] }
        : isGemini
        ? {
            // Schema-in-prompt rather than Gemini's native responseSchema. In native mode
            // every Gemini 3.x model sometimes emits a runaway decimal ("2.5000000…" for
            // thousands of tokens) until the output cap kills the parse — 1/12 on 3-flash
            // and 3.8-flash, 8/12 on 3.1-flash-lite, 7/12 on 3.5-flash (2026-10-14 eval).
            // With the schema in the prompt the models write ordinary JSON; combined with
            // repairPhotoJson (they like a bare array with `foodName`) that is 0–1/12.
            // NUTRITION_GEMINI_NATIVE_SCHEMA=true restores native mode for comparison.
            google: {
              thinkingConfig: { thinkingLevel: geminiThinking, includeThoughts: false },
              ...(process.env.NUTRITION_GEMINI_NATIVE_SCHEMA === 'true' ? {} : { structuredOutputs: false }),
            },
          }
        : isOpenAI
          ? { openai: { reasoningEffort: 'low', strictJsonSchema: false } }
          : {},
    };
  }

  /**
   * `result.output` throws a bare AI_NoOutputGeneratedError whenever the step did
   * not end with finishReason "stop" (the SDK only parses the object then). Turn
   * that into an error that says WHY — length cut-off, content filter, tool call —
   * with the usage numbers, so the parse-failure log is actionable.
   */
  static outputOrThrow<T>(
    result: { finishReason: string; output: T; usage?: unknown; text?: string },
    model: string,
  ): T {
    if (result.finishReason !== 'stop') {
      const err = new Error(
        `${model} ended with finishReason=${result.finishReason} before a complete object was produced`,
      ) as Error & { finishReason?: string; usage?: unknown; text?: string };
      err.name = 'IncompleteOutputError';
      err.finishReason = result.finishReason;
      err.usage = result.usage;
      err.text = result.text;
      throw err;
    }
    return result.output;
  }

  /**
   * Second chance for a reply that is good JSON but not quite our shape. Seen in the eval
   * (2026-10-14): Gemini in prompt-schema mode returns a bare ARRAY of items with keys like
   * `foodName` / `foodItem`; other models occasionally wrap JSON in ``` fences or use
   * snake_case macro keys. The Zod schema still validates the repaired object, so nothing
   * unvalidated reaches the client; this only rescues parses we would otherwise throw away.
   */
  static repairPhotoJson(text: string | undefined | null): PhotoParseResult | null {
    if (!text) return null;
    const stripped = text.replace(/```(?:json)?/gi, '').trim();
    const start = Math.min(
      ...['{', '['].map((ch) => stripped.indexOf(ch)).filter((i) => i >= 0),
    );
    if (!Number.isFinite(start)) return null;
    const last = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'));
    if (last <= start) return null;
    let parsed: unknown;
    const candidate = stripped.slice(start, last + 1);
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // Trailing commas before a closing bracket are the usual culprit.
      try {
        parsed = JSON.parse(candidate.replace(/,\s*([\]}])/g, '$1'));
      } catch {
        return null;
      }
    }

    const NAME_KEYS = ['name', 'foodName', 'food_name', 'foodItem', 'food_item', 'food', 'item', 'label', 'title'];
    const ALIASES: Record<string, string[]> = {
      calories: ['calories', 'kcal', 'energyKcal', 'energy_kcal', 'calories_kcal'],
      proteinG: ['proteinG', 'protein_g', 'protein'],
      carbsG: ['carbsG', 'carbs_g', 'carbs', 'carbohydratesG', 'carbohydrates_g', 'carbohydrates'],
      fatG: ['fatG', 'fat_g', 'fat', 'totalFatG'],
      fiberG: ['fiberG', 'fiber_g', 'fiber', 'fibreG', 'fibre'],
      sugarG: ['sugarG', 'sugar_g', 'sugar', 'sugarsG', 'sugars'],
      sodiumMg: ['sodiumMg', 'sodium_mg', 'sodium'],
      gramsPerUnit: ['gramsPerUnit', 'grams_per_unit', 'gramPerUnit'],
      servingUnit: ['servingUnit', 'serving_unit', 'unit'],
      quantityRange: ['quantityRange', 'quantity_range', 'range'],
      grams: ['grams', 'totalGrams', 'total_grams', 'weightG', 'weight_g', 'weightGrams'],
      quantity: ['quantity', 'qty', 'amount', 'count'],
      confidence: ['confidence', 'itemConfidence'],
    };
    const normalizeItem = (raw: unknown): Record<string, unknown> | null => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const o = raw as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of NAME_KEYS) if (typeof o[k] === 'string' && o[k]) { out.name = o[k]; break; }
      for (const [canon, keys] of Object.entries(ALIASES)) {
        for (const k of keys) if (o[k] !== undefined) { out[canon] = o[k]; break; }
      }
      return out;
    };

    let obj: Record<string, unknown>;
    if (Array.isArray(parsed)) {
      obj = { items: parsed };
    } else if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const itemsKey = ['items', 'foods', 'foodItems', 'food_items', 'components', 'ingredients'].find((k) => Array.isArray(o[k]));
      obj = { ...o, items: itemsKey ? o[itemsKey] : [] };
    } else {
      return null;
    }
    const items = (obj.items as unknown[]).map(normalizeItem).filter((x): x is Record<string, unknown> => !!x);
    if (items.length === 0) return null;
    if (obj.overallConfidence === undefined) {
      const confs = items.map((it) => Number(it.confidence)).filter((n) => Number.isFinite(n));
      obj.overallConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5;
    }
    if (obj.notes === undefined) obj.notes = null;
    const safe = photoParseResultSchema.safeParse({ ...obj, items });
    // The schema drops nameless items; a repair that leaves nothing nameable is no repair.
    return safe.success && safe.data.items.length > 0 ? safe.data : null;
  }

  private static async callPhotoModel(
    model: string,
    userId: string,
    system: string,
    prompt: string,
    images: ParsePhotoImage[],
    timeoutMs: number,
  ): Promise<{ result: PhotoParseResult; usage: ModelUsage }> {
    const limits = this.modelCallOptions(model, 2_000);
    const usageOf = (u: { inputTokens?: number; outputTokens?: number } | undefined): ModelUsage => ({
      inputTokens: u?.inputTokens ?? undefined,
      outputTokens: u?.outputTokens ?? undefined,
    });
    let result;
    try {
      result = await generateText({
        model,
        output: limits.nativeSchema ? PHOTO_OUTPUT : PHOTO_OUTPUT_JSON_MODE,
        system: limits.nativeSchema ? system : `${system} ${RESPONSE_SHAPE_PROMPT}`,
        maxRetries: 0,
        timeout: timeoutMs,
        maxOutputTokens: limits.maxOutputTokens,
        providerOptions: {
          ...limits.providerOptions,
          gateway: this.gatewayOptions(userId, 'photo'),
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((img) => ({
                type: 'image' as const,
                image: img.bytes,
                mediaType: img.mimeType,
              })),
            ],
          },
        ],
      });
    } catch (err) {
      // generateText itself throws NoObjectGeneratedError when the completed reply fails the
      // schema; it carries the raw text, so a near-miss shape gets one repair attempt here.
      const e = err as { text?: string; finishReason?: string; usage?: ModelUsage };
      if (e?.text && (e.finishReason == null || e.finishReason === 'stop')) {
        const repaired = this.repairPhotoJson(e.text);
        if (repaired) return { result: repaired, usage: usageOf(e.usage) };
      }
      throw err;
    }
    const usage = usageOf(result.usage);
    try {
      return { result: this.outputOrThrow(result, model), usage };
    } catch (err) {
      // Same second chance for the lazy `.output` path.
      if (result.finishReason === 'stop') {
        const repaired = this.repairPhotoJson((err as { text?: string })?.text ?? result.text);
        if (repaired) return { result: repaired, usage };
      }
      throw err;
    }
  }

  private static async callVoiceModel(
    model: string,
    userId: string,
    transcript: string,
    timeoutMs: number,
  ): Promise<PhotoParseResult> {
    const limits = this.modelCallOptions(model, 2_000);
    const result = await generateText({
      model,
      output: Output.object({ schema: photoParseResultSchema }),
      system: VOICE_SYSTEM_PROMPT,
      maxRetries: 0,
      timeout: timeoutMs,
      maxOutputTokens: limits.maxOutputTokens,
      providerOptions: {
        ...limits.providerOptions,
        gateway: this.gatewayOptions(userId, 'voice'),
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Parse this spoken food description into items with estimated quantities and macros:\n\n"${transcript}"`,
            },
          ],
        },
      ],
    });
    return this.outputOrThrow(result, model);
  }

  private static async callItemModel(
    model: string,
    userId: string,
    name: string,
    portion: string,
    timeoutMs: number,
  ): Promise<ParsedFoodItem> {
    const limits = this.modelCallOptions(model, 800);
    const result = await generateText({
      model,
      output: Output.object({ schema: parsedFoodItemSchema }),
      system: ITEM_SYSTEM_PROMPT,
      maxRetries: 0,
      timeout: timeoutMs,
      maxOutputTokens: limits.maxOutputTokens,
      providerOptions: {
        ...limits.providerOptions,
        gateway: this.gatewayOptions(userId, 'item'),
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Estimate the nutrition for: "${name}". Portion: ${portion}.`,
            },
          ],
        },
      ],
    });
    return this.outputOrThrow(result, model);
  }

  private static async finalizeEstimatedItem(
    userId: string,
    name: string,
    portion: { grams?: number; quantity?: number; servingUnit?: string },
    llm: ParsedFoodItem,
  ): Promise<NutritionDraftItem> {
    // Honour the normalized explicit portion as the source of truth and scale the
    // generated nutrients to it before DB grounding.
    const targetGrams = portion.grams ?? this.effectiveGrams(llm);
    const item: ParsedFoodItem = {
      ...llm,
      name: name || llm.name,
      quantity: portion.quantity ?? llm.quantity,
      servingUnit: portion.servingUnit ?? llm.servingUnit,
      grams: targetGrams,
      gramsPerUnit:
        portion.quantity && targetGrams > 0 ? targetGrams / portion.quantity : llm.gramsPerUnit,
    };
    if (llm.grams > 0 && targetGrams > 0 && Math.abs(targetGrams - llm.grams) > 0.5) {
      const factor = targetGrams / llm.grams;
      const scale = (n: number) => Math.round(n * factor * 10) / 10;
      item.calories = scale(llm.calories);
      item.proteinG = scale(llm.proteinG);
      item.carbsG = scale(llm.carbsG);
      item.fatG = scale(llm.fatG);
      item.fiberG = scale(llm.fiberG);
      item.sugarG = scale(llm.sugarG);
      item.sodiumMg = scale(llm.sodiumMg);
    }

    const [grounded] = await this.groundItems(userId, [item]);
    return grounded;
  }

  private static async toDraft(
    userId: string,
    result: PhotoParseResult,
    model: string,
    cachedFlag: boolean,
    inputMethod: NutritionDraftDTO['inputMethod'],
    nutritionSource: NutritionDraftDTO['nutritionSource'],
    grounding?: GroundingMode,
  ): Promise<NutritionDraftDTO & { dbKcalPer100g?: Array<number | null> }> {
    // Ground each parsed item against the foods DB where we can confidently match; the
    // reference row supplies provenance, sodium and unit weights, and replaces the model's
    // macros only when the model's density is implausible (NutritionGroundingService).
    const { items, dbKcalPer100g } = await this.groundItemsByMode(userId, result.items, grounding);

    const totals = items.reduce(
      (acc, it) => ({
        calories: acc.calories + it.calories,
        proteinG: acc.proteinG + it.proteinG,
        carbsG: acc.carbsG + it.carbsG,
        fatG: acc.fatG + it.fatG,
        fiberG: acc.fiberG + it.fiberG,
        sugarG: acc.sugarG + it.sugarG,
        sodiumMg: acc.sodiumMg + it.sodiumMg,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0 }
    );
    return {
      items,
      overallConfidence: result.overallConfidence,
      notes: result.notes,
      inputMethod,
      nutritionSource,
      model,
      cached: cachedFlag,
      totals,
      healthScore: this.healthScore(totals),
      ...(dbKcalPer100g ? { dbKcalPer100g } : {}),
    };
  }

  // MARK: - DB grounding (PRD §7.2.1 single-source-of-truth)

  /**
   * 'generic' (default): NutritionGroundingService — generic USDA layer + model picker +
   * portion priors (Phase 1). 'legacy': the Dice-floor grounding below over the whole foods
   * table, kept for A/B evals. 'off': the model's own numbers.
   */
  private static async groundItemsByMode(
    userId: string,
    items: ParsedFoodItem[],
    mode: GroundingMode = NutritionGroundingService.modeFromEnv(),
  ): Promise<{ items: NutritionDraftItem[]; dbKcalPer100g?: Array<number | null> }> {
    if (mode === 'legacy') return { items: await this.groundItems(userId, items) };
    try {
      const { items: grounded, stats } = await NutritionGroundingService.ground(userId, items, { mode });
      return { items: grounded, dbKcalPer100g: stats.dbKcalPer100g };
    } catch (err) {
      console.warn('[nutrition] generic grounding failed, keeping model estimates:', (err as Error)?.message);
      const { items: plain } = await NutritionGroundingService.ground(userId, items, { mode: 'off' });
      return { items: plain };
    }
  }

  /**
   * For each parsed item, look it up in the foods DB and — when we find a
   * confident name match — recompute its macros from the DB's per-100g panel
   * scaled by the estimated grams. The LLM's portion estimate (grams) is kept;
   * only the *nutrient density* is upgraded to DB-grade. Sodium isn't in the
   * foods table, so the model's sodium estimate is retained.
   *
   * Failure-isolated and parallel: a search error just leaves that item on the
   * model's own numbers.
   */
  private static async groundItems(
    userId: string,
    items: ParsedFoodItem[]
  ): Promise<NutritionDraftItem[]> {
    // Semantic candidate retrieval for the whole plate in one shot (one embedMany call +
    // a KNN per item). Returns null when semantic matching is disabled / unavailable, in
    // which case we ground on lexical search alone (the previous behaviour).
    let semanticByIndex: Array<SemanticCandidate[]> | null = null;
    try {
      semanticByIndex = await FoodsSemanticService.searchMany(userId, items.map((it) => it.name));
    } catch {
      semanticByIndex = null;
    }

    return Promise.all(
      items.map(async (it, idx) => {
        const grams = this.effectiveGrams(it);
        let match: FoodDTO | null = null;
        try {
          // Hybrid: combine semantic KNN candidates with the lexical (FTS/trigram) ones,
          // then re-rank by semantic + lexical + source before grounding.
          const lexical = await FoodsService.search(userId, { query: it.name, limit: 5 });
          match = this.pickBest(it.name, semanticByIndex?.[idx] ?? null, lexical);
        } catch {
          match = null;
        }

        if (match && grams > 0 && match.per100g.calories != null) {
          const f = grams / 100;
          const r = (n: number | null | undefined) => Math.round(((n ?? 0) * f) * 10) / 10;
          return {
            ...it,
            grams,
            calories: r(match.per100g.calories),
            proteinG: r(match.per100g.proteinG),
            carbsG: r(match.per100g.carbsG),
            fatG: r(match.per100g.fatG),
            fiberG: r(match.per100g.fiberG),
            sugarG: r(match.per100g.sugarG),
            sodiumMg: it.sodiumMg, // foods table has no sodium → keep the model's estimate
            matchedFoodId: match.id,
            itemSource: 'foods_db' as const,
            unitOptions: this.unitOptionsFor(it, match),
          };
        }

        return {
          ...it,
          grams: grams || it.grams,
          matchedFoodId: null,
          itemSource: 'llm_vision' as const,
          unitOptions: this.unitOptionsFor(it, null),
        };
      })
    );
  }

  /** Best gram estimate for an item: explicit grams, else quantity × gramsPerUnit. */
  private static effectiveGrams(it: ParsedFoodItem): number {
    if (it.grams > 0) return it.grams;
    if (it.quantity > 0 && it.gramsPerUnit > 0) return it.quantity * it.gramsPerUnit;
    return it.grams;
  }

  // Acceptance floors (tunable — gate changes on the §8.3 eval, esp. dbMatchCoverage and
  // cal-within-±40%). A match is accepted on a strong SEMANTIC match OR a strong LEXICAL
  // match; the combined score only decides WHICH candidate wins. Grounding to a wrong food
  // (e.g. "sour cream or yogurt" → "sour cream") is worse than keeping the model's estimate,
  // so both floors stay conservative.
  private static readonly SEMANTIC_FLOOR = 0.5; // cosine similarity (text-embedding-3-small)
  private static readonly LEXICAL_FLOOR = 0.6;  // token Sørensen–Dice

  /**
   * Pick the best DB candidate for a parsed name from the union of semantic (vector KNN) and
   * lexical (FTS/trigram) candidates, or null when none is close enough. Re-ranks by a blend
   * of semantic similarity + lexical Dice + a small boost for the user's own/verified foods.
   * Falls back to lexical-only when `semantic` is null (semantic matching off/unavailable).
   */
  private static pickBest(
    name: string,
    semantic: SemanticCandidate[] | null,
    lexical: FoodDTO[],
  ): FoodDTO | null {
    // Union the two candidate pools by food id, carrying the semantic score (0 for
    // lexical-only candidates, which have no embedding score).
    const byId = new Map<string, { food: FoodDTO; sem: number }>();
    for (const c of semantic ?? []) byId.set(c.food.id, { food: c.food, sem: c.semanticScore });
    for (const f of lexical) if (!byId.has(f.id)) byId.set(f.id, { food: f, sem: 0 });

    let best: FoodDTO | null = null;
    let bestScore = 0;
    let bestSem = 0;
    let bestDice = 0;
    for (const { food, sem } of byId.values()) {
      const dice = this.diceSimilarity(name, food.name);
      const sourceBoost = food.source === 'custom' || food.source === 'recipe' ? 0.08 : 0;
      const score = 0.55 * sem + 0.45 * dice + sourceBoost;
      if (score > bestScore) {
        bestScore = score;
        best = food;
        bestSem = sem;
        bestDice = dice;
      }
    }

    if (best && (bestSem >= this.SEMANTIC_FLOOR || bestDice >= this.LEXICAL_FLOOR)) return best;
    return null;
  }

  private static tokens(s: string): Set<string> {
    return new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1)
    );
  }

  private static diceSimilarity(a: string, b: string): number {
    const ta = this.tokens(a);
    const tb = this.tokens(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return (2 * inter) / (ta.size + tb.size);
  }

  /** Measurement choices for the client's unit picker: the natural unit, grams, oz,
   *  plus the matched food's serving unit when known. Deduped by label. */
  private static unitOptionsFor(it: ParsedFoodItem, match: FoodDTO | null): UnitOption[] {
    const out: UnitOption[] = [];
    const push = (label: string, gramsPerUnit: number) => {
      const key = label.trim().toLowerCase();
      if (!key || out.some((o) => o.label.toLowerCase() === key)) return;
      out.push({ label, gramsPerUnit });
    };
    const natural = it.servingUnit?.trim();
    if (natural && natural.toLowerCase() !== 'g') {
      push(natural, it.gramsPerUnit > 0 ? it.gramsPerUnit : this.effectiveGrams(it) || 1);
    }
    push('g', 1);
    push('oz', 28.3495);
    if (match?.servingUnit && match.servingSizeG) {
      push(match.servingUnit, match.servingSizeG);
    }
    return out;
  }

  /**
   * Heuristic 0–10 per-meal health score (the competitor surfaces one). Rewards
   * protein and fiber density, penalises high added sugar and sodium. This is a
   * presentation aid, not a clinical metric.
   */
  private static healthScore(t: {
    calories: number;
    proteinG: number;
    fiberG: number;
    sugarG: number;
    sodiumMg: number;
  }): number | null {
    if (t.calories <= 0) return null;
    let score = 5;
    const per1000 = 1000 / t.calories;
    score += Math.min(2, (t.proteinG * per1000) / 25); // protein density (g per 1000 kcal)
    score += Math.min(2, (t.fiberG * per1000) / 14); // fiber density
    score -= Math.min(2, (t.sugarG * per1000) / 50); // sugar penalty
    score -= Math.min(2, (t.sodiumMg * per1000) / 2300); // sodium penalty
    return Math.max(0, Math.min(10, Math.round(score)));
  }

  /** Look up a previously-parsed identical image (content-hash cache). */
  private static async getCachedResult(imageHash: string): Promise<PhotoParseResult | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('nutrition_parse_cache')
      .select('result')
      .eq('image_hash', imageHash)
      .maybeSingle();
    if (!data?.result) return null;
    const parsed = photoParseResultSchema.safeParse(data.result);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Pull the diagnostically useful fields out of whatever `generateText` threw so a
   * parse failure produces ONE structured, greppable log line we can analyse and
   * alert on. Duck-typed (no `ai` SDK class imports) to stay robust across versions.
   * NEVER includes raw model input (image bytes, transcripts) — only metadata.
   *
   * Classifies the failure into `kind` so we can group them:
   *  - `timeout_or_abort`   — our AbortSignal.timeout fired (model too slow)
   *  - `api_call_error`     — gateway/provider HTTP error (APICallError: statusCode/url)
   *  - `no_object_generated`— model replied but its output failed schema validation
   *  - `schema_validation`  — Zod/type validation error
   *  - `unknown`            — anything else
   */
  private static describeParseError(err: unknown): Record<string, unknown> {
    const e = err as any;
    const name: string = e?.name ?? 'Error';
    const message: string = e?.message ?? String(err);

    // The AI SDK prefixes its error class names with `AI_` (AI_NoOutputGeneratedError,
    // AI_TypeValidationError, …), so match on the unprefixed name or every one of
    // these lands in `unknown` — which is what happened to AI_NoOutputGeneratedError:
    // it opened a NEW high-priority Sentry issue instead of grouping with the
    // known parse failures.
    const bareName = name.replace(/^AI_/, '');

    let kind = 'unknown';
    if (/Abort|Timeout/i.test(name) || /abort|timed?\s?out/i.test(message)) {
      kind = 'timeout_or_abort';
    } else if (bareName === 'IncompleteOutputError') {
      // Our own guard: the model stopped for a reason other than "stop" (length,
      // content-filter, …) so there was no complete object to validate.
      kind = 'incomplete_output';
    } else if (e?.statusCode != null || e?.url != null) {
      kind = 'api_call_error';
    } else if (
      // NoObjectGenerated is the `generateObject` shape; NoOutputGenerated is the
      // `generateText` + Output.object shape we actually use. Both mean the same
      // thing: the model returned nothing that satisfies the schema.
      bareName === 'NoObjectGeneratedError' ||
      bareName === 'NoOutputGeneratedError' ||
      e?.text != null
    ) {
      kind = 'no_object_generated';
    } else if (bareName === 'TypeValidationError' || bareName === 'ZodError') {
      kind = 'schema_validation';
    }

    const truncate = (s: unknown, n = 600): string | undefined =>
      typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…(+${s.length - n} more)` : s) : undefined;

    return {
      kind,
      name,
      message,
      statusCode: e?.statusCode,
      url: e?.url,
      isRetryable: e?.isRetryable,
      finishReason: e?.finishReason,
      usage: e?.usage,
      // NoObjectGeneratedError carries the raw text the model produced that failed validation.
      modelText: truncate(e?.text),
      responseBody: truncate(e?.responseBody),
      causeName: e?.cause?.name,
      causeMessage: truncate(e?.cause?.message, 300),
      // For a schema rejection the useful part is WHICH fields failed, not the
      // first 300 chars of the model's JSON. NoObjectGeneratedError → cause is a
      // TypeValidationError → its cause is the ZodError with `issues`.
      issues: this.validationIssues(e),
    };
  }

  /** `[{ path, code, message }]` from a nested ZodError, if there is one. */
  private static validationIssues(e: any): Array<{ path: string; code: string; message: string }> | undefined {
    const candidates = [e?.cause?.cause?.issues, e?.cause?.issues, e?.issues];
    const issues = candidates.find((c) => Array.isArray(c) && c.length > 0);
    if (!issues) return undefined;
    return issues.slice(0, 10).map((i: any) => ({
      path: Array.isArray(i?.path) ? i.path.join('.') : String(i?.path ?? ''),
      code: String(i?.code ?? ''),
      message: String(i?.message ?? ''),
    }));
  }

  /**
   * Emit one structured log line for a failed AI parse. Tagged `[nutrition-parse-failure]`
   * so it can be grepped/alerted on. `input` holds non-sensitive request metadata
   * (sizes, hashes, item name) — never raw photos or transcripts.
   */
  private static logParseFailure(
    source: 'photo' | 'voice' | 'item',
    userId: string,
    model: string,
    durationMs: number,
    input: Record<string, unknown>,
    err: unknown
  ): void {
    const detail = this.describeParseError(err);
    console.error(
      '[nutrition-parse-failure]',
      JSON.stringify({
        source,
        userId,
        model,
        durationMs,
        input,
        error: detail,
        at: new Date().toISOString(),
      })
    );

    // Also report to Sentry (no-op until SENTRY_DSN is configured). Tags drive
    // grouping/filtering by where it failed and our classified failure `kind`.
    //
    // `warning`, not `error`: by the time we get here the failure is fully
    // handled — the caller converts it to ParseFailed, the route saves the photo
    // as a blank entry and returns 422, and the client drops the user into that
    // entry to fill in manually. A model that can't read one photo is an expected
    // operating condition, not a defect. Reporting it at `error` made every
    // unreadable photo page as a high-priority new issue.
    Sentry.captureException(err, {
      level: 'warning',
      tags: {
        feature: 'nutrition_parse',
        parse_source: source,
        parse_error_kind: String(detail.kind),
      },
      extra: { model, durationMs, input, ...detail },
      user: { id: userId },
    });
  }

  /** Log the call (cap accounting) + cache the result by image hash. Failure-isolated. */
  private static async recordParse(userId: string, imageHash: string, result: PhotoParseResult): Promise<void> {
    const supabase = createAdminSupabase();
    try {
      await supabase.from('nutrition_parse_log').insert({ user_id: userId, image_hash: imageHash });
      await supabase
        .from('nutrition_parse_cache')
        .upsert({ image_hash: imageHash, result }, { onConflict: 'image_hash' });
    } catch (err) {
      // Non-blocking: a logging/cache failure must not fail the user's parse.
      console.error('[NutritionIntelligenceService.recordParse] non-fatal:', err);
    }
  }

  /** Log a parse call (accounting/observability only; no cache write). Failure-isolated. */
  private static async recordParseLog(userId: string, hash: string): Promise<void> {
    const supabase = createAdminSupabase();
    try {
      await supabase.from('nutrition_parse_log').insert({ user_id: userId, image_hash: hash });
    } catch (err) {
      // Non-blocking: a logging failure must not fail the user's parse.
      console.error('[NutritionIntelligenceService.recordParseLog] non-fatal:', err);
    }
  }
}
