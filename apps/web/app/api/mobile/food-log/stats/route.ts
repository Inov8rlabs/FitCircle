/**
 * Food Log Statistics API Route
 * GET /api/mobile/food-log/stats - Get aggregated statistics
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodLogService } from '@/lib/services/food-log-service';
import { UsageService } from '@/lib/services/usage-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/food-log/stats
 * Get aggregated statistics for user's food log
 *
 * Query params:
 * - start_date: ISO date string (required)
 * - end_date: ISO date string (required)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const supabase = createAdminSupabase();

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'MISSING_PARAMS',
            message: 'start_date and end_date are required',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // History soft-gate: free tier sees a 14-day window once history_extended is
    // live. CLAMP the range start, never 403 — the client renders an "unlock full
    // history" footer off meta.clamped.
    let effectiveStart = startDate;
    let clamped = false;
    const windowDays = await UsageService.historyWindowDays(user.id);
    if (Number.isFinite(windowDays)) {
      const earliest = new Date();
      earliest.setUTCDate(earliest.getUTCDate() - (windowDays as number));
      const earliestStr = earliest.toISOString().slice(0, 10);
      if (startDate < earliestStr) {
        effectiveStart = earliestStr;
        clamped = true;
      }
    }

    // Get stats
    const result = await FoodLogService.getStats(user.id, effectiveStart, endDate, supabase);

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: {
        requestTime: Date.now() - startTime,
        ...(clamped ? { clamped: true, feature: 'history_extended', windowDays } : {}),
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Get food log stats error:', {
      userId: error.userId,
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
