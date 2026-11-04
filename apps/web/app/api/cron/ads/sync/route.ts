import { type NextRequest, NextResponse } from 'next/server';

import { isYmd } from '@/lib/ads/dates';
import { AdRevenueSyncService } from '@/lib/ads/services/ad-revenue-sync-service';
import { AdsSyncService } from '@/lib/ads/services/sync-service';
import { AD_CHANNELS, type AdChannel } from '@/lib/ads/types';
import { adminUnauthorized } from '@/lib/referrals/http';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/ads/sync (hourly at :20) — Apple Ads / Meta / Google Ads entities
 * + daily metrics for today-3 … today (ADS_CONSOLE_SPEC §6), then AdMob ad
 * revenue (ad_revenue_daily, Pacific today-3 … today). CRON_SECRET bearer.
 * A channel's first successful run backfills since its earliest campaign start.
 *
 * Backfill: ?start=YYYY-MM-DD&end=YYYY-MM-DD[&channel=apple_ads] — requires the
 * ADMIN_API_SECRET bearer instead. ?channel=admob backfills AdMob only.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const backfill = params.has('start') || params.has('end') || params.has('channel');
  if (backfill) {
    const denied = adminUnauthorized(request);
    if (denied) return denied;
  } else if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = params.get('start') ?? undefined;
  const end = params.get('end') ?? undefined;
  const channel = params.get('channel');
  if ((start && !isYmd(start)) || (end && !isYmd(end)) || (start && end && start > end)) {
    return NextResponse.json({ error: 'start/end must be YYYY-MM-DD with start <= end' }, { status: 400 });
  }
  if (channel && channel !== 'admob' && !(AD_CHANNELS as string[]).includes(channel)) {
    return NextResponse.json({ error: `channel must be one of ${[...AD_CHANNELS, 'admob'].join(', ')}` }, { status: 400 });
  }

  try {
    const trigger = backfill ? 'backfill' : 'cron';
    const results = channel === 'admob' ? [] : await AdsSyncService.run({ channels: channel ? [channel as AdChannel] : undefined, start, end, trigger });
    // Ad revenue never blocks (or is blocked by) the ad network sync.
    const adRevenue = !channel || channel === 'admob' ? await AdRevenueSyncService.run({ start, end, trigger }).catch((e: any) => ({ channel: 'admob' as const, ok: false, range: null, rows: 0, error: String(e?.message ?? e).slice(0, 500), runId: null })) : null;
    return NextResponse.json({ success: true, data: { results, adRevenue } });
  } catch (error: any) {
    console.error('[cron/ads/sync] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
