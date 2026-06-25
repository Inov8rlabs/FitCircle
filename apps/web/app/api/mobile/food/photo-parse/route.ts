import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';

// The vision parse routinely takes 20-40s. Without this, the function is killed at
// the platform default (~10s) and the request appears to "time out". 60s is the max
// allowed on every Vercel plan and leaves headroom for the LLM (≤50s) + DB grounding.
export const maxDuration = 60;

/**
 * POST /api/mobile/food/photo-parse
 * PRD v4 §6.1 / §7.6 — multimodal photo → structured nutrition DRAFT.
 *
 * Multipart form-data, field `image` (jpeg/png/webp/heic). Returns a draft the client shows
 * on a "tap to fix" card; it does NOT create a food log entry. The user confirms, then the
 * existing POST /api/mobile/food-log (or PATCH) commits the entry with the draft's values.
 *
 * Thin route: all nutrition logic lives in NutritionIntelligenceService (§7.2.1).
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 12 * 1024 * 1024; // 12MB

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const formData = await request.formData();
    const file = formData.get('image') as File | null;
    // Optional caption the user typed about the food — preserved if the parse fails.
    const note = (formData.get('note') as string | null)?.trim() || null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'Missing image file', details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: `Unsupported image type: ${file.type}`,
            details: { allowed: ALLOWED_TYPES },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 415 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Image exceeds 12MB', details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 413 }
      );
    }

    const imageBytes = Buffer.from(await file.arrayBuffer());

    try {
      const draft = await NutritionIntelligenceService.parsePhoto(user.id, imageBytes, file.type);

      return NextResponse.json({
        success: true,
        data: draft,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      });
    } catch (parseError: any) {
      // Option B (§6.1): a failed OR rate-limited parse must not lose the user's photo. Save it
      // as a normal food-log entry (blank macros) and hand the client its id so it can drop the
      // user straight into that entry to finish manually.
      const isRate = parseError?.message === 'RateLimited';
      if (!isRate && parseError?.message !== 'ParseFailed') {
        throw parseError; // Unauthorized / unexpected → outer catch
      }

      let saved: { entryId: string; imageUrls: string[] } | null = null;
      try {
        saved = await NutritionIntelligenceService.saveUnparsedPhoto(user.id, file, note);
      } catch (saveError) {
        console.error('[Mobile API] Photo parse fallback save failed:', saveError);
      }

      // Route-level correlation log for a real analysis failure (rate-limits are
      // expected and already gated, so skip those). The service logs WHY the AI
      // parse failed ([nutrition-parse-failure]); this ties that failure to the
      // saved entry the user sees, plus the request's file metadata + latency.
      if (!isRate) {
        console.error(
          '[nutrition-parse-failure:route]',
          JSON.stringify({
            source: 'photo',
            userId: user.id,
            code: 'PARSE_FAILED',
            mimeType: file.type,
            fileBytes: file.size,
            hasNote: !!note,
            requestMs: Date.now() - startTime,
            fallbackSaved: !!saved,
            savedEntryId: saved?.entryId ?? null,
          })
        );
      }

      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: isRate ? 'RATE_LIMITED' : 'PARSE_FAILED',
            message: isRate
              ? "You've reached today's photo-estimate limit — we saved your photo so you can add the details."
              : "Couldn't auto-detect the food — we saved your photo so you can add the details.",
            details: saved ? { savedEntryId: saved.entryId, imageUrls: saved.imageUrls } : {},
            timestamp: new Date().toISOString(),
          },
          meta: { requestTime: Date.now() - startTime },
        },
        { status: isRate ? 429 : 422 }
      );
    }
  } catch (error: any) {
    console.error('[Mobile API] Photo parse error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
