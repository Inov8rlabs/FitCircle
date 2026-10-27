import { type NextRequest, NextResponse } from 'next/server';

import { ReleaseSyncService } from '@/lib/releases/services/sync-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/releases/sync (hourly at :35) — App Store Connect + Google Play
 * releases into public.releases (docs/RELEASES_TRACKER_SPEC.md §5). CRON_SECRET bearer.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const results = await ReleaseSyncService.run({ trigger: 'cron' });
    return NextResponse.json({ success: true, data: { results } });
  } catch (error: any) {
    console.error('[cron/releases/sync] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
