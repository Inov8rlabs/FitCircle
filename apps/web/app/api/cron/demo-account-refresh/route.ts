import { type NextRequest, NextResponse } from 'next/server';

import { DemoAccountService } from '@/lib/services/demo-account-service';

export const maxDuration = 60;

/**
 * GET /api/cron/demo-account-refresh
 * Slides the App Review demo account's history forward so its newest entries
 * are always today's. Touches only the demo user and the demo circle.
 *
 * Schedule: once a day at 16:00 UTC — morning in Pacific time, after the
 * seeded breakfast entry's time of day (configured in vercel.json).
 * Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[Cron Demo Account Refresh] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await DemoAccountService.refresh();
    console.log('[Cron Demo Account Refresh]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Cron Demo Account Refresh] Failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
