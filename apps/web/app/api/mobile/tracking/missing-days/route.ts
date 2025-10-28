import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { getUserTimezone, getLastNDays } from '@/lib/utils/timezone';

/**
 * GET /api/mobile/tracking/missing-days
 * Get missing check-in days for the last 7 days
 *
 * Returns array of dates (YYYY-MM-DD) that don't have check-ins
 * Used by iOS app to show backfill UI
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "missing_dates": ["2025-10-25", "2025-10-23"],
 *     "total_days_checked": 7,
 *     "missing_count": 2
 *   }
 * }
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get user's timezone
    const userTimezone = await getUserTimezone(user.id, supabaseAdmin);

    // Get last 7 days in user's timezone
    const last7Days = getLastNDays(7, userTimezone);

    console.log(`[Missing Days] Checking ${last7Days.length} days for user ${user.id} in timezone ${userTimezone}`);
    console.log(`[Missing Days] Date range: ${last7Days[last7Days.length - 1]} to ${last7Days[0]}`);

    // Get existing check-ins for these dates
    const { data: existingCheckIns, error } = await supabaseAdmin
      .from('daily_tracking')
      .select('tracking_date')
      .eq('user_id', user.id)
      .in('tracking_date', last7Days);

    if (error) {
      console.error('[Missing Days] Database error:', error);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to fetch check-in history',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    // Extract dates that have check-ins
    const loggedDates = new Set(existingCheckIns?.map(d => d.tracking_date) || []);

    // Find missing dates
    const missingDates = last7Days.filter(date => !loggedDates.has(date));

    console.log(`[Missing Days] Found ${missingDates.length} missing days: ${missingDates.join(', ')}`);

    return NextResponse.json({
      success: true,
      data: {
        missing_dates: missingDates,
        total_days_checked: last7Days.length,
        missing_count: missingDates.length,
        logged_count: loggedDates.size,
        timezone: userTimezone,
      },
      error: null,
      meta: {
        requestTime: Date.now() - startTime,
      },
    });
  } catch (error: any) {
    console.error('[Missing Days] Error:', {
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
