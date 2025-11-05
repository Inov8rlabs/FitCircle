import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { StreakError, STREAK_ERROR_CODES } from '@/lib/types/streak';

/**
 * POST /api/mobile/streaks/apply-freeze
 * Manually apply a streak freeze to cover a missed day
 *
 * User can apply a freeze to restore their broken streak by covering
 * a missed day (within the past 7 days).
 *
 * Request Body:
 * {
 *   "missedDate": "2025-11-04"  // Optional, defaults to yesterday
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "current_streak": 15,
 *     "longest_streak": 26,
 *     "freezes_available": 4,
 *     "last_engagement_date": "2025-11-05"
 *   }
 * }
 *
 * Errors:
 * - NO_FREEZES_AVAILABLE: User has no freezes left
 * - INVALID_DATE_RANGE: Date must be within past 7 days
 * - DATE_HAS_ACTIVITY: That date already has activity
 * - STREAK_NOT_FOUND: No streak record exists
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse request body
    const body = await request.json();
    const { missedDate } = body as { missedDate?: string };

    console.log(`[Apply Freeze] User ${user.id} applying freeze for date: ${missedDate || 'yesterday'}`);

    // Apply the freeze
    const result = await EngagementStreakService.applyFreeze(user.id, missedDate);

    return NextResponse.json({
      success: true,
      data: result,
      error: null,
      meta: {
        requestTime: Date.now() - startTime,
      },
    });
  } catch (error: any) {
    console.error('[Apply Freeze] Error:', {
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    // Handle StreakError with specific error codes
    if (error instanceof StreakError) {
      const statusCode =
        error.code === STREAK_ERROR_CODES.NO_FREEZES_AVAILABLE ? 400 :
        error.code === STREAK_ERROR_CODES.INVALID_DATE_RANGE ? 400 :
        error.code === STREAK_ERROR_CODES.DATE_HAS_ACTIVITY ? 400 :
        error.code === STREAK_ERROR_CODES.STREAK_NOT_FOUND ? 404 :
        500;

      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: error.code,
            message: error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: statusCode }
      );
    }

    // Handle authentication errors
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

    // Generic error
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
