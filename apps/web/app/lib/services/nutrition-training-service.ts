import { createHash } from 'crypto';

import { createAdminSupabase } from '../supabase-admin';
import type { NutritionDraftDTO } from '../types/nutrition';

import {
  diffDraftAndFinal,
  normalizeItems,
  normalizeTotals,
  type Totals,
} from './nutrition-draft-reconcile';

/**
 * Captures (image, original AI draft, user-confirmed labels) so corrections become a
 * labeled dataset AND a production accuracy signal (acceptance rate, kcal delta, per-item
 * edits — by model).
 *
 * Two write paths into `nutrition_training_samples`:
 *  - `capture`      — the legacy client-driven route (image + draft + final in one shot).
 *  - `captureDraft` + `reconcileEntry` — server-driven (migration 097): the parse route
 *    writes the draft row after responding; the food-log create route links the entry the
 *    user then saves. Needs no client change.
 *
 * Gated by NUTRITION_TRAINING_CAPTURE === 'true' (off by default). Everything here is
 * best-effort / failure-isolated — a capture problem must never affect the user's food log.
 *
 * Privacy: the server-driven path stores NO images. AI data-sharing consent is held
 * client-side only (iOS AIConsent, UserDefaults) — there is no server-side flag to check,
 * so photos are only ever stored by the client route, which the apps call only with consent.
 */
export class NutritionTrainingService {
  /** How long after a parse a saved entry may still be linked to it. */
  static readonly RECONCILE_WINDOW_MS = 3 * 60 * 60 * 1000;
  /** Without an item breakdown, only a save this soon after the parse is trusted as "the same meal". */
  static readonly TOTALS_ONLY_WINDOW_MS = 30 * 60 * 1000;

  static get enabled(): boolean {
    return process.env.NUTRITION_TRAINING_CAPTURE === 'true';
  }

  static async capture(params: {
    userId: string;
    inputMethod: string;
    model: string | null;
    overallConfidence: number | null;
    wasEdited: boolean;
    parsedItems: unknown[];
    finalItems: unknown[];
    imageBytes: Buffer | null;
    mimeType: string | null;
  }): Promise<void> {
    if (!this.enabled) return;

    const supabase = createAdminSupabase();

    // 1. Store the image once, keyed by content hash (dedupes identical photos).
    let imagePath: string | null = null;
    try {
      if (params.imageBytes && params.imageBytes.length > 0) {
        const hash = createHash('sha256').update(params.imageBytes).digest('hex');
        const ext = params.mimeType?.includes('png') ? 'png' : 'jpg';
        imagePath = `${params.userId}/${hash}.${ext}`;
        const { error } = await supabase.storage
          .from('nutrition-training')
          .upload(imagePath, params.imageBytes, {
            contentType: params.mimeType ?? 'image/jpeg',
            upsert: true,
          });
        if (error) imagePath = null;
      }
    } catch (err) {
      console.error('[NutritionTrainingService] image upload failed (non-fatal):', err);
      imagePath = null;
    }

    // 2. Insert the labeled row.
    try {
      await supabase.from('nutrition_training_samples').insert({
        user_id: params.userId,
        input_method: params.inputMethod,
        model: params.model,
        overall_confidence: params.overallConfidence,
        was_edited: params.wasEdited,
        parsed_items: params.parsedItems,
        final_items: params.finalItems,
        image_path: imagePath,
        reconciled_at: new Date().toISOString(),
        link_basis: 'client',
      });
    } catch (err) {
      console.error('[NutritionTrainingService] insert failed (non-fatal):', err);
    }
  }

  /**
   * Server-side draft capture: called from the parse routes (inside `after()`) with the
   * draft that was just returned to the client. Writes one unreconciled row; no image.
   */
  static async captureDraft(params: {
    userId: string;
    draft: NutritionDraftDTO;
    latencyMs: number;
    imageCount: number | null;
  }): Promise<void> {
    if (!this.enabled) return;
    try {
      const { draft } = params;
      const supabase = createAdminSupabase();
      const { error } = await supabase.from('nutrition_training_samples').insert({
        user_id: params.userId,
        input_method: draft.inputMethod,
        model: draft.model,
        overall_confidence: draft.overallConfidence,
        was_edited: false,
        parsed_items: draft.items,
        final_items: null,
        parse_hash: draft.parseHash ?? null,
        draft_totals: this.totalsJson(normalizeTotals(draft.totals)),
        latency_ms: Math.round(params.latencyMs),
        cached: draft.cached,
        image_count: params.imageCount,
      });
      if (error) console.error('[NutritionTrainingService.captureDraft] insert failed (non-fatal):', error.message);
    } catch (err) {
      console.error('[NutritionTrainingService.captureDraft] failed (non-fatal):', err);
    }
  }

  /**
   * Link a just-saved food-log entry to the user's newest unreconciled draft (if one is
   * recent enough), score the diff, and stamp the entry's provenance columns when the
   * client didn't set them. Called from the create route inside `after()`.
   *
   * `entry` is the stored row (typed macro columns + nutrition_data); `explicit` carries
   * any provenance the client sent itself (explicit values win over inference).
   */
  static async reconcileEntry(
    userId: string,
    entry: {
      id: string;
      entry_type?: string | null;
      created_at?: string | null;
      calories?: number | null;
      protein_g?: number | null;
      carbs_g?: number | null;
      fat_g?: number | null;
      nutrition_data?: Record<string, unknown> | null;
    },
    explicit: { input_method?: string; nutrition_source?: string; llm_confidence?: number } = {},
  ): Promise<void> {
    if (!this.enabled) return;
    if (entry.entry_type && entry.entry_type !== 'food') return;
    try {
      const supabase = createAdminSupabase();
      const since = new Date(Date.now() - this.RECONCILE_WINDOW_MS).toISOString();
      const { data: draft, error } = await supabase
        .from('nutrition_training_samples')
        .select('id, created_at, input_method, overall_confidence, parsed_items, draft_totals')
        .eq('user_id', userId)
        .is('reconciled_at', null)
        .in('input_method', ['photo', 'voice'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !draft) return;

      const finalItems = normalizeItems(entry.nutrition_data?.items);
      const finalTotals = this.entryTotals(entry);
      const draftItems = normalizeItems(draft.parsed_items);
      const draftTotals = normalizeTotals(draft.draft_totals);

      // Decide whether this entry is plausibly the meal that was parsed.
      let linkBasis: 'items' | 'totals';
      if (finalItems.length > 0) {
        linkBasis = 'items';
      } else if (finalTotals.calories != null) {
        const draftAge = Date.now() - new Date(draft.created_at).getTime();
        if (draftAge > this.TOTALS_ONLY_WINDOW_MS) return;
        linkBasis = 'totals';
      } else {
        return;
      }

      // Without an item breakdown only the plate totals can be compared, so the per-item
      // counters stay null rather than reading "every item removed".
      const diff =
        linkBasis === 'items'
          ? diffDraftAndFinal(draftItems, finalItems, draftTotals, finalTotals)
          : diffDraftAndFinal([], [], draftTotals, finalTotals);
      const itemCounts =
        linkBasis === 'items'
          ? {
              items_matched: diff.itemsMatched,
              items_added: diff.itemsAdded,
              items_removed: diff.itemsRemoved,
              items_renamed: diff.itemsRenamed,
              grams_delta_pct: diff.gramsDeltaPct,
            }
          : { items_matched: null, items_added: null, items_removed: null, items_renamed: null, grams_delta_pct: null };

      await supabase
        .from('nutrition_training_samples')
        .update({
          entry_id: entry.id,
          reconciled_at: new Date().toISOString(),
          link_basis: linkBasis,
          final_items: finalItems.length > 0 ? entry.nutrition_data?.items : [],
          final_totals: this.totalsJson(finalTotals),
          was_edited: diff.wasEdited,
          ...itemCounts,
          kcal_delta_pct: diff.kcalDeltaPct,
        })
        .eq('id', draft.id)
        .is('reconciled_at', null);

      // Provenance on the entry itself (migration 054 columns). Explicit client values win.
      const method = draft.input_method === 'voice' ? 'voice' : 'photo';
      const patch: Record<string, unknown> = {};
      if (!explicit.input_method) patch.input_method = method;
      if (!explicit.nutrition_source) patch.nutrition_source = method === 'voice' ? 'llm_voice' : 'llm_vision';
      if (explicit.llm_confidence == null && draft.overall_confidence != null) {
        patch.llm_confidence = draft.overall_confidence;
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from('food_log_entries').update(patch).eq('id', entry.id).eq('user_id', userId);
      }
    } catch (err) {
      console.error('[NutritionTrainingService.reconcileEntry] failed (non-fatal):', err);
    }
  }

  private static entryTotals(entry: {
    calories?: number | null;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
    nutrition_data?: Record<string, unknown> | null;
  }): Totals {
    const fromColumns = normalizeTotals({
      calories: entry.calories,
      protein_g: entry.protein_g,
      carbs_g: entry.carbs_g,
      fat_g: entry.fat_g,
    });
    if (fromColumns.calories != null) return fromColumns;
    return normalizeTotals(entry.nutrition_data);
  }

  private static totalsJson(t: Totals): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(t)) if (v != null) out[k] = v;
    return Object.keys(out).length > 0 ? out : null;
  }
}
