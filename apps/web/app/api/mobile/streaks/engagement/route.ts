import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * GET /api/mobile/streaks/engagement
 * Get user's engagement streak details
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    console.log('[GET /api/mobile/streaks/engagement] Fetching streak for user:', user.id);

    // Honour the device's local timezone so date math doesn't drift to UTC.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    // Get engagement streak
    const streak = await EngagementStreakService.getEngagementStreak(user.id, timezone);

    return NextResponse.json({ success: true, data: streak });

  } catch (error: any) {
    console.error('[GET /api/mobile/streaks/engagement] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to fetch engagement streak', data: null },
      { status: 500 }
    );
  }
}
