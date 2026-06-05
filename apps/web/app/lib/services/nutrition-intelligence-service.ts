import { createHash } from 'crypto';

import { generateText, Output } from 'ai';

import { createAdminSupabase } from '../supabase-admin';
import {
  type NutritionDraftDTO,
  type PhotoParseResult,
  photoParseResultSchema,
  PHOTO_PARSE_DAILY_SOFT_CAP,
} from '../types/nutrition';

import { FoodLogService } from './food-log-service';
import { FoodLogImageService } from './food-log-image-service';

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

const VOICE_SYSTEM_PROMPT = [
  'You are a nutrition estimation assistant. The user spoke a description of what they ate and it',
  'was transcribed to text. Parse that text into every distinct food item with estimated quantity and macros.',
  'Rules:',
  '- Estimate, never claim exactness. Infer reasonable quantities from the words: "two eggs" → quantity 2,',
  '  servingUnit "egg"; "a bowl of rice" → a typical bowl. When the amount is vague or unstated, set',
  '  quantityRange {min,max} to a plausible span and quantity to its midpoint; when the speaker gave a clear',
  '  count or measure, set quantityRange to null.',
  '- Macros (calories, proteinG, carbsG, fatG) are for the WHOLE item at the estimated quantity.',
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
      return this.toDraft(cached, VISION_MODEL, true, 'photo', 'llm_vision');
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

    return this.toDraft(result, VISION_MODEL, false, 'photo', 'llm_vision');
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

    return this.toDraft(result, VOICE_MODEL, false, 'voice', 'llm_voice');
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

  private static toDraft(
    result: PhotoParseResult,
    model: string,
    cachedFlag: boolean,
    inputMethod: NutritionDraftDTO['inputMethod'],
    nutritionSource: NutritionDraftDTO['nutritionSource'],
  ): NutritionDraftDTO {
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
      inputMethod,
      nutritionSource,
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
