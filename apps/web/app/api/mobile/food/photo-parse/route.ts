import { after, type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';
import { PHOTO_PARSE_MAX_IMAGES, PHOTO_PARSE_MAX_NOTE_CHARS } from '@/lib/types/nutrition';

// The vision parse routinely takes 20-40s. Without this, the function is killed at
// the platform default (~10s) and the request appears to "time out". 60s is the max
// allowed on every Vercel plan and leaves headroom for the LLM (≤50s) + DB grounding.
export const maxDuration = 60;

/**
 * POST /api/mobile/food/photo-parse
 * PRD v4 §6.1 / §7.6 — multimodal photo → structured nutrition DRAFT.
 *
 * Multipart form-data: 1–5 `image` fields (jpeg/png/webp/heic) — multiple photos of the SAME
 * meal are analyzed together in one vision call — plus an optional `note` the user typed about
 * the meal, which is fed to the model as context (and preserved if the parse fails). Returns a
 * draft the client shows on a "tap to fix" card; it does NOT create a food log entry. The user
 * confirms, then the existing POST /api/mobile/food-log (or PATCH) commits the entry.
 *
 * Thin route: all nutrition logic lives in NutritionIntelligenceService (§7.2.1).
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 12 * 1024 * 1024; // 12MB per image
const MAX_IMAGES = PHOTO_PARSE_MAX_IMAGES;
const MAX_NOTE_CHARS = PHOTO_PARSE_MAX_NOTE_CHARS;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const formData = await request.formData();
    const files = formData.getAll('image').filter((f): f is File => typeof f !== 'string');
    // Optional caption the user typed about the food — fed to the vision model as context,
    // and preserved on the fallback entry if the parse fails. A note sent as a file part
    // (non-string) is ignored rather than crashing the request.
    const rawNote = formData.get('note');
    const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, MAX_NOTE_CHARS) || null : null;

    if (files.length === 0) {
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

    if (files.length > MAX_IMAGES) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Too many images: send at most ${MAX_IMAGES} per meal`,
            details: { maxImages: MAX_IMAGES },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const badType = files.find((f) => !ALLOWED_TYPES.includes(f.type));
    if (badType) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: `Unsupported image type: ${badType.type}`,
            details: { allowed: ALLOWED_TYPES },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 415 }
      );
    }

    if (files.some((f) => f.size > MAX_BYTES)) {
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

    const images = await Promise.all(
      files.map(async (f) => ({ bytes: Buffer.from(await f.arrayBuffer()), mimeType: f.type }))
    );

    try {
      const draft = await NutritionIntelligenceService.parsePhoto(user.id, images, note);

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

      let saved: { entryId: string } | null = null;
      try {
        saved = await NutritionIntelligenceService.saveUnparsedPhoto(user.id, note);
        // Attach the photos AFTER responding: a failed parse has already burned up to
        // ~50s of the 60s budget, and image processing/upload for up to 5 photos would
        // blow past maxDuration mid-loop. The entry (with savedEntryId) is what the
        // client needs now; the images land moments later.
        const entryId = saved.entryId;
        after(() => NutritionIntelligenceService.attachFallbackImages(entryId, user.id, files));
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
            imageCount: files.length,
            mimeType: files[0].type,
            fileBytes: files.reduce((a, f) => a + f.size, 0),
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
            details: saved ? { savedEntryId: saved.entryId, imageUrls: [] } : {},
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
