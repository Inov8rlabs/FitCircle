import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/campaigns/{id} → AdminCampaign */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    return ok(await CampaignService.getAdmin(id, request.headers.get('x-client-timezone')));
  } catch (error) {
    return campaignFailFrom(error, 'admin-get');
  }
}

/** PATCH /api/admin/campaigns/{id} { version, ...Partial<CampaignInput> } → AdminCampaign (409 VERSION_CONFLICT). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const caller = await requireAdmin(request);
    const { id } = await params;
    const body = await readJson(request);
    return ok(await CampaignService.patch(id, body, caller.userId, request.headers.get('x-client-timezone')));
  } catch (error) {
    return campaignFailFrom(error, 'admin-patch');
  }
}

/** DELETE /api/admin/campaigns/{id} = archive. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const caller = await requireAdmin(request);
    const { id } = await params;
    return ok(await CampaignService.archive(id, caller.userId, request.headers.get('x-client-timezone')));
  } catch (error) {
    return campaignFailFrom(error, 'admin-archive');
  }
}
