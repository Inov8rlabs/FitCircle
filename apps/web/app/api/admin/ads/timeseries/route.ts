import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { AdsReportService, parseChannel, parseRange } from '@/lib/ads/services/report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/admin/ads/timeseries?start&end&channel?&campaign? → daily spend / users / payers / revenue (by sign-up day). */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    const campaign = params.get('campaign')?.trim() || null;
    return ok(await AdsReportService.timeseries(parseRange(params), { channel: parseChannel(params.get('channel')), campaignExternalId: campaign }));
  } catch (error) {
    return adsFailFrom(error, 'timeseries');
  }
}
