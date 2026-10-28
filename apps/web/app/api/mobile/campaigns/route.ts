import { type NextRequest } from 'next/server';

import { requireUser } from '@/lib/campaigns/admin-auth';
import { iconCompatFor } from '@/lib/design/icon-compat';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/campaigns → { campaigns: CampaignView[], homeSlug }
 * (docs/CAMPAIGNS_SPEC.md §3). "Today" = x-client-timezone local day, or the
 * admin preview date.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const profile = await requireUser(request);
    return ok(iconCompatFor(request, await CampaignService.listForViewer(profile, request.headers.get('x-client-timezone'))), startTime);
  } catch (error) {
    return campaignFailFrom(error, 'list');
  }
}
