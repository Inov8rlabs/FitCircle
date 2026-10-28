import { type NextRequest } from 'next/server';

import { iconCompatFor } from '@/lib/design/icon-compat';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { failFrom, ok } from '@/lib/referrals/http';
import { seasonsFor } from '@/lib/seasonal/seasons';
import { CampaignService, viewerToday } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/seasonal — the promoted seasonal circle (REFERRALS_SPEC §10.4).
 * Built from published seasonal_circle campaigns with a legacy_season_key
 * (docs/CAMPAIGNS_SPEC.md §3); falls back to lib/seasonal/seasons.ts when the
 * campaigns query fails. "Today" is the caller's local day (x-client-timezone)
 * or the admin preview date.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const profile = await requireMobileAuth(request);
    const tz = request.headers.get('x-client-timezone');
    try {
      return ok(iconCompatFor(request, await CampaignService.seasonalFor(profile, tz)), startTime);
    } catch (err: any) {
      console.error('[seasonal] campaigns query failed, using built-in seasons:', err?.message);
      return ok(iconCompatFor(request, seasonsFor(viewerToday(profile, tz))), startTime);
    }
  } catch (error) {
    return failFrom(error, 'seasonal');
  }
}
