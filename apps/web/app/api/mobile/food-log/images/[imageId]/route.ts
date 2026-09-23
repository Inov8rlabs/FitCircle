/**
 * Food Log Image Proxy API Route
 * GET /api/mobile/food-log/images/[imageId]?size=original|medium|thumbnail
 *
 * Serves food log images through the API with proper authentication and authorization.
 * This provides better security than direct Supabase access and allows for future enhancements
 * like image transformations, analytics, and CDN integration.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleMealPostService } from '@/lib/services/circle-meal-post-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * Image size variants
 */
type ImageSize = 'original' | 'medium' | 'thumbnail';

/**
 * GET /api/mobile/food-log/images/[imageId]
 * Proxy image requests with authentication
 *
 * Query params:
 * - size: 'original' | 'medium' | 'thumbnail' (default: 'medium')
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const { imageId } = await params;
    const supabase = createAdminSupabase();

    // Parse size parameter
    const searchParams = request.nextUrl.searchParams;
    const size = (searchParams.get('size') as ImageSize) || 'medium';

    // Validate size parameter
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

    // Fetch image metadata from database
    const { data: imageRecord, error: dbError } = await supabase
      .from('food_log_images')
      .select(
        `
        id,
        food_log_entry_id,
        user_id,
        storage_path,
        storage_bucket,
        thumbnail_path,
        deleted_at
      `
      )
      .eq('id', imageId)
      .is('deleted_at', null)
      .single();

    if (dbError || !imageRecord) {
      console.error('[Image Proxy] Image not found:', imageId, dbError);
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

    // Check if image is deleted
    if (imageRecord.deleted_at) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'IMAGE_DELETED',
            message: 'Image has been deleted',
            details: {},
            timestamp: new Date().toISOString(),
          },
        },
        { status: 410 }
      );
    }

    // Authorization: the owner always; otherwise the viewer must be allowed to
    // see the entry itself — shareable meal + a shared active circle where the
    // owner's food-privacy tier is 'full' (the same rule that put the meal card
    // in the circle chat). The previous check queried tables that no longer
    // exist, so every member request 403'd.
    if (imageRecord.user_id !== user.id) {
      const { data: entryData } = await supabase
        .from('food_log_entries')
        .select('id, user_id, entry_type, visibility, is_private, title, meal_type, logged_at, deleted_at')
        .eq('id', imageRecord.food_log_entry_id)
        .maybeSingle();

      const allowed = entryData
        ? await CircleMealPostService.viewerCanSeeEntry(user.id, entryData as any)
        : false;

      if (!allowed) {
        console.warn('[Image Proxy] Unauthorized access attempt:', {
          imageId,
          userId: user.id,
          ownerId: imageRecord.user_id,
        });
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
    }

    // Determine which storage path to use based on size
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
        // Medium size: replace _original with _medium in path
        storagePath = imageRecord.storage_path.replace('_original.', '_medium.');
        break;
    }

    // Fetch image from Supabase Storage
    const { data: imageData, error: storageError } = await supabase.storage
      .from(imageRecord.storage_bucket)
      .download(storagePath);

    if (storageError || !imageData) {
      console.error('[Image Proxy] Storage error:', {
        imageId,
        storagePath,
        error: storageError,
      });
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

    // Convert blob to buffer
    const buffer = Buffer.from(await imageData.arrayBuffer());

    // Create response with proper headers
    const response = new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
        'X-Request-Time': `${Date.now() - startTime}ms`,
      },
    });

    console.log('[Image Proxy] Image served successfully:', {
      imageId,
      size,
      userId: user.id,
      bytes: buffer.length,
      duration: Date.now() - startTime,
    });

    return response;
  } catch (error: any) {
    console.error('[Image Proxy] Unexpected error:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

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
