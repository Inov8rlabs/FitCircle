import { type NextRequest, NextResponse } from 'next/server';

import { AdsEmailReportService, reportRecipients } from '@/lib/ads/services/email-report-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/cron/ads/report — twice-daily ads performance email
 * (lib/ads/email-report.ts). CRON_SECRET bearer.
 *
 * vercel.json schedule "0 12,22 * * *" (UTC) = 8:00 and 18:00 Toronto during
 * EDT; after DST ends (Nov 1 2026) it runs at 7:00 and 17:00 EST. Day windows
 * use the Ads Console report time zone (ADS_REPORT_TIMEZONE, default
 * America/New_York — the same clock as Toronto, and the Apple Ads org zone
 * that ad_metrics_daily dates are in).
 *
 * ?dryRun=1 renders without sending → JSON { subject, text, html, report,
 * recipients }; add &format=html (or text) for the rendered body only.
 * Recipients: ADS_REPORT_RECIPIENTS (comma-separated), default ani@inov8rlabs.com.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const dry = (params.get('dryRun') ?? '').toLowerCase();
  const dryRun = dry === '1' || dry === 'true';
  const recipients = reportRecipients();

  try {
    const rendered = await AdsEmailReportService.build();
    if (dryRun) {
      const format = params.get('format');
      if (format === 'html') return new NextResponse(rendered.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (format === 'text') return new NextResponse(rendered.text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      return NextResponse.json({ success: true, data: { dryRun: true, sent: false, recipients, ...rendered } });
    }
    const result = await AdsEmailReportService.send(rendered, recipients);
    if (!result.success) {
      console.error('[cron/ads/report] send failed:', result.error);
      return NextResponse.json({ success: false, error: result.error ?? 'send failed', data: { subject: rendered.subject } }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: { sent: true, recipients, subject: rendered.subject, alerts: rendered.report.alerts.length, id: result.id ?? null } });
  } catch (error: any) {
    console.error('[cron/ads/report] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
