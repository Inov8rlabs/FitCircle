import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, readJson, requireAdsAdmin } from '@/lib/ads/http';
import { parseChannel } from '@/lib/ads/services/report-service';
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

/** POST /api/admin/ads/sync { channel? } → sync now (no-op per channel if one finished < 2 min ago). */
export async function POST(request: NextRequest) {
  try {
    await requireAdsAdmin(request, { mutating: true });
    const body = await readJson(request);
    const channel = parseChannel(typeof body?.channel === 'string' ? body.channel : null);
    const results = await AdsSyncService.run({ channels: channel ? [channel] : undefined, trigger: 'manual', debounce: true });
    return ok({ results, status: await AdsSyncService.status() });
  } catch (error) {
    return adsFailFrom(error, 'sync-now');
  }
}
