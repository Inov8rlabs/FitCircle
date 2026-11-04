import { type NextRequest, NextResponse } from 'next/server';

import { fitCircleAdapters } from '@/lib/engagement/adapters';
import { attributeConversions } from '@/lib/engagement/adapters/fitcircle-attribution';
import { engagementFlags } from '@/lib/engagement/config';
import { cronAuthError, parseCronParams, postalAddress } from '@/lib/engagement/cron';
import { runLifecycle } from '@/lib/engagement/runners';

/**
 * GET /api/cron/engagement/lifecycle — hourly. Onboarding + re-engagement
 * steps (first meal, first circle, invite a friend, streak milestone,
 * comeback; docs/ENGAGEMENT_MESSAGING.md §3), 09:00–19:59 local, at most one
 * per person per run. Then the outcome-attribution pass (converted_at).
 * CRON_SECRET-gated, FAIL CLOSED.
 *
 * Flags (default OFF): ENGAGEMENT_EMAILS_ENABLED, ENGAGEMENT_PUSH_ENABLED.
 * `?dryRun=1` lists who would get what (flags ignored, nothing written).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const params = parseCronParams(request);
  if (params instanceof NextResponse) return params;
  const flags = engagementFlags();
  const adapters = fitCircleAdapters();
  if (!(await adapters.ledger.probe())) {
    return NextResponse.json({ success: false, error: 'ledger_unavailable (apply migration 119)' }, { status: 503 });
  }
  const result: Record<string, unknown> = { success: true, flags };
  try {
    if (params.dryRun || flags.engagementEmails || flags.engagementPush) {
      result.lifecycle = await runLifecycle(adapters, {
        now: params.now,
        dryRun: params.dryRun,
        max: params.max,
        onlyUserIds: params.onlyUserIds,
        ignoreWindow: params.ignoreWindow,
        channels: params.dryRun ? { email: true, push: true } : { email: flags.engagementEmails, push: flags.engagementPush },
        postalAddress: postalAddress(),
      });
    } else {
      result.lifecycle = { enabled: false, reason: 'ENGAGEMENT_EMAILS_ENABLED and ENGAGEMENT_PUSH_ENABLED are off' };
    }
  } catch (err: any) {
    console.error('[Cron engagement/lifecycle] failed:', err?.message);
    result.success = false;
    result.lifecycle = { error: err?.message ?? 'lifecycle failed' };
  }
  // Attribution covers every ledger row (welcome + weekly report too), so it runs even with the senders off.
  if (!params.dryRun) {
    try {
      result.attribution = await attributeConversions(adapters.analytics, { now: params.now });
    } catch (err: any) {
      result.attribution = { error: err?.message };
    }
  }
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
