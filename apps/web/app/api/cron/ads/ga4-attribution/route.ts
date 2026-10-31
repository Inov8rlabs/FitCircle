import { type NextRequest, NextResponse } from 'next/server';

import { isYmd } from '@/lib/ads/dates';
import { Ga4AttributionService } from '@/lib/ads/services/ga4-attribution-service';
import { adminUnauthorized } from '@/lib/referrals/http';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/ads/ga4-attribution (daily) — upgrade organic / unknown Android
 * users to google_ads from the GA4 BigQuery export (docs/ADS_ATTRIBUTION_GA4.md).
 * CRON_SECRET bearer. Kill switch GA4_ATTRIBUTION_SYNC_ENABLED (default off →
 * 200 { skipped: 'disabled' }); BigQuery env unset → { skipped: 'not_configured' }.
 *
 * ?dryRun=1 counts what would change without writing (cron secret is enough).
 * Backfill ?start=YYYY-MM-DD&end=YYYY-MM-DD needs the ADMIN_API_SECRET bearer.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const backfill = params.has('start') || params.has('end');
  if (backfill) {
    const denied = adminUnauthorized(request);
    if (denied) return denied;
  } else if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const start = params.get('start') ?? undefined;
  const end = params.get('end') ?? undefined;
  if ((start && !isYmd(start)) || (end && !isYmd(end)) || (start && end && start > end)) {
    return NextResponse.json({ error: 'start/end must be YYYY-MM-DD with start <= end' }, { status: 400 });
  }
  const dry = (params.get('dryRun') ?? '').toLowerCase();
  try {
    const data = await Ga4AttributionService.run({ start, end, dryRun: dry === '1' || dry === 'true' });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[cron/ads/ga4-attribution] failed:', error?.message);
    return NextResponse.json({ success: false, error: String(error?.message ?? 'Internal server error').slice(0, 300) }, { status: 500 });
  }
}
