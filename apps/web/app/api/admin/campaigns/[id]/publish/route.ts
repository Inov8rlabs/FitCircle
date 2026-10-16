import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/campaigns/{id}/publish { acceptFallbackArt?: boolean } → AdminCampaign.
 * 422 INCOMPLETE with data.issues when the checklist isn't met.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    const { id } = await params;
    const body = await readJson(request);
    const campaign = await CampaignService.publish(
      id,
      caller.userId,
      { acceptFallbackArt: body?.acceptFallbackArt === true },
      request.headers.get('x-client-timezone')
    );
    return ok(campaign);
  } catch (error) {
    return campaignFailFrom(error, 'admin-publish');
  }
}
