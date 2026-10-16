import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/campaigns/{id}/unpublish → AdminCampaign */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    const { id } = await params;
    return ok(await CampaignService.unpublish(id, caller.userId, request.headers.get('x-client-timezone')));
  } catch (error) {
    return campaignFailFrom(error, 'admin-unpublish');
  }
}
