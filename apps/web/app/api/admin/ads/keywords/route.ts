import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { AdsKeywordFunnelService, parseFunnelChannel, parseFunnelLevel } from '@/lib/ads/services/keyword-funnel-service';
import { parseRange } from '@/lib/ads/services/report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/ads/keywords?start&end&channel&level&includeTest → AdsKeywordFunnel:
 * spend → taps → installs → sign-ups → paywall → trials → payers → net revenue
 * per keyword (Apple Ads) or ad group (Apple Ads, Google Ads), with an explicit
 * unattributed row so rows reconcile with the campaign totals
 * (ADS_METRICS_METHODOLOGY §10). Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    const channel = parseFunnelChannel(params.get('channel'));
    return ok(await AdsKeywordFunnelService.report(parseRange(params), channel, parseFunnelLevel(params.get('level'), channel)));
  } catch (error) {
    return adsFailFrom(error, 'keywords');
  }
}
