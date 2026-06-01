import { createHash } from 'crypto';

import { generateText, Output } from 'ai';

import { createAdminSupabase } from '../supabase-admin';
import {
  type NutritionDraftDTO,
  type PhotoParseResult,
  photoParseResultSchema,
  PHOTO_PARSE_DAILY_SOFT_CAP,
} from '../types/nutrition';

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

const SYSTEM_PROMPT = [
  'You are a nutrition estimation assistant. Given a photo of a meal, identify every distinct',
  'food component and estimate its quantity and macros.',
  'Rules:',
  '- Estimate, never claim exactness. When unsure of a quantity, set quantityRange {min,max} and',
  '  set quantity to the midpoint; when confident, set quantityRange to null.',
  '- Macros (calories, proteinG, carbsG, fatG) are for the WHOLE item at the estimated quantity.',
  '- confidence (per item) and overallConfidence are 0..1.',
  '- Do not invent foods you cannot see. If the plate is unclear, return fewer items with lower confidence.',
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
      return this.toDraft(cached, VISION_MODEL, true);
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

    return this.toDraft(result, VISION_MODEL, false);
  }

  // ---- private helpers -------------------------------------------------------

  private static toDraft(result: PhotoParseResult, model: string, cachedFlag: boolean): NutritionDraftDTO {
    const totals = result.items.reduce(
      (acc, it) => ({
        calories: acc.calories + it.calories,
        proteinG: acc.proteinG + it.proteinG,
        carbsG: acc.carbsG + it.carbsG,
        fatG: acc.fatG + it.fatG,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );
    return {
      items: result.items,
      overallConfidence: result.overallConfidence,
      notes: result.notes,
      inputMethod: 'photo',
      nutritionSource: 'llm_vision',
      model,
      cached: cachedFlag,
      totals,
    };
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
}
