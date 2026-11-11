import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { FinanceReportService, parseFinanceRange, parseGrain } from '@/lib/finance/services/finance-report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/finance/pnl?start&end&grain=day|week|month → PnlReport (lib/finance/types.ts):
 * subscription revenue (gross, fees, net, by plan and store) + AdMob estimate − UA spend − AI model
 * spend per period, KPIs, and the recurring run-rate (MRR / ARR) at each period end. Test users
 * excluded. Default range: launch (2026-10-24) → today. Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const params = request.nextUrl.searchParams;
    return ok(await FinanceReportService.pnl(parseFinanceRange(params), parseGrain(params.get('grain'))));
  } catch (error) {
    return adsFailFrom(error, 'finance/pnl');
  }
}
