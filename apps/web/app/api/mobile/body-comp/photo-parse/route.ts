import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BodyCompPhotoService } from '@/lib/services/body-comp-photo-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { BODY_COMP_PHOTO_PARSE_MAX_IMAGES } from '@/lib/types/body-composition';

// The vision parse routinely takes 20-40s (plus a possible escalation retry). Without
// this, the function is killed at the platform default (~10s) and the request appears
// to "time out". 60s is the max allowed on every Vercel plan; the service clamps the
// escalation call to the remaining budget so the response always gets out in time.
export const maxDuration = 60;

/**
 * POST /api/mobile/body-comp/photo-parse
 * BODY_COMP_BUILD_CONTRACT §2 — vision parse of a body-composition report → BodyCompDraft.
 *
 * Multipart form-data: 1–3 `image` fields (jpeg/png/webp/heic ≤12MB each) — an InBody
 * printed sheet, InBody app screenshots, or a DEXA summary page (pages of the SAME
 * measurement session). Returns a DRAFT the client shows on a "tap to fix" review card;
 * it NEVER creates a body-composition log row. The user confirms, then the client
 * commits via POST /api/mobile/body-comp with source 'photo_scan'.
 * overallConfidence < 0.6 → the client falls back to the manual form pre-filled with
 * whatever parsed.
 *
 * Feature gate: body_comp_photo_scan (server-enforced → 403 PREMIUM_REQUIRED).
 * Errors: 422 PARSE_FAILED, 429 RATE_LIMITED (daily soft cap), 415 unsupported type.
 * Thin route: all parse logic lives in BodyCompPhotoService.
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 12 * 1024 * 1024; // 12MB per image
const MAX_IMAGES = BODY_COMP_PHOTO_PARSE_MAX_IMAGES;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_photo_scan');

    const formData = await request.formData();
    const files = formData.getAll('image').filter((f): f is File => typeof f !== 'string');

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
            message: `Too many images: send at most ${MAX_IMAGES} per scan`,
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
      let draft = await BodyCompPhotoService.parseScan(user.id, images);

      // body_comp_segmental is enforced server-side too: a gated user's draft never
      // carries segmental data, so the review card cannot offer to save it.
      if (
        draft.segmental &&
        !(await EntitlementService.isFeatureAllowed(user.id, 'body_comp_segmental'))
      ) {
        draft = { ...draft, segmental: null };
      }

      return NextResponse.json({
        success: true,
        data: draft,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      });
    } catch (parseError: any) {
      // Draft-only endpoint: nothing to save on failure (unlike the food photo flow's
      // Option-B fallback entry) — the client simply opens the manual entry form.
      const isRate = parseError?.message === 'RateLimited';
      if (!isRate && parseError?.message !== 'ParseFailed') {
        throw parseError; // Unauthorized / unexpected → outer catch
      }

      // Route-level correlation log for a real analysis failure (rate-limits are
      // expected and already capped, so skip those). The service logs WHY the AI
      // parse failed ([bodycomp-parse-failure]); this ties it to the request shape.
      if (!isRate) {
        console.error(
          '[bodycomp-parse-failure:route]',
          JSON.stringify({
            userId: user.id,
            code: 'PARSE_FAILED',
            imageCount: files.length,
            mimeType: files[0].type,
            fileBytes: files.reduce((a, f) => a + f.size, 0),
            requestMs: Date.now() - startTime,
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
              ? "You've reached today's scan limit — you can still add this entry manually."
              : "Couldn't read the report — you can enter the values manually.",
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: { requestTime: Date.now() - startTime },
        },
        { status: isRate ? 429 : 422 }
      );
    }
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    if (error?.message === 'PREMIUM_REQUIRED') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'PREMIUM_REQUIRED', message: 'This feature requires a premium subscription', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 403 }
      );
    }

    console.error('[Mobile API] body-comp photo-parse error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
