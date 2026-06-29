import { type NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

// Evaluates the last 7 days against the streak rules (several DB lookups); give it
// room so a brief spell of DB latency fails over cleanly instead of timing out.
export const maxDuration = 30;

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

    // An expired/invalid token must surface as 401 so the client can refresh and retry,
    // not as a 500 (which the app can't recover from and which pollutes error tracking).
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
        },
        { status: 401 }
      );
    }

    // Unlike a parse failure, this is an unexpected server error — capture it with
    // enough context to root-cause the next occurrence (the trace ID ties it back to
    // the client-side HTTPClientError that the mobile app reports).
    Sentry.captureException(error, {
      level: 'error',
      tags: { feature: 'streaks', route: 'claimable-days' },
    });

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
