import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

/**
 * GET /api/streaks/claim-status
 * Check if user can claim a streak for a specific date
 *
 * Query params:
 * - date: YYYY-MM-DD (required)
 * - timezone: User's timezone (required)
 *
 * Response:
 * {
 *   "canClaim": true,
 *   "alreadyClaimed": false,
 *   "hasHealthData": true,
 *   "gracePeriodActive": false
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Verify authentication
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        { status: 401 }
      );
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');
    const timezone = searchParams.get('timezone');

    if (!dateStr || !timezone) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'date and timezone are required',
          },
        },
        { status: 400 }
      );
    }

    // 3. Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_DATE_FORMAT',
            message: 'Date must be in YYYY-MM-DD format',
          },
        },
        { status: 400 }
      );
    }

    // 4. Check claim status
    const date = new Date(dateStr);
    const result = await StreakClaimingService.canClaimStreak(user.id, date, timezone);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[GET /api/streaks/claim-status] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      { status: 500 }
    );
  }
}
