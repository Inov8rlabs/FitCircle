import { type NextRequest, NextResponse } from 'next/server';
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

    // 3. Activate freeze (timezone-aware)
    const result = await StreakClaimingService.activateFreeze(user.id, date, timezone);

    console.log(`[POST /api/streaks/freeze/activate] User ${user.id} activated freeze for ${date}`);

    return NextResponse.json({
      success: true,
      // Old clients decode this as a non-optional number, so unlimited (Pro)
      // reports a sentinel count; updated clients key off `unlimited`.
      shieldsRemaining: result.unlimited ? 999 : result.remaining,
      unlimited: result.unlimited,
      message: `Freeze activated for ${date}`,
    });
  } catch (error: any) {
    console.error('[POST /api/streaks/freeze/activate] Error:', error);
    // An expired/invalid token must surface as 401 so the client can refresh and
    // retry — not a 500, which the app can't recover from and which shows up in
    // Sentry as a server error (FITCIRCLE-IOS-2).
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }

    if (error instanceof StreakClaimError) {
      // Out of shields is the paywall moment for free users — tell the
      // client explicitly so it can route to the Pro upsell. Stays HTTP 400
      // so pre-update clients keep their graceful "no shields" handling.
      const outOfShields = error.code === 'NO_SHIELDS_AVAILABLE';
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
            ...(outOfShields ? { upsell: 'pro_unlimited_shields' } : {}),
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
