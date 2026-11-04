import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { AdRevenueReportService, parseRevenuePlatform } from '@/lib/ads/services/ad-revenue-report-service';
import { parseRange } from '@/lib/ads/services/report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/ads/revenue?start&end&includeTest&platform → AdsRevenueReport:
 * AdMob estimated earnings, requests, match / show rate, impressions, clicks,
 * CTR, eCPM and ARPDAU by platform, ad unit, country and format; revenue vs
 * spend per day; returns on ad spend per paid channel (ADS_METRICS_METHODOLOGY §9). Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    return ok(await AdRevenueReportService.report(parseRange(params), parseRevenuePlatform(params.get('platform'))));
  } catch (error) {
    return adsFailFrom(error, 'revenue');
  }
}
