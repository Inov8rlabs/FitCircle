import { type NextRequest } from 'next/server';

import { CampaignError } from '@/lib/campaigns/http';
import { SYNC_SOURCES } from '@/lib/releases/connectors';
import { ok, readJson, releasesFailFrom, requireReleasesAdmin } from '@/lib/releases/http';
import { ReleaseSyncService } from '@/lib/releases/services/sync-service';
import type { SyncSource } from '@/lib/releases/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/admin/releases/sync → { status: ReleaseSyncStatus[] } */
export async function GET(request: NextRequest) {
  try {
    await requireReleasesAdmin(request);
    return ok({ status: await ReleaseSyncService.status() });
  } catch (error) {
    return releasesFailFrom(error, 'sync-status');
  }
}

/** POST /api/admin/releases/sync { source? } → sync now (no-op per source if one finished < 2 min ago). */
export async function POST(request: NextRequest) {
  try {
    await requireReleasesAdmin(request, { mutating: true });
    const body = await readJson(request);
    const source = typeof body?.source === 'string' ? body.source : null;
    if (source && !(SYNC_SOURCES as string[]).includes(source)) throw new CampaignError(400, 'VALIDATION_ERROR', `source must be one of ${SYNC_SOURCES.join(', ')}`);
    const results = await ReleaseSyncService.run({ sources: source ? [source as SyncSource] : undefined, trigger: 'manual', debounce: true });
    return ok({ results, status: await ReleaseSyncService.status() });
  } catch (error) {
    return releasesFailFrom(error, 'sync-now');
  }
}
