import { type NextRequest, NextResponse } from 'next/server';

import { WinbackService } from '@/lib/services/winback-service';

/**
 * GET /api/cron/winback — the win-back ladder for lapsed users (docs/PUSH_NOTIFICATIONS.md §8.4).
 * Hourly at :30: each user is evaluated once a day, in their local 18:00–19:00 window
 * (so 18:30 in whole-hour zones). CRON_SECRET-gated, FAIL CLOSED.
 * Kill switch: WINBACK_PUSH_ENABLED=false (the route then only answers dry runs).
 *
 * Query:
 *   ?dry_run=1        decide, build the copy, send nothing; returns every decision.
 *   &all_windows=1    (dry run) ignore the local-time window: "who is due today at all".
 *   &as_of=<ISO>      (dry run) evaluate at that instant instead of now.
 *   &userId=<uuid>    one user only.
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
  if (!dryRun && (process.env.WINBACK_PUSH_ENABLED ?? '').toLowerCase() === 'false') {
    return NextResponse.json({ success: true, disabled: true });
  }
  try {
    const result = await WinbackService.run({
      dryRun,
      now,
      ignoreWindow: dryRun && flag('all_windows'),
      userIds: userId ? [userId] : undefined,
    });
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[Cron winback] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'winback failed' }, { status: 500 });
  }
}
