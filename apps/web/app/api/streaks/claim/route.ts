import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { StreakClaimError, CLAIM_ERROR_CODES } from '@/lib/types/streak-claiming';

// Validation schema
const claimStreakSchema = z.object({
  claimDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().min(1),
});

/**
 * POST /api/streaks/claim
 * Claim a streak for today or a retroactive date (within 7 days)
 *
 * Request body:
 * {
 *   "claimDate": "2025-10-29", // Optional, defaults to today
 *   "timezone": "America/Los_Angeles"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "streakCount": 15,
 *   "milestone": {
 *     "milestone": 30,
 *     "type": "shield_earned",
 *     "reward": "1 streak shield(s) earned!",
 *     "shieldsGranted": 1
 *   },
 *   "message": "Streak claimed! Current streak: 15 days"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify mobile authentication (Bearer token)
    const user = await requireMobileAuth(request);

    // 2. Parse and validate request body
    const body = await request.json();
    const { claimDate, timezone } = claimStreakSchema.parse(body);

    // 3. Determine claim date (today if not specified)
    // IMPORTANT: Parse dates at UTC midnight to avoid timezone issues
    // The claimDate string from iOS is already in local date format (YYYY-MM-DD)
    let targetDate: Date;
    let claimDateString: string;
    
    if (claimDate) {
      // Parse as UTC midnight to preserve the date string
      targetDate = new Date(claimDate + 'T00:00:00.000Z');
      claimDateString = claimDate;
    } else {
      // Use today's date in UTC
      targetDate = new Date();
      targetDate.setUTCHours(0, 0, 0, 0);
      claimDateString = targetDate.toISOString().split('T')[0];
    }

    // 4. Determine claim method
    const now = new Date();
    const todayString = now.toISOString().split('T')[0];
    const isToday = claimDateString === todayString;
    const method = isToday ? 'explicit' : 'retroactive';

    // 5. Claim the streak
    const result = await StreakClaimingService.claimStreak(
      user.id,
      targetDate,
      timezone,
      method
    );

    console.log(`[POST /api/streaks/claim] User ${user.id} claimed streak for ${claimDate || 'today'}`);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[POST /api/streaks/claim] Error:', error);
    console.error('[POST /api/streaks/claim] Error message:', error?.message);
    console.error('[POST /api/streaks/claim] Error stack:', error?.stack);

    if (error instanceof StreakClaimError) {
      const statusCode =
        error.code === CLAIM_ERROR_CODES.ALREADY_CLAIMED ? 409 :
        error.code === CLAIM_ERROR_CODES.NO_HEALTH_DATA ? 400 :
        error.code === CLAIM_ERROR_CODES.FUTURE_DATE ? 400 :
        error.code === CLAIM_ERROR_CODES.TOO_OLD ? 400 :
        400;

      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        { status: statusCode }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
          },
        },
        { status: 400 }
      );
    }

    // For unexpected errors, include more details for debugging
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code || 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred',
          details: {
            name: error.name,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          },
        },
      },
      { status: 500 }
    );
  }
}
