import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, readJson, requireAdsAdmin } from '@/lib/ads/http';
import { parseChannel } from '@/lib/ads/services/report-service';
import { AdRevenueSyncService } from '@/lib/ads/services/ad-revenue-sync-service';
import { AdsSyncService } from '@/lib/ads/services/sync-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/admin/ads/sync → { status: ChannelSyncStatus[] } */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    return ok({ status: await AdsSyncService.status() });
  } catch (error) {
    return adsFailFrom(error, 'sync-status');
  }
}

/** POST /api/admin/ads/sync { channel? } → sync now (no-op per channel if one finished < 2 min ago); without channel also AdMob. */
export async function POST(request: NextRequest) {
  try {
    await requireAdsAdmin(request, { mutating: true });
    const body = await readJson(request);
    const channel = parseChannel(typeof body?.channel === 'string' ? body.channel : null);
    const results = await AdsSyncService.run({ channels: channel ? [channel] : undefined, trigger: 'manual', debounce: true });
    // AdMob ad revenue rides along on a full sync (failures are reported, never thrown).
    const adRevenue = channel ? null : await AdRevenueSyncService.run({ trigger: 'manual', debounce: true }).catch((e: any) => ({ channel: 'admob' as const, ok: false, range: null, rows: 0, error: String(e?.message ?? e), runId: null }));
    return ok({ results, adRevenue, status: await AdsSyncService.status() });
  } catch (error) {
    return adsFailFrom(error, 'sync-now');
  }
}
