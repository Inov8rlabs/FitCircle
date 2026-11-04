import { type NextRequest, NextResponse } from 'next/server';

import { fitCircleAdapters } from '@/lib/engagement/adapters';
import { engagementFlags } from '@/lib/engagement/config';
import { cronAuthError, parseCronParams, postalAddress } from '@/lib/engagement/cron';
import { runWeeklyReports } from '@/lib/engagement/runners';

/**
 * GET /api/cron/engagement/weekly-report — hourly. Sends each person their
 * weekly report once per ISO week in their local Sunday 18:00–21:59 window
 * (docs/ENGAGEMENT_MESSAGING.md §4). CRON_SECRET-gated, FAIL CLOSED.
 *
 * Flags (default OFF): WEEKLY_REPORT_ENABLED (email), WEEKLY_REPORT_PUSH_ENABLED (push).
 * `?dryRun=1` returns who would get what and sends/writes nothing (works with
 * the flags off); add `&ignoreWindow=1` or `&now=<ISO>` to preview outside Sunday evening.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const params = parseCronParams(request);
  if (params instanceof NextResponse) return params;
  const flags = engagementFlags();
  if (!params.dryRun && !flags.weeklyReport) {
    return NextResponse.json({ success: true, enabled: false, reason: 'WEEKLY_REPORT_ENABLED is off' });
  }
  const adapters = fitCircleAdapters();
  if (!(await adapters.ledger.probe())) {
    return NextResponse.json({ success: false, error: 'ledger_unavailable (apply migration 119)' }, { status: 503 });
  }
  try {
    const summary = await runWeeklyReports(adapters, {
      now: params.now,
      dryRun: params.dryRun,
      max: params.max,
      onlyUserIds: params.onlyUserIds,
      ignoreWindow: params.ignoreWindow,
      // Dry runs show what WOULD go out once enabled.
      channels: params.dryRun ? { email: true, push: true } : { email: flags.weeklyReport, push: flags.weeklyReportPush },
      postalAddress: postalAddress(),
    });
    return NextResponse.json({ success: true, flags, ...summary });
  } catch (err: any) {
    console.error('[Cron engagement/weekly-report] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'weekly report failed' }, { status: 500 });
  }
}
