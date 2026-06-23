import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionTrainingService } from '@/lib/services/nutrition-training-service';

/**
 * POST /api/mobile/food/training-sample
 * Correction "data flywheel": after the user reviews/corrects an AI-parsed meal on the
 * confirm card, the client fires this (best-effort) with the image + original draft +
 * final confirmed labels. Stored only when NUTRITION_TRAINING_CAPTURE is enabled.
 *
 * Multipart form-data: `image` (optional file) + `sample` (JSON string, see schema).
 * Returns 204 when capture is disabled so the client can stop trying.
 */

export const maxDuration = 30;

const sampleSchema = z.object({
  inputMethod: z.string().max(20),
  model: z.string().max(80).nullish(),
  overallConfidence: z.number().min(0).max(1).nullish(),
  wasEdited: z.boolean(),
  parsedItems: z.array(z.unknown()).max(50),
  finalItems: z.array(z.unknown()).max(50),
});

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    // Disabled → no-op (cheap; client treats 204 as "stop sending").
    if (!NutritionTrainingService.enabled) {
      return new NextResponse(null, { status: 204 });
    }

    const formData = await request.formData();

    const rawSample = formData.get('sample');
    if (typeof rawSample !== 'string') {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing sample' } }, { status: 400 });
    }
    let parsedSample: unknown;
    try {
      parsedSample = JSON.parse(rawSample);
    } catch {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid sample JSON' } }, { status: 400 });
    }
    const sample = sampleSchema.safeParse(parsedSample);
    if (!sample.success) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: sample.error.issues[0]?.message ?? 'Invalid sample' } }, { status: 400 });
    }

    const file = formData.get('image');
    let imageBytes: Buffer | null = null;
    let mimeType: string | null = null;
    if (file instanceof File && file.size > 0 && file.size <= MAX_BYTES) {
      imageBytes = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || 'image/jpeg';
    }

    // Best-effort; never blocks the user (the client fires this fire-and-forget anyway).
    await NutritionTrainingService.capture({
      userId: user.id,
      inputMethod: sample.data.inputMethod,
      model: sample.data.model ?? null,
      overallConfidence: sample.data.overallConfidence ?? null,
      wasEdited: sample.data.wasEdited,
      parsedItems: sample.data.parsedItems,
      finalItems: sample.data.finalItems,
      imageBytes,
      mimeType,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, { status: 401 });
    }
    console.error('[Mobile API] Training sample error:', error?.message);
    // Capture failures are non-critical — don't surface a 500 storm to clients.
    return NextResponse.json({ success: true }, { status: 200 });
  }
}
