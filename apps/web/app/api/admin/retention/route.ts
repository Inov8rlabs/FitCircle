import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { parseRange } from '@/lib/ads/services/report-service';
import { RetentionReportService } from '@/lib/services/retention-report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/retention?start=YYYY-MM-DD&end=YYYY-MM-DD&includeTest=1
 * → D1 / D7 retention of the sign-up cohort from server-side app opens
 * (app_opens, migration 133), as totals and by platform, by acquisition source
 * and by platform × source. Same admin gate, range and test-user exclusion as
 * the Ads Console routes (ADMIN_API_SECRET bearer or an admin session). Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    return ok(await RetentionReportService.report(parseRange(request.nextUrl.searchParams)));
  } catch (error) {
    return adsFailFrom(error, 'retention');
  }
}
