/**
 * Beverage Log Image Upload
 * POST /api/mobile/beverages/[id]/images   — single image (multipart, field "image")
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BeverageLogImageService } from '@/lib/services/beverage-log-image-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

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
    const file = formData.get('image') as File | null;
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

    const result = await BeverageLogImageService.uploadImage(
      beverageLogId,
      user.id,
      file,
      displayOrder,
      supabase
    );

    if (!result.success || !result.image) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UPLOAD_FAILED',
            message: result.error?.message ?? 'Upload failed',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const imageWithUrls = BeverageLogImageService.addImageUrls(result.image, baseUrl);

    return NextResponse.json(
      {
        success: true,
        data: imageWithUrls,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { status: 201 }
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
    console.error('[Mobile API] Upload beverage image error:', { message: error.message });
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
