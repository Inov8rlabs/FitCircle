import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { parseGroupBy, parseRange } from '@/lib/ads/services/report-service';
import { AdsViralityService } from '@/lib/ads/services/virality-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/ads/virality?start&end&groupBy&includeTest → AdsVirality:
 * invites, friends brought in, K-factor and socially activated users of the
 * sign-up cohort, by the same breakdowns as the overview (ADS_METRICS_METHODOLOGY §8). Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    return ok(await AdsViralityService.report(parseRange(params), parseGroupBy(params.get('groupBy'))));
  } catch (error) {
    return adsFailFrom(error, 'virality');
  }
}
