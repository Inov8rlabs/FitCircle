import { type NextRequest } from 'next/server';

import { runDailyStreakCheck } from '@/lib/cron/streak-daily-check';

// Each user check is several sequential DB round-trips; the default
// function timeout would abort mid-run and leave the tail unprocessed.
export const maxDuration = 300;

/**
 * GET /api/cron/streaks/daily-check
 * Daily cron job to check for broken streaks and auto-apply shields.
 *
 * Runs twice a day (00:00 here, 04:00 via /daily-check-late — the late pass
 * covers users whose local 3am grace window was still open at midnight
 * UTC). Protected by CRON_SECRET. Idempotent per user per day.
 *
 * For every user with an active streak:
 * 1. Checks whether they claimed yesterday (in THEIR timezone)
 * 2. Auto-applies a shield if they have one → "a shield saved your streak" push
 * 3. Otherwise breaks the streak → "your streak ended" push (with a Pro
 *    pitch when they ran out of shields)
 */
export async function GET(request: NextRequest) {
  return runDailyStreakCheck(request);
}
