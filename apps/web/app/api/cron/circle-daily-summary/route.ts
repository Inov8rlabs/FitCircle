/**
 * API Route: /api/cron/circle-daily-summary
 *
 * Emit the once-per-day circle nutrition/activity summary system post for every
 * currently-running FitCircle. This is the one system post that is time-driven
 * (not event-driven); all other system posts originate from activity hooks.
 *
 * The route is a thin shell: it verifies the cron secret and delegates to
 * DailySummaryService, which is failure-isolated per circle and idempotent
 * per day (safe to retry).
 *
 * Requires: CRON_SECRET in the authorization header (Bearer <secret>).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { DailySummaryService } from '@/lib/services/daily-summary-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (authorization === `Bearer ${CRON_SECRET}`).
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await DailySummaryService.generateForAllActiveCircles();

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Circle daily summary cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
