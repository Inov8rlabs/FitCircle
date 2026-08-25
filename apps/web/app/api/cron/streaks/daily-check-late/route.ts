import { type NextRequest } from 'next/server';

import { runDailyStreakCheck } from '@/lib/cron/streak-daily-check';

export const maxDuration = 300;

/**
 * GET /api/cron/streaks/daily-check-late
 * Second pass of the daily streak check (04:00 UTC). Vercel identifies cron
 * jobs by path, so the two schedules need two distinct routes — a duplicate
 * path only registers once. This pass catches users whose local 3am grace
 * window was still open when the midnight-UTC pass skipped them.
 */
export async function GET(request: NextRequest) {
  return runDailyStreakCheck(request);
}
