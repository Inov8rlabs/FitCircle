import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { StreakClaimError } from '@/lib/types/streak-claiming';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { readJsonBody } from '@/lib/streaks/request-body';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

// Validation schema. Both fields used to be required; they are optional now so
// that a client which names no day gets the day that needs the shield.
const activateFreezeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().min(1).optional(),
});

/**
 * POST /api/streaks/freeze/activate
 * Manually activate a freeze shield
 *
 * Request body:
 * {
 *   "date": "2025-10-28",               // optional
 *   "timezone": "America/Los_Angeles"   // optional, falls back to X-Client-Timezone
 * }
 *
 * - With a `date`: that day is protected. It must be a past day inside the
 *   shieldable window; today and future days are refused with FUTURE_DATE.
 * - Without a `date` (absent or null): the most recent missed day is
 *   protected, which is yesterday in the user's timezone whenever yesterday
 *   was missed.
 *
 * Response:
 * {
 *   "success": true,
 *   "shieldsRemaining": 2,
 *   "unlimited": false,
 *   "date": "2025-10-28",               // additional: the day that was protected
 *   "message": "Freeze activated for 2025-10-28"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify mobile authentication (Bearer token)
    const user = await requireMobileAuth(request);

    // 2. Parse and validate request body
    const body = await readJsonBody(request);
    const parsed = parseLenient(activateFreezeSchema, body);

    const headerTimezone = request.headers.get('x-client-timezone');
    const timezone =
      parsed.timezone ?? (isValidTimezone(headerTimezone) ? headerTimezone : undefined);

    // 3. Activate freeze (timezone-aware)
    let date: string;
    let result: { remaining: number; unlimited: boolean };
    if (parsed.date) {
      date = parsed.date;
      result = await StreakClaimingService.activateFreeze(user.id, date, timezone);
    } else {
      const protectedDay = await StreakClaimingService.activateFreezeForMostRecentMissedDay(
        user.id,
        timezone
      );
      date = protectedDay.date;
      result = protectedDay;
    }

    console.log(`[POST /api/streaks/freeze/activate] User ${user.id} activated freeze for ${date}`);

    return NextResponse.json({
      success: true,
      // Old clients decode this as a non-optional number, so unlimited (Pro)
      // reports a sentinel count; updated clients key off `unlimited`.
      shieldsRemaining: result.unlimited ? 999 : result.remaining,
      unlimited: result.unlimited,
      date,
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
            message: validationMessage(error),
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
