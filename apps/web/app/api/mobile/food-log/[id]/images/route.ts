/**
 * Food Log Image Upload API Route
 * POST /api/mobile/food-log/[id]/images - Upload image to entry
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogImageService } from '@/lib/services/food-log-image-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * POST /api/mobile/food-log/[id]/images
 * Upload image(s) to a food log entry
 *
 * Content-Type: multipart/form-data
 * Max file size: 10MB per image
 * Allowed types: image/jpeg, image/png, image/webp, image/heic
 * Optional `image_key` (1-128 chars [A-Za-z0-9._:-]): idempotency key. Re-uploading
 * the same key (or, without a key, the same bytes) to the same entry returns the
 * stored image with 200 + meta.duplicate instead of attaching a copy.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const entryId = id;
    const supabase = createAdminSupabase();

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const displayOrder = parseInt(formData.get('display_order') as string) || 0;
    // Optional idempotency key; without one the file's content hash is used.
    const rawKey = formData.get('image_key');
    const imageKey = typeof rawKey === 'string' && rawKey !== '' ? rawKey : undefined;
    if (imageKey !== undefined && !FoodLogImageService.isValidImageKey(imageKey)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_IMAGE_KEY',
            message: 'image_key must be 1-128 characters of A-Z a-z 0-9 . _ : -',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'MISSING_FILE',
            message: 'No image file provided',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Upload and process image
    const result = await FoodLogImageService.uploadImage(
      entryId,
      user.id,
      file,
      displayOrder,
      supabase,
      { imageKey }
    );

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UPLOAD_FAILED',
            message: result.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Add API URLs to the image record
    const imageWithUrls = FoodLogImageService.addImageUrls(
      result.image!,
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    );

    return NextResponse.json(
      {
        success: true,
        data: imageWithUrls,
        meta: {
          requestTime: Date.now() - startTime,
          ...(result.duplicate ? { duplicate: true } : {}),
        },
        error: null,
      },
      // A re-upload of a photo already on the entry returns the stored image.
      { status: result.duplicate ? 200 : 201 }
    );
  } catch (error: any) {
    console.error('[Mobile API] Upload food log image error:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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
