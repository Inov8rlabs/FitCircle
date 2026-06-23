import { createHash } from 'crypto';

import { createAdminSupabase } from '../supabase-admin';

/**
 * Captures (image, original AI draft, user-confirmed labels) from the confirm card so
 * corrections become a labeled dataset for future food-vision fine-tuning / distillation.
 *
 * Gated by NUTRITION_TRAINING_CAPTURE === 'true' (off by default): nothing is stored until
 * the team explicitly enables it AND the privacy policy covers training use of user photos.
 * Everything here is best-effort / failure-isolated — a capture problem must never affect the
 * user's actual food log.
 */
export class NutritionTrainingService {
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
      });
    } catch (err) {
      console.error('[NutritionTrainingService] insert failed (non-fatal):', err);
    }
  }
}
