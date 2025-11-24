/**
 * Food Log API Routes
 * POST /api/mobile/food-log - Create new food log entry
 * GET /api/mobile/food-log - Get user's food log entries (paginated)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogService } from '@/lib/services/food-log-service';
import { FeatureFlagService } from '@/lib/services/feature-flag-service';
import { CreateFoodLogEntrySchema, FoodLogQuerySchema } from '@/lib/validation/food-log-validation';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * GET /api/mobile/food-log
 * Get user's food log entries with pagination and filters
 *
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 * - entry_type: 'food' | 'water' | 'supplement' | 'all'
 * - start_date: ISO date string
 * - end_date: ISO date string
 * - meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'
 * - tags: comma-separated string
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Check feature flag
    const supabase = createAdminSupabase();
    const featureAccess = await FeatureFlagService.isFeatureEnabled('food_logging', user.id, supabase);

    if (!featureAccess.enabled) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FEATURE_DISABLED',
            message: 'Food logging feature is not available for your account',
            details: { reason: featureAccess.reason },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = {
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      entry_type: searchParams.get('entry_type'),
      start_date: searchParams.get('start_date'),
      end_date: searchParams.get('end_date'),
      meal_type: searchParams.get('meal_type'),
      tags: searchParams.get('tags'),
    };

    const validatedQuery = FoodLogQuerySchema.parse(queryParams);

    // Parse tags if provided
    const tags = validatedQuery.tags ? validatedQuery.tags.split(',') : undefined;

    // Get entries from service (convert null to undefined)
    const result = await FoodLogService.getEntries(
      user.id,
      {
        page: validatedQuery.page ?? undefined,
        limit: validatedQuery.limit ?? undefined,
        entry_type: validatedQuery.entry_type ?? undefined,
        start_date: validatedQuery.start_date ?? undefined,
        end_date: validatedQuery.end_date ?? undefined,
        meal_type: validatedQuery.meal_type ?? undefined,
        tags,
      },
      supabase
    );

    if (result.error) {
      throw result.error;
    }

    // For entries with images, attach the first image URL
    const entriesWithImageUrls = await Promise.all(
      result.data.map(async (entry) => {
        if (entry.has_images && entry.image_count > 0) {
          // Fetch first image for this entry
          const { data: images } = await supabase
            .from('food_log_images')
            .select('id')
            .eq('food_log_entry_id', entry.id)
            .is('deleted_at', null)
            .order('display_order', { ascending: true })
            .limit(1);

          if (images && images.length > 0) {
            const apiBase = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
            return {
              ...entry,
              photo_url: `${apiBase}/api/mobile/food-log/images/${images[0].id}?size=medium`,
            };
          }
        }
        return entry;
      })
    );

    const response = NextResponse.json({
      success: true,
      data: entriesWithImageUrls,
      pagination: {
        page: validatedQuery.page || 1,
        limit: validatedQuery.limit || 20,
        total: result.total,
        hasMore: result.hasMore,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (1 minute cache)
    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get food log entries error:', {
      userId: error.userId,
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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
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
 * POST /api/mobile/food-log
 * Create a new food log entry
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Check feature flag
    const supabase = createAdminSupabase();
    const featureAccess = await FeatureFlagService.isFeatureEnabled('food_logging', user.id, supabase);

    if (!featureAccess.enabled) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FEATURE_DISABLED',
            message: 'Food logging feature is not available for your account',
            details: { reason: featureAccess.reason },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = CreateFoodLogEntrySchema.parse(body);

    // Create entry
    const result = await FoodLogService.createEntry(user.id, validatedData, supabase);

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json(
      {
        success: true,
        data: result.data,
        meta: {
          requestTime: Date.now() - startTime,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[Mobile API] Create food log entry error:', {
      userId: error.userId,
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
