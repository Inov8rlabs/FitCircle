import { type NextRequest, NextResponse } from 'next/server';

import { ensureRunningBackendRelease, type BackendRegistration } from '@/lib/releases/services/backend-release';
import { ReleaseSyncService } from '@/lib/releases/services/sync-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/releases/sync (hourly at :35) — App Store Connect + Google Play
 * releases into public.releases, plus the running backend deploy's own row
 * (docs/RELEASES_TRACKER_SPEC.md §3). CRON_SECRET bearer.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    let backend: BackendRegistration | { error: string };
    try {
      backend = await ensureRunningBackendRelease();
    } catch (e: any) {
      // Never blocks the store syncs.
      console.error('[cron/releases/sync] backend self-registration failed:', e?.message);
      backend = { error: String(e?.message ?? e).slice(0, 500) };
    }
    const results = await ReleaseSyncService.run({ trigger: 'cron' });
    return NextResponse.json({ success: true, data: { results, backend } });
  } catch (error: any) {
    console.error('[cron/releases/sync] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
