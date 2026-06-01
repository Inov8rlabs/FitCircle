import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';

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

    const draft = await NutritionIntelligenceService.parsePhoto(user.id, imageBytes, file.type);

    return NextResponse.json({
      success: true,
      data: draft,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
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

    if (error?.message === 'RateLimited') {
      // Soft cap (PRD §9.2): ask the user to use search/manual instead of the vision model.
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'RATE_LIMITED',
            message: "You've reached today's photo-estimate limit. Try search or manual entry.",
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 429 }
      );
    }

    if (error?.message === 'ParseFailed') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'PARSE_FAILED',
            message: "Couldn't read that photo. Try a clearer shot, or use search/manual entry.",
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
