import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { readPauseRequest } from '@/lib/streaks/pause-request';
import { readJsonBody } from '@/lib/streaks/request-body';
import { StreakError, STREAK_ERROR_CODES } from '@/lib/types/streak';

/**
 * POST /api/mobile/streaks/engagement/pause
 * Pause engagement streak for up to 90 days
 *
 * Body (all optional):
 *   resume_date  YYYY-MM-DD or an ISO-8601 timestamp, 1..90 days ahead
 *   days         used only when resume_date is absent; capped at 90
 *   reason       accepted, not stored
 *
 * Response: `success` and `message` as before, plus the pause window
 * (`pause_start_date`, `pause_end_date`) and a `data` object holding the
 * refreshed streak together with `success` and `message`.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Honour the device's local timezone so the pause starts on the user's today.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    const body = await readJsonBody(request);
    const pause = readPauseRequest(body, timezone);

    console.log('[POST /api/mobile/streaks/engagement/pause] User:', user.id, 'Resume:', pause.ok ? pause.resumeDate ?? 'default' : pause.code);

    if (!pause.ok) {
      return NextResponse.json(
        { success: false, error: pause.error, data: null, code: pause.code, message: pause.error },
        { status: 400 }
      );
    }

    // Pause streak
    const window = await EngagementStreakService.pauseStreak(user.id, pause.resumeDate, timezone);

    const message = 'Streak paused successfully';

    // The refreshed streak is a convenience for the client; the pause itself
    // already succeeded, so a failed read must not turn it into an error.
    let streak: Record<string, unknown> = {};
    try {
      streak = { ...(await EngagementStreakService.getEngagementStreak(user.id, timezone)) };
    } catch (readError) {
      console.error('[POST /api/mobile/streaks/engagement/pause] streak read error:', readError);
    }

    return NextResponse.json({
      success: true,
      message,
      pause_start_date: window.pause_start_date,
      pause_end_date: window.pause_end_date,
      data: {
        ...streak,
        success: true,
        message,
        paused: true,
        pause_start_date: window.pause_start_date,
        pause_end_date: window.pause_end_date,
      },
    });

  } catch (error: any) {
    console.error('[POST /api/mobile/streaks/engagement/pause] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    // Handle specific error types
    if (error instanceof Error && error.message.includes('already paused')) {
      return NextResponse.json(
        { success: false, error: error.message, data: null, code: STREAK_ERROR_CODES.ALREADY_PAUSED, message: error.message },
        { status: 400 }
      );
    }

    if (
      error instanceof StreakError &&
      (error.code === STREAK_ERROR_CODES.PAUSE_TOO_LONG ||
        error.code === STREAK_ERROR_CODES.INVALID_DATE_RANGE)
    ) {
      return NextResponse.json(
        { success: false, error: error.message, data: null, code: error.code, message: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to pause streak', data: null },
      { status: 500 }
    );
  }
}
