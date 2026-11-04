import { type NextRequest, NextResponse } from 'next/server';

import { ProLifecyclePushService } from '@/lib/services/pro-lifecycle-push-service';

/**
 * GET /api/cron/pro-lifecycle — "your free Pro ends tomorrow" pushes (10:00
 * local the day before) and the "your Pro ended" pushes that quiet hours
 * deferred (docs/PRO_LIFECYCLE_PROMPTS.md §4). Hourly. CRON_SECRET-gated,
 * FAIL CLOSED.
 *   ?dryRun=true   compute + report what would be sent; send / write nothing
 *   ?userId=<uuid> one user only
 * Kill switches: PRO_ENDING_PROMPTS_ENABLED=false, PRO_ENDING_PUSH_DRY_RUN=true,
 * the Admin Tools master switch and per-state push toggles.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const userId = params.get('userId') ?? undefined;
  if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });
  }
  const dryRun = ['1', 'true', 'yes'].includes((params.get('dryRun') ?? '').toLowerCase());
  try {
    const result = await ProLifecyclePushService.run({ userId, dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron pro-lifecycle] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'pro lifecycle pushes failed' }, { status: 500 });
  }
}
