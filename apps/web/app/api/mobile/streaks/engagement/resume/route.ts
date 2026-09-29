import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * POST /api/mobile/streaks/engagement/resume
 * Resume paused engagement streak
 *
 * Response: `success` and `message` as before, plus `data` with the refreshed
 * streak (same shape as GET /api/mobile/streaks/engagement).
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    console.log('[POST /api/mobile/streaks/engagement/resume] User:', user.id);

    // Honour the device's local timezone so the paused gap ends on the user's yesterday.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    // Resume streak
    await EngagementStreakService.resumeStreak(user.id, timezone);

    // The resume already succeeded; a failed read must not turn it into an error.
    let streak: unknown = null;
    try {
      streak = await EngagementStreakService.getEngagementStreak(user.id, timezone);
    } catch (readError) {
      console.error('[POST /api/mobile/streaks/engagement/resume] streak read error:', readError);
    }

    return NextResponse.json({
      success: true,
      message: 'Streak resumed successfully',
      data: streak,
    });

  } catch (error: any) {
    console.error('[POST /api/mobile/streaks/engagement/resume] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    // Handle specific error types
    if (error instanceof Error && error.message.includes('not currently paused')) {
      return NextResponse.json(
        { success: false, error: error.message, data: null },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to resume streak', data: null },
      { status: 500 }
    );
  }
}
