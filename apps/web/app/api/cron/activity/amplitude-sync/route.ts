import { type NextRequest, NextResponse } from 'next/server';

import { AmplitudeNotConfiguredError } from '@/lib/activity/amplitude-export';
import { AmplitudeSyncService } from '@/lib/activity/amplitude-sync-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/activity/amplitude-sync — Amplitude Export API → user_active_days (migration 136;
 * lib/activity/amplitude-sync-service.ts). CRON_SECRET bearer.
 * vercel.json: hourly at :20. Syncs every complete UTC hour after the last synced one (else the
 * last 48 h) up to now − 3 h (export latency), at most 24 hours per run.
 * Backfill: scripts/activity-backfill-amplitude.ts (day by day).
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    // Backfill one UTC day (?backfill_day=YYYY-MM-DD): the 24 hours of that day, already-synced
    // hours skipped. Lets the backfill run server-side, where the Amplitude secret lives.
    const day = request.nextUrl.searchParams.get('backfill_day');
    if (day !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'backfill_day must be YYYY-MM-DD' }, { status: 400 });
      const compact = day.replace(/-/g, '');
      const hours = await AmplitudeSyncService.syncRange(`${compact}T00`, `${compact}T23`);
      const done = hours.filter((h) => !h.skipped);
      return NextResponse.json(
        { success: true, data: { day, hours: done.length, skipped: hours.length - done.length, activeEvents: done.reduce((s, h) => s + h.activeEvents, 0), rows: done.reduce((s, h) => s + h.rows, 0) } },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    const r = await AmplitudeSyncService.cronSync();
    const synced = r.hours.filter((h) => !h.skipped);
    return NextResponse.json(
      {
        success: true,
        data: {
          from: r.from,
          to: r.to,
          lastSynced: r.lastSynced,
          hours: synced.length,
          activeEvents: synced.reduce((s, h) => s + h.activeEvents, 0),
          rows: synced.reduce((s, h) => s + h.rows, 0),
        },
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (err: any) {
    if (err instanceof AmplitudeNotConfiguredError) {
      return NextResponse.json({ success: false, configured: false, error: err.message }, { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    console.error('[Cron activity/amplitude-sync] failed:', err?.message ?? err);
    return NextResponse.json({ success: false, error: err?.message ?? 'sync failed' }, { status: 500 });
  }
}
