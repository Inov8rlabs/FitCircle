import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { parsePeriod, PmfService } from '@/lib/pmf/services/pmf-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/pmf?period=7|28|90 → PmfReport (lib/pmf/types.ts): the product-market-fit scorecard. Every KPI
 * from docs/PMF-METRICS.md and the growth plan's §4 gates with target, current vs previous window, 12-week trend,
 * platform / channel split and status, the PMF score (or why it can't be computed) and rule-based insights.
 * Real users only (test / robot accounts excluded). Same admin gate as the Ads Console. Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    return ok(await PmfService.report(parsePeriod(request.nextUrl.searchParams.get('period'))));
  } catch (error) {
    return adsFailFrom(error, 'pmf');
  }
}
