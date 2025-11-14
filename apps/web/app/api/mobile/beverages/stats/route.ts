/**
 * Beverage Log Statistics API Route
 * GET /api/mobile/beverages/stats - Get beverage consumption statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BeverageLogService } from '@/lib/services/beverage-log-service';
import { BeverageStatsQuerySchema } from '@/lib/validation/beverage-log-validation';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * GET /api/mobile/beverages/stats
 * Get aggregated beverage consumption statistics for a date range
 *
 * Query params:
 * - start_date: ISO date string (default: 7 days ago)
 * - end_date: ISO date string (default: today)
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
      start_date: searchParams.get('start_date'),
      end_date: searchParams.get('end_date'),
    };

    const validatedQuery = BeverageStatsQuerySchema.parse(queryParams);

    // Default date range: last 7 days
    const endDate = validatedQuery.end_date || new Date().toISOString().split('T')[0];
    const startDate =
      validatedQuery.start_date ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get stats from service
    const result = await BeverageLogService.getStats(user.id, startDate, endDate, supabase);

    if (result.error) {
      throw result.error;
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      date_range: {
        start_date: startDate,
        end_date: endDate,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (5 minute cache for stats)
    response.headers.set('Cache-Control', 'private, max-age=300');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get beverage stats error:', {
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
