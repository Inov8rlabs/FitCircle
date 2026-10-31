import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { EngageSegmentService } from '@/lib/services/engage-segment-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/engage/segments/{id} → segment + usage */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    return ok(await EngageSegmentService.get((await params).id));
  } catch (error) {
    return campaignFailFrom(error, 'engage-segment');
  }
}

/** PATCH /api/admin/engage/segments/{id} { name?, description?, filters? } */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const caller = await requireAdmin(request);
    return ok(await EngageSegmentService.patch((await params).id, await readJson(request), caller.userId));
  } catch (error) {
    return campaignFailFrom(error, 'engage-segment-patch');
  }
}

/** DELETE /api/admin/engage/segments/{id} = archive (409 SEGMENT_IN_USE). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    await EngageSegmentService.archive((await params).id);
    return ok({ archived: true });
  } catch (error) {
    return campaignFailFrom(error, 'engage-segment-archive');
  }
}
