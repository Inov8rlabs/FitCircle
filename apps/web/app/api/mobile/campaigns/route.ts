import { type NextRequest } from 'next/server';

import { requireUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { resolvePlatform } from '@/lib/engage/platform';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/campaigns → { campaigns: CampaignView[], homeSlug }
 * (docs/CAMPAIGNS_SPEC.md §3). "Today" = x-client-timezone local day, or the
 * admin preview date. Filtered by campaigns.platforms for the caller's
 * platform (x-platform; ENGAGE_SPEC §15).
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const profile = await requireUser(request);
    return ok(await CampaignService.listForViewer(profile, request.headers.get('x-client-timezone'), resolvePlatform(request)), startTime);
  } catch (error) {
    return campaignFailFrom(error, 'list');
  }
}
