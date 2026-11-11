import { type NextRequest, NextResponse } from 'next/server';

import { AiCostSyncService } from '@/lib/finance/services/ai-cost-sync-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/ai-costs/sync — Vercel AI Gateway spend (Custom Reporting) → ai_cost_daily, plus a
 * /v1/credits snapshot (lib/finance/services/ai-cost-sync-service.ts). CRON_SECRET bearer.
 * vercel.json: daily 09:15 UTC, last 3 UTC days (late-arriving spend).
 * One-off backfill: ?start=YYYY-MM-DD&end=YYYY-MM-DD (≤ 120 days; 1 + 3 × days billed report
 * queries at $5 / 1,000 — 120 days ≈ $1.81). ?days=N for the last N days.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const p = request.nextUrl.searchParams;
  const days = p.get('days') ? Number(p.get('days')) : undefined;
  try {
    const result = await AiCostSyncService.sync({ start: p.get('start'), end: p.get('end'), days: Number.isFinite(days) ? days : undefined, allDimensions: ['1', 'true', 'all'].includes((p.get('dimensions') ?? '').toLowerCase()) });
    return NextResponse.json({ success: true, data: result }, { headers: { 'cache-control': 'no-store' } });
  } catch (err: any) {
    console.error('[Cron ai-costs/sync] failed:', err?.message ?? err);
    return NextResponse.json({ success: false, error: err?.message ?? 'sync failed' }, { status: 500 });
  }
}
