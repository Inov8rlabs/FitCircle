import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * GET /api/mobile/streaks/engagement/history
 * Get last 90 days of engagement activity
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Get days parameter from query string (default 90)
    const { searchParams } = new URL(request.url);
    const requestedDays = parseInt(searchParams.get('days') || '90', 10);
    // An unreadable value (`?days=abc`) falls back to the default instead of a 500.
    const days = Number.isFinite(requestedDays) ? requestedDays : 90;

    // Validate days parameter
    if (days < 1 || days > 365) {
      return NextResponse.json(
        { error: 'Days parameter must be between 1 and 365' },
        { status: 400 }
      );
    }

    console.log(`[GET /api/mobile/streaks/engagement/history] Fetching ${days} days for user:`, user.id);

    // Honour the device's local timezone for the "paused until today" days.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    // Get engagement history
    const history = await EngagementStreakService.getEngagementHistory(user.id, days, timezone);

    return NextResponse.json({ success: true, data: history });

  } catch (error: any) {
    console.error('[GET /api/mobile/streaks/engagement/history] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to fetch engagement history', data: null },
      { status: 500 }
    );
  }
}
