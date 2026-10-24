import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { AdsReportService, parseGroupBy, parseRange } from '@/lib/ads/services/report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/admin/ads/overview?start&end&groupBy → { rows, totals, lastSync, … } (ADS_CONSOLE_SPEC §7). */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    return ok(await AdsReportService.overview(parseRange(params), parseGroupBy(params.get('groupBy'))));
  } catch (error) {
    return adsFailFrom(error, 'overview');
  }
}
