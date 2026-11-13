import { type NextRequest, NextResponse } from 'next/server';

import { LeaderboardOvertakeService } from '@/lib/services/leaderboard-overtake-service';

/**
 * GET /api/cron/leaderboard-overtakes — "someone moved past you" pushes (docs/PUSH_NOTIFICATIONS.md §8.6).
 * Hourly at :45: circles in their local 18:00 hour are snapshotted (circle_leaderboard_snapshots,
 * migration 137) and diffed against yesterday. CRON_SECRET-gated, FAIL CLOSED.
 * Kill switch: LEADERBOARD_OVERTAKE_PUSH_ENABLED=false (dry runs still answer).
 *
 * Query: ?dry_run=1 (no snapshot write, no send) · &any_hour=1 (dry run: ignore the 18:00 window)
 *        · &circleId=<uuid>.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const q = request.nextUrl.searchParams;
  const flag = (k: string) => ['1', 'true', 'yes'].includes((q.get(k) ?? '').toLowerCase());
  const dryRun = flag('dry_run');
  const circleId = q.get('circleId') ?? undefined;
  if (circleId && !/^[0-9a-f-]{36}$/i.test(circleId)) {
    return NextResponse.json({ error: 'circleId must be a uuid' }, { status: 400 });
  }
  if (!dryRun && (process.env.LEADERBOARD_OVERTAKE_PUSH_ENABLED ?? '').toLowerCase() === 'false') {
    return NextResponse.json({ success: true, disabled: true });
  }
  try {
    const result = await LeaderboardOvertakeService.run({ dryRun, circleId, ignoreHour: dryRun && flag('any_hour') });
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[Cron leaderboard-overtakes] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'overtakes failed' }, { status: 500 });
  }
}
