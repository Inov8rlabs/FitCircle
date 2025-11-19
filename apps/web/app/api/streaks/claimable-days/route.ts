import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

/**
 * GET /api/streaks/claimable-days
 * Get list of claimable days in the last 7 days
 *
 * Query params:
 * - timezone: User's timezone (required)
 *
 * Response:
 * {
 *   "days": [
 *     {
 *       "date": "2025-10-29",
 *       "claimed": false,
 *       "hasHealthData": true,
 *       "canClaim": true
 *     },
 *     {
 *       "date": "2025-10-28",
 *       "claimed": true,
 *       "hasHealthData": true,
 *       "canClaim": false,
 *       "reason": "Already claimed for this date"
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Verify mobile authentication (Bearer token)
    const user = await requireMobileAuth(request);

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const timezone = searchParams.get('timezone');

    if (!timezone) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'timezone is required',
          },
        },
        { status: 400 }
      );
    }

    // 3. Get claimable days
    const days = await StreakClaimingService.getClaimableDays(user.id, timezone);

    return NextResponse.json({ days });
  } catch (error: any) {
    console.error('[GET /api/streaks/claimable-days] Error:', error);

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
