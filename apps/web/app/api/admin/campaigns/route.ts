import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/campaigns → { campaigns: AdminCampaign[] } */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok({ campaigns: await CampaignService.listAdmin(request.headers.get('x-client-timezone')) });
  } catch (error) {
    return campaignFailFrom(error, 'admin-list');
  }
}

/** POST /api/admin/campaigns (CampaignInput) → AdminCampaign (draft). */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    const campaign = await CampaignService.create(await readJson(request), caller.userId, request.headers.get('x-client-timezone'));
    return ok(campaign, undefined, 201);
  } catch (error) {
    return campaignFailFrom(error, 'admin-create');
  }
}
