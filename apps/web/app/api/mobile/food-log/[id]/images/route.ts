/**
 * Food Log Image Upload API Route
 * POST /api/mobile/food-log/[id]/images - Upload image to entry
 */

import { NextRequest, NextResponse } from 'next/server';
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
      supabase
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

    return NextResponse.json(
      {
        success: true,
        data: result.image,
        meta: {
          requestTime: Date.now() - startTime,
        },
        error: null,
      },
      { status: 201 }
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
