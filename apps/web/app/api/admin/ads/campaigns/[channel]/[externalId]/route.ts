import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { AdsReportService, parseChannel, parseRange } from '@/lib/ads/services/report-service';
import { CampaignError } from '@/lib/campaigns/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ channel: string; externalId: string }> };

/** GET /api/admin/ads/campaigns/{channel}/{externalId}?start&end → campaign + ad groups + keywords + ads, each with metrics. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdsAdmin(request);
    const { channel, externalId } = await params;
    const ch = parseChannel(channel);
    if (!ch) throw new CampaignError(400, 'VALIDATION_ERROR', 'channel is required');
    return ok(await AdsReportService.campaign(parseRange(request.nextUrl.searchParams), ch, decodeURIComponent(externalId)));
  } catch (error) {
    return adsFailFrom(error, 'campaign');
  }
}
