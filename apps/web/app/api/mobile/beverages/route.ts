/**
 * Beverage Log API Routes
 * POST /api/mobile/beverages - Create new beverage log entry
 * GET /api/mobile/beverages - Get user's beverage log entries (paginated)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BeverageLogService } from '@/lib/services/beverage-log-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import {
  CreateBeverageLogSchema,
  BeverageLogQuerySchema,
} from '@/lib/validation/beverage-log-validation';

/**
 * GET /api/mobile/beverages
 * Get user's beverage log entries with pagination and filters
 *
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 * - category: 'water' | 'coffee' | 'tea' | 'smoothie' | ... | 'all'
 * - start_date: ISO date string
 * - end_date: ISO date string
 * - favorites_only: boolean
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const supabase = createAdminSupabase();

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = {
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      category: searchParams.get('category'),
      start_date: searchParams.get('start_date'),
      end_date: searchParams.get('end_date'),
      favorites_only: searchParams.get('favorites_only'),
    };

    const validatedQuery = BeverageLogQuerySchema.parse(queryParams);

    // Get entries from service (convert null to undefined)
    const result = await BeverageLogService.getEntries(
      user.id,
      {
        page: validatedQuery.page ?? undefined,
        limit: validatedQuery.limit ?? undefined,
        category: validatedQuery.category ?? undefined,
        start_date: validatedQuery.start_date ?? undefined,
        end_date: validatedQuery.end_date ?? undefined,
        favorites_only: validatedQuery.favorites_only ?? undefined,
      },
      supabase
    );

    if (result.error) {
      throw result.error;
    }

    // Attach image_urls[] to each beverage entry (mostly meaningful for
    // alcohol logs). Single round-trip via .in() rather than per-entry.
    const apiBase = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    let entriesWithImages = result.data as any[];

    if (result.data.length > 0) {
      const { data: images } = await supabase
        .from('beverage_log_images')
        .select('id, beverage_log_id, display_order')
        .in('beverage_log_id', result.data.map((e) => e.id))
        .is('deleted_at', null)
        .order('display_order', { ascending: true });

      if (images && images.length > 0) {
        const byEntry = new Map<string, string[]>();
        for (const img of images) {
          const list = byEntry.get(img.beverage_log_id) ?? [];
          list.push(`${apiBase}/api/mobile/beverages/images/${img.id}?size=medium`);
          byEntry.set(img.beverage_log_id, list);
        }
        entriesWithImages = result.data.map((entry) => {
          const urls = byEntry.get(entry.id);
          if (!urls || urls.length === 0) return entry;
          return { ...entry, photo_url: urls[0], image_urls: urls };
        });
      }
    }

    const response = NextResponse.json({
      success: true,
      data: entriesWithImages,
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

    // No caching for frequently changing user data
    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get beverage log entries error:', {
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
 * POST /api/mobile/beverages
 * Create a new beverage log entry
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const supabase = createAdminSupabase();

    // Parse and validate request body
    const body = await request.json();
    const validatedData = CreateBeverageLogSchema.parse(body);

    // Create entry
    const result = await BeverageLogService.createEntry(user.id, validatedData, supabase);

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
    console.error('[Mobile API] Create beverage log entry error:', {
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
