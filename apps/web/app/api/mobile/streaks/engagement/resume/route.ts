import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * POST /api/mobile/streaks/engagement/resume
 * Resume paused engagement streak
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    console.log('[POST /api/mobile/streaks/engagement/resume] User:', user.id);

    // Resume streak
    await EngagementStreakService.resumeStreak(user.id);

    return NextResponse.json({ success: true, message: 'Streak resumed successfully' });

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
