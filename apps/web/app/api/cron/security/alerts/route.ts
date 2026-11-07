import * as Sentry from '@sentry/nextjs';
import { type NextRequest, NextResponse } from 'next/server';

import { SECURITY_ALERT_MONITOR_SLUG, runSecurityAlerts } from '@/lib/security/alerts';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/cron/security/alerts (every 15 min) — security signals vs thresholds, alert
 * email + Sentry message per firing signal (2 h cooldown), hourly Security Summary to
 * Amplitude on the :00 run (docs/SECURITY_TELEMETRY.md). CRON_SECRET bearer.
 * ?dryRun=1 evaluates without sending or saving cooldown state.
 *
 * Wrapped in a Sentry Cron Monitor check-in (slug security-alert-cron, every 15 minutes)
 * so a stopped detector is itself an alert.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = (request.nextUrl.searchParams.get('dryRun') ?? '').toLowerCase();
  const dryRun = dry === '1' || dry === 'true';
  try {
    const run = () => runSecurityAlerts(new Date(), { dryRun });
    const result = dryRun
      ? await run()
      : await Sentry.withMonitor(SECURITY_ALERT_MONITOR_SLUG, run, {
          schedule: { type: 'crontab', value: '*/15 * * * *' },
          checkinMargin: 5,
          maxRuntime: 5,
          timezone: 'Etc/UTC',
        });
    return NextResponse.json({ success: true, data: { dryRun, ...result } });
  } catch (error: any) {
    console.error('[cron/security/alerts] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
