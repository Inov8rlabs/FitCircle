import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { parseChannel, parseRange } from '@/lib/ads/services/report-service';
import { AdsVerifyService } from '@/lib/ads/services/verify-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/ads/verify?start&end&channel=apple_ads → live network totals vs
 * stored spend / impressions / taps / installs, with per-field diffs. Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    return ok(await AdsVerifyService.verify(parseRange(params), parseChannel(params.get('channel')) ?? 'apple_ads'));
  } catch (error) {
    return adsFailFrom(error, 'verify');
  }
}
