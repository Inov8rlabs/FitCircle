/**
 * Food Log Batch Image Upload
 * POST /api/mobile/food-log/[id]/images/batch
 *
 * Accepts multiple image files in a single multipart request under the field
 * name "images" (repeated). Returns per-file success/failure so clients can
 * surface partial errors without rolling back the whole batch.
 *
 * The per-file endpoint at /api/mobile/food-log/[id]/images is still
 * supported for one-at-a-time uploads and backwards compatibility.
 *
 * Idempotent: a retried batch never attaches the same photo twice. Each file is
 * keyed by an optional client `image_keys` value (repeated form field, one per
 * file in the same order, or a single JSON array string), else by the SHA-256
 * of its bytes. Already-stored files come back in `uploaded` with
 * `duplicate: true`; `counts.duplicates` counts them. 201 when anything new was
 * stored, 200 when the whole batch was already there, 400 when nothing stored.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogImageService } from '@/lib/services/food-log-image-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const MAX_FILES_PER_BATCH = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { id: entryId } = await params;
    const supabase = createAdminSupabase();

    const formData = await request.formData();
    const fileEntries = formData.getAll('images').filter((v): v is File => v instanceof File);

    if (fileEntries.length === 0) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'MISSING_FILES',
            message: 'No image files provided. Use form field name "images".',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    if (fileEntries.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'TOO_MANY_FILES',
            message: `Maximum ${MAX_FILES_PER_BATCH} images per batch (received ${fileEntries.length}).`,
            details: { max: MAX_FILES_PER_BATCH, received: fileEntries.length },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const imageKeys = FoodLogImageService.parseImageKeys(
      formData.getAll('image_keys').filter((v): v is string => typeof v === 'string'),
      fileEntries.length
    );
    if (imageKeys.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_IMAGE_KEYS',
            message: imageKeys.error,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const { uploaded, failed, duplicates } = await FoodLogImageService.uploadImages(
      entryId,
      user.id,
      fileEntries,
      supabase,
      imageKeys.keys
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const uploadedWithUrls = FoodLogImageService.addImageUrlsToMany(uploaded, baseUrl);
    const created = uploaded.length - duplicates;

    return NextResponse.json(
      {
        success: failed.length === 0,
        data: {
          uploaded: uploadedWithUrls,
          failed,
          counts: { uploaded: uploaded.length, failed: failed.length, duplicates },
        },
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      // 201 if anything was created, 200 if everything was already stored (a
      // retry); a non-empty `failed` signals partial failure.
      { status: created > 0 ? 201 : uploaded.length > 0 ? 200 : 400 }
    );
  } catch (error: any) {
    console.error('[Mobile API] Batch upload food log images error:', {
      message: error.message,
    });

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
