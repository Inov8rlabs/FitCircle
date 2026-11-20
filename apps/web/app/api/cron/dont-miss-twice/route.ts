import { type NextRequest, NextResponse } from 'next/server';

import { dontMissTwiceEnabled } from '@/lib/journey/dont-miss-twice';
import { DontMissTwiceService } from '@/lib/services/dont-miss-twice-service';

/**
 * GET /api/cron/dont-miss-twice — the D+1 push after a first missed day (docs/ENGAGEMENT_115_SPEC.md §5.2):
 * dont_miss_twice or streak_save_offer, one per lapse. Hourly at :10; each user goes in their send
 * hour. CRON_SECRET-gated, FAIL CLOSED.
 * Kill switch: DONT_MISS_TWICE_PUSH_ENABLED (OFF unless 'true'); off → the route only answers dry runs
 * and the nightly cron sends streak_lost / shield_applied as before.
 *
 * Query:
 *   ?dry_run=1      decide + build the copy; no protect-or-break, no offer row, no push.
 *   &all_hours=1    (dry run) ignore the send hour: "who would get one today".
 *   &as_of=<ISO>    (dry run) evaluate at that instant.
 *   &userId=<uuid>  one user only.
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
  const userId = q.get('userId') ?? undefined;
  if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });
  }
  let now: Date | undefined;
  const asOf = q.get('as_of');
  if (asOf) {
    if (!dryRun) return NextResponse.json({ error: 'as_of is only allowed with dry_run=1' }, { status: 400 });
    now = new Date(asOf);
    if (!Number.isFinite(now.getTime())) return NextResponse.json({ error: 'as_of must be an ISO timestamp' }, { status: 400 });
  }
  if (!dryRun && !dontMissTwiceEnabled()) {
    return NextResponse.json({ success: true, disabled: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await DontMissTwiceService.run({
      dryRun,
      now,
      allHours: dryRun && flag('all_hours'),
      userIds: userId ? [userId] : undefined,
    });
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[Cron dont-miss-twice] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'dont-miss-twice failed' }, { status: 500 });
  }
}
