/**
 * Individual Food Log Entry API Routes
 * GET /api/mobile/food-log/[id] - Get single entry
 * PATCH /api/mobile/food-log/[id] - Update entry
 * DELETE /api/mobile/food-log/[id] - Delete entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogService } from '@/lib/services/food-log-service';
import { FoodLogImageService } from '@/lib/services/food-log-image-service';
import { UpdateFoodLogEntrySchema } from '@/lib/validation/food-log-validation';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * GET /api/mobile/food-log/[id]
 * Get single food log entry with images
 */
export async function GET(
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

    // Get entry
    const entryResult = await FoodLogService.getEntryById(entryId, user.id, supabase);

    if (entryResult.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: entryResult.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Get images for entry
    const imagesResult = await FoodLogImageService.getImagesForEntry(entryId, supabase);

    // Add API URLs to images
    const imagesWithUrls = FoodLogImageService.addImageUrlsToMany(
      imagesResult.data,
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    );

    // Check permissions
    const canEdit = entryResult.data?.user_id === user.id;
    const canShare = canEdit && entryResult.data?.entry_type !== 'supplement';

    return NextResponse.json({
      success: true,
      data: {
        entry: entryResult.data,
        images: imagesWithUrls,
        canEdit,
        canShare,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Get food log entry error:', {
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

/**
 * PATCH /api/mobile/food-log/[id]
 * Update food log entry
 */
export async function PATCH(
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

    // Parse and validate request body
    const body = await request.json();
    const validatedData = UpdateFoodLogEntrySchema.parse(body);

    // Update entry
    const result = await FoodLogService.updateEntry(entryId, user.id, validatedData, supabase);

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UPDATE_FAILED',
            message: result.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Update food log entry error:', {
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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
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

/**
 * DELETE /api/mobile/food-log/[id]
 * Delete food log entry (soft delete)
 */
export async function DELETE(
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

    // Delete entry
    const result = await FoodLogService.deleteEntry(entryId, user.id, supabase);

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'DELETE_FAILED',
            message: result.error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { deleted: true, entryId },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Delete food log entry error:', {
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
