import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { EngageAssetService } from '@/lib/services/engage-asset-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/engage/assets/{id} → asset + usage list */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    return ok(await EngageAssetService.get((await params).id));
  } catch (error) {
    return campaignFailFrom(error, 'engage-asset');
  }
}

/** PATCH /api/admin/engage/assets/{id} { name?, tags?, alt? } */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    return ok(await EngageAssetService.patch((await params).id, await readJson(request)));
  } catch (error) {
    return campaignFailFrom(error, 'engage-asset-patch');
  }
}

/** DELETE /api/admin/engage/assets/{id} = archive (409 ASSET_IN_USE with data.usage). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    return ok(await EngageAssetService.archive((await params).id));
  } catch (error) {
    return campaignFailFrom(error, 'engage-asset-archive');
  }
}
