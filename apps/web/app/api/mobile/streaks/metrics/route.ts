import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MetricStreakService } from '@/lib/services/metric-streak-service';

/**
 * GET /api/mobile/streaks/metrics
 * Get all metric streaks for user (weight, steps, mood, measurements, photos)
 *
 * `data` is an OBJECT keyed by metric, each value a streak or null. Do not turn
 * it into an array: Android decodes the keyed object. Each streak additionally
 * carries `total_logs_count` and a 30-day `trend`.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    console.log('[GET /api/mobile/streaks/metrics] Fetching all metric streaks for user:', user.id);

    // Honour the device's local timezone so the trend ends on the user's today.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    // Get all metric streaks
    const streaks = await MetricStreakService.getMetricStreaks(user.id, timezone);

    return NextResponse.json({ success: true, data: streaks });

  } catch (error: any) {
    console.error('[GET /api/mobile/streaks/metrics] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to fetch metric streaks', data: null },
      { status: 500 }
    );
  }
}
