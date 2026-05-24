/**
 * Beverage Log Batch Image Upload
 * POST /api/mobile/beverages/[id]/images/batch  — multipart, repeated field "images"
 *
 * Returns per-file success/failure for partial uploads.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BeverageLogImageService } from '@/lib/services/beverage-log-image-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const MAX_FILES_PER_BATCH = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { id: beverageLogId } = await params;
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

    const { uploaded, failed } = await BeverageLogImageService.uploadImages(
      beverageLogId,
      user.id,
      fileEntries,
      supabase
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const uploadedWithUrls = BeverageLogImageService.addImageUrlsToMany(uploaded, baseUrl);

    return NextResponse.json(
      {
        success: failed.length === 0,
        data: {
          uploaded: uploadedWithUrls,
          failed,
          counts: { uploaded: uploaded.length, failed: failed.length },
        },
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { status: uploaded.length > 0 ? 201 : 400 }
    );
  } catch (error: any) {
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
    console.error('[Mobile API] Batch upload beverage images error:', { message: error.message });
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
