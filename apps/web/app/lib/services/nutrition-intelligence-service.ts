import { createHash } from 'crypto';

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
  PHOTO_PARSE_DAILY_SOFT_CAP,
} from '../types/nutrition';

import { FoodLogImageService } from './food-log-image-service';
import { FoodLogService } from './food-log-service';
import { FoodsService } from './foods-service';

/**
 * NutritionIntelligenceService — the server-side "brain" for nutrition (PRD §6.1, §7.2.1).
 * Turns a meal photo into a structured, validated nutrition DRAFT via the Vercel AI Gateway
 * vision model. All nutrition logic lives here; clients render the draft and never re-derive it.
 *
 * Confirm-then-commit: this returns a draft only. The user confirms, then the existing
 * food-log create/PATCH route writes the entry (carrying input_method/nutrition_source).
 */

// Newest Anthropic vision model via the AI Gateway (verified against the live model list).
// Gateway auth: AI_GATEWAY_API_KEY env, or Vercel OIDC in deployment.
const VISION_MODEL = 'anthropic/claude-sonnet-4.6';

// Voice parsing is text-only (client did STT) — same model family, no image. Verified current
// against the live AI Gateway model list. p95 target < 1.2s (§7.6) — text is far cheaper/faster.
const VOICE_MODEL = 'anthropic/claude-sonnet-4.6';

const SYSTEM_PROMPT = [
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

export class NutritionIntelligenceService {
  /**
   * Parse a meal photo into a structured nutrition draft.
   * @throws Error('RateLimited') when the per-user daily soft cap is exceeded
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static async parsePhoto(userId: string, imageBytes: Buffer, mimeType: string): Promise<NutritionDraftDTO> {
    // 1. Cost guard — perceptual/content hash cache so an identical photo never re-bills (§7.6).
    const imageHash = createHash('sha256').update(imageBytes).digest('hex');
    const cached = await this.getCachedResult(imageHash);
    if (cached) {
      return await this.toDraft(userId, cached, VISION_MODEL, true, 'photo', 'llm_vision');
    }

    // 2. Per-user daily soft cap on premium vision calls (§9.2). Caching is checked first so
    //    repeat/identical photos don't count against the cap.
    const usedToday = await this.countTodayParses(userId);
    if (usedToday >= PHOTO_PARSE_DAILY_SOFT_CAP) {
      throw new Error('RateLimited');
    }

    // 3. Structured vision call via the AI Gateway. generateText + Output.object validates
    //    the result against the Zod schema (retries internally on malformed output).
    let result: PhotoParseResult;
    try {
      const { output } = await generateText({
        model: VISION_MODEL,
        output: Output.object({ schema: photoParseResultSchema }),
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Identify the foods on this plate and estimate quantities and macros.' },
              { type: 'image', image: imageBytes, mediaType: mimeType },
            ],
          },
        ],
      });
      result = output;
    } catch (err) {
      console.error('[NutritionIntelligenceService.parsePhoto] vision call/validation failed:', err);
      throw new Error('ParseFailed');
    }

    // 4. Record the call (for the daily cap) and cache the result by image hash.
    await this.recordParse(userId, imageHash, result);

    return await this.toDraft(userId, result, VISION_MODEL, false, 'photo', 'llm_vision');
  }

  /**
   * Parse a spoken (client-STT-transcribed) food description into a structured nutrition draft.
   * Text-only — the native Speech framework / Web Speech API ran on the client and produced the
   * transcript; we just turn it into the same draft shape as parsePhoto for confirm-then-commit.
   *
   * No daily soft cap: text parsing is much cheaper than the premium vision call, so it isn't
   * gated by PHOTO_PARSE_DAILY_SOFT_CAP. We still record the call in nutrition_parse_log for
   * accounting/observability (failure-isolated). No content cache: free-text transcripts are
   * near-unique, so a hash cache would rarely hit; cached is always false. p95 target < 1.2s (§7.6).
   *
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static async parseVoice(userId: string, transcript: string): Promise<NutritionDraftDTO> {
    let result: PhotoParseResult;
    try {
      const { output } = await generateText({
        model: VOICE_MODEL,
        output: Output.object({ schema: photoParseResultSchema }),
        system: VOICE_SYSTEM_PROMPT,
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
      result = output;
    } catch (err) {
      console.error('[NutritionIntelligenceService.parseVoice] text call/validation failed:', err);
      throw new Error('ParseFailed');
    }

    // Accounting only (no cap, no cache). The hash is over the transcript so the log row matches
    // the not-null image_hash column convention; it is not used for lookups.
    const transcriptHash = createHash('sha256').update(transcript).digest('hex');
    await this.recordParseLog(userId, transcriptHash);

    return await this.toDraft(userId, result, VOICE_MODEL, false, 'voice', 'llm_voice');
  }

  /**
   * Re-estimate the macros for ONE food the user corrected on the confirm card (§6.1 "tap to fix").
   * The user fixed the name (e.g. the model said "eggplant" but it was "stuffed bitter gourd") and/or
   * set the portion; we re-run the estimate for that exact food + amount and ground it against the
   * foods DB the same way the photo flow does, so the corrected calories/macros are authoritative.
   *
   * Text-only (no premium vision call) → not gated by the daily soft cap.
   *
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static async estimateItem(
    userId: string,
    name: string,
    grams?: number,
    quantity?: number,
    servingUnit?: string,
  ): Promise<NutritionDraftItem> {
    const portionBits: string[] = [];
    if (quantity && quantity > 0) portionBits.push(`${quantity} ${servingUnit?.trim() || 'serving'}`);
    if (grams && grams > 0) portionBits.push(`${Math.round(grams)} g total`);
    const portion = portionBits.length ? portionBits.join(', ') : 'one typical serving';

    let llm: ParsedFoodItem;
    try {
      const { output } = await generateText({
        model: VOICE_MODEL,
        output: Output.object({ schema: parsedFoodItemSchema }),
        system: ITEM_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Estimate the nutrition for: "${name.trim()}". Portion: ${portion}.`,
              },
            ],
          },
        ],
      });
      llm = output;
    } catch (err) {
      console.error('[NutritionIntelligenceService.estimateItem] text call/validation failed:', err);
      throw new Error('ParseFailed');
    }

    // Honour the user's explicit portion as the source of truth: when they gave grams (or a
    // quantity we can map to grams), pin the item to it and scale the model's macros onto that
    // weight, so the returned numbers match exactly the portion shown on the card.
    const targetGrams = grams && grams > 0 ? grams : this.effectiveGrams(llm);
    const item: ParsedFoodItem = {
      ...llm,
      name: name.trim() || llm.name,
      quantity: quantity && quantity > 0 ? quantity : llm.quantity,
      servingUnit: servingUnit?.trim() || llm.servingUnit,
      grams: targetGrams,
      gramsPerUnit:
        quantity && quantity > 0 && targetGrams > 0 ? targetGrams / quantity : llm.gramsPerUnit,
    };
    if (llm.grams > 0 && targetGrams > 0 && Math.abs(targetGrams - llm.grams) > 0.5) {
      const f = targetGrams / llm.grams;
      const r = (n: number) => Math.round(n * f * 10) / 10;
      item.calories = r(llm.calories);
      item.proteinG = r(llm.proteinG);
      item.carbsG = r(llm.carbsG);
      item.fatG = r(llm.fatG);
      item.fiberG = r(llm.fiberG);
      item.sugarG = r(llm.sugarG);
      item.sodiumMg = r(llm.sodiumMg);
    }

    // Ground against the foods DB exactly like the photo flow (DB density wins on a confident match).
    const [grounded] = await this.groundItems(userId, [item]);
    return grounded;
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
    file: File,
    note: string | null,
  ): Promise<{ entryId: string; imageUrls: string[] }> {
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

    const imageUrls: string[] = [];
    try {
      const res = await FoodLogImageService.uploadImage(entry.id, userId, file, 0, supabase);
      const url = res.image?.url ?? res.image?.original_url ?? res.image?.thumbnail_url;
      if (url) imageUrls.push(url);
    } catch (err) {
      // Non-fatal: the entry + text are saved; a failed image upload must not lose them.
      console.error('[NutritionIntelligenceService.saveUnparsedPhoto] image upload failed:', err);
    }

    return { entryId: entry.id, imageUrls };
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

  private static async toDraft(
    userId: string,
    result: PhotoParseResult,
    model: string,
    cachedFlag: boolean,
    inputMethod: NutritionDraftDTO['inputMethod'],
    nutritionSource: NutritionDraftDTO['nutritionSource'],
  ): Promise<NutritionDraftDTO> {
    // Ground each parsed item against the foods DB (authoritative macros) where we
    // can confidently match; otherwise keep the model's estimate.
    const items = await this.groundItems(userId, result.items);

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
    };
  }

  // MARK: - DB grounding (PRD §7.2.1 single-source-of-truth)

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
    return Promise.all(
      items.map(async (it) => {
        const grams = this.effectiveGrams(it);
        let match: FoodDTO | null = null;
        try {
          const candidates = await FoodsService.search(userId, { query: it.name, limit: 5 });
          match = this.pickBestFood(it.name, candidates);
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

  /**
   * Pick the best DB candidate for a parsed name, or null when none is close
   * enough (grounding to a wrong food is worse than keeping the estimate). Uses
   * a token Sørensen–Dice similarity with a 0.6 floor. The floor is deliberately
   * strict: grounding to a wrong DB food (e.g. "sour cream or yogurt" → "sour cream")
   * silently swaps in the wrong nutrient density and is worse than keeping the
   * model's own estimate, so we only ground on a confident name match.
   */
  private static pickBestFood(name: string, candidates: FoodDTO[]): FoodDTO | null {
    let best: FoodDTO | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = this.diceSimilarity(name, c.name);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return bestScore >= 0.6 ? best : null;
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

  /** How many vision parses this user has made today (UTC), for the soft cap. */
  private static async countTodayParses(userId: string): Promise<number> {
    const supabase = createAdminSupabase();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('nutrition_parse_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    return count ?? 0;
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
