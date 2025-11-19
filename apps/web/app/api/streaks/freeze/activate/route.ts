import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { StreakClaimError } from '@/lib/types/streak-claiming';

// Validation schema
const activateFreezeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
});

/**
 * POST /api/streaks/freeze/activate
 * Manually activate a freeze shield for a specific date
 *
 * Request body:
 * {
 *   "date": "2025-10-28",
 *   "timezone": "America/Los_Angeles"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "shieldsRemaining": 2,
 *   "message": "Freeze activated for 2025-10-28"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify mobile authentication (Bearer token)
    const user = await requireMobileAuth(request);

    // 2. Parse and validate request body
    const body = await request.json();
    const { date, timezone } = activateFreezeSchema.parse(body);

    // 3. Activate freeze
    const targetDate = new Date(date);
    await StreakClaimingService.activateFreeze(user.id, targetDate);

    // 4. Get updated shield status
    const shields = await StreakClaimingService.getAvailableShields(user.id);

    console.log(`[POST /api/streaks/freeze/activate] User ${user.id} activated freeze for ${date}`);

    return NextResponse.json({
      success: true,
      shieldsRemaining: shields.total,
      message: `Freeze activated for ${date}`,
    });
  } catch (error: any) {
    console.error('[POST /api/streaks/freeze/activate] Error:', error);

    if (error instanceof StreakClaimError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        { status: 400 }
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
