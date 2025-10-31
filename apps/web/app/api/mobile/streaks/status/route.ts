import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { getStreakStatus } from '@/lib/services/daily-checkin-service';

/**
 * GET /api/mobile/streaks/status
 * Get current streak status and info
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     currentStreak: number,
 *     longestStreak: number,
 *     lastCheckInDate: string | null,
 *     hasCheckedInToday: boolean,
 *     freezesAvailable: number,
 *     nextMilestone: number | null,
 *     daysUntilNextMilestone: number | null,
 *     canCheckInAgain: boolean,
 *     streakColor: string,
 *     totalPoints: number
 *   }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get streak status
    const status = await getStreakStatus(user.id, supabaseAdmin);

    const response = NextResponse.json({
      success: true,
      data: status,
      error: null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Get streak status error:', error);

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
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
