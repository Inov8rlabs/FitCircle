/**
 * Beverage Log Image Proxy
 * GET /api/mobile/beverages/images/[imageId]?size=original|medium|thumbnail
 *
 * Authenticated proxy that streams the requested image variant from the
 * private `beverage-logs` Supabase Storage bucket.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';

type ImageSize = 'original' | 'medium' | 'thumbnail';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { imageId } = await params;
    const supabase = createAdminSupabase();

    const size = (request.nextUrl.searchParams.get('size') as ImageSize) || 'medium';
    if (!['original', 'medium', 'thumbnail'].includes(size)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_SIZE',
            message: 'Size must be one of: original, medium, thumbnail',
            details: { provided: size },
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    const { data: imageRecord, error: dbError } = await supabase
      .from('beverage_log_images')
      .select('id, beverage_log_id, user_id, storage_path, storage_bucket, thumbnail_path, deleted_at')
      .eq('id', imageId)
      .is('deleted_at', null)
      .single();

    if (dbError || !imageRecord) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'IMAGE_NOT_FOUND',
            message: 'Image not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
        },
        { status: 404 }
      );
    }

    if (imageRecord.user_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'You do not have permission to view this image',
            details: {},
            timestamp: new Date().toISOString(),
          },
        },
        { status: 403 }
      );
    }

    let storagePath: string;
    switch (size) {
      case 'original':
        storagePath = imageRecord.storage_path;
        break;
      case 'thumbnail':
        storagePath = imageRecord.thumbnail_path || imageRecord.storage_path;
        break;
      case 'medium':
      default:
        storagePath = imageRecord.storage_path.replace('_original.', '_medium.');
        break;
    }

    const { data: imageData, error: storageError } = await supabase.storage
      .from(imageRecord.storage_bucket)
      .download(storagePath);

    if (storageError || !imageData) {
      console.error('[Beverage Image Proxy] Storage error:', { imageId, storagePath, error: storageError });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'STORAGE_ERROR',
            message: 'Failed to retrieve image from storage',
            details: {},
            timestamp: new Date().toISOString(),
          },
        },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await imageData.arrayBuffer());
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Request-Time': `${Date.now() - startTime}ms`,
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
        },
        { status: 401 }
      );
    }
    console.error('[Beverage Image Proxy] Unexpected error:', { message: error.message });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
