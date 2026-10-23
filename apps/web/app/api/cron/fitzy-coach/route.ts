import { type NextRequest, NextResponse } from 'next/server';

import { FITZY_PUSH_TYPES, type FitzyPushType } from '@/lib/fitzy/push';
import { FitzyPushService } from '@/lib/services/fitzy-push-service';

/**
 * GET /api/cron/fitzy-coach — Fitzy coaching tips as push notifications
 * (docs/FITZY_PUSH_NOTIFICATIONS.md). Runs HOURLY at :10; each user is considered only when their
 * LOCAL hour is in a slot window. Idempotent: one morning tip + at most one contextual nudge per
 * user per local day (fitzy_push_deliveries claim). CRON_SECRET-gated, FAIL CLOSED.
 *
 * Kill switch: nothing is sent unless FITZY_PUSH_ENABLED=true.
 * Ops / QA (same secret):
 *   ?dryRun=1                         decisions for everyone in a window right now; no claim, no model, no send
 *   ?dryRun=1&userId=<uuid>           one user's decision
 *   ?userId=<uuid>&force=<type>       send that kind to that user now (test push; bypasses the hour
 *                                     window, kill switch, spacing and weekly caps — the orchestrator
 *                                     still applies the coach toggle, quiet hours and the daily cap)
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const dryRun = params.get('dryRun') === '1' || params.get('dryRun') === 'true';
  const userId = params.get('userId') ?? undefined;
  const forceRaw = params.get('force');
  if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });
  }
  if (forceRaw && (!userId || !(FITZY_PUSH_TYPES as readonly string[]).includes(forceRaw))) {
    return NextResponse.json({ error: `force needs userId and one of ${FITZY_PUSH_TYPES.join(', ')}` }, { status: 400 });
  }

  try {
    const result = await FitzyPushService.run({ dryRun, userId, force: (forceRaw as FitzyPushType) || undefined, budgetMs: 240_000 });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron fitzy-coach] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'fitzy-coach failed' }, { status: 500 });
  }
}
