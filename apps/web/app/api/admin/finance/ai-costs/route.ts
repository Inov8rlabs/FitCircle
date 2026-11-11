import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { FinanceReportService, parseFinanceRange } from '@/lib/finance/services/finance-report-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/finance/ai-costs?start&end&includeTest → AiCostsReport (lib/finance/types.ts):
 * AI model spend from the gateway report (ai_cost_daily) split into production / test users /
 * eval-dev / unattributed, per DAU and per paying / trial / free user, by day, feature, model and
 * user, with ledger-vs-gateway reconciliation. Default range: launch (2026-10-24) → today. Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    return ok(await FinanceReportService.aiCosts(parseFinanceRange(request.nextUrl.searchParams)));
  } catch (error) {
    return adsFailFrom(error, 'finance/ai-costs');
  }
}
