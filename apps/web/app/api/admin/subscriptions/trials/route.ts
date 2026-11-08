import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { parseTrialsQuery } from '@/lib/trials/classify';
import { TrialsAdminService } from '@/lib/trials/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/subscriptions/trials?range=7d|30d|90d|all&includeSandbox&includeTest&platform
 * → TrialsList (lib/trials/types.ts). Default: real production trials, all time.
 * Auth: the shared admin gate (ADMIN_API_SECRET + X-Admin-Actor from Admin Tools, or an is_admin session).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    return ok(await TrialsAdminService.list(parseTrialsQuery(request.nextUrl.searchParams)));
  } catch (error) {
    return adsFailFrom(error, 'trials/list');
  }
}
