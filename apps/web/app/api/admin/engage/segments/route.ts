import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { EngageSegmentService } from '@/lib/services/engage-segment-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/engage/segments → { segments } */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok({ segments: await EngageSegmentService.list() });
  } catch (error) {
    return campaignFailFrom(error, 'engage-segments');
  }
}

/** POST /api/admin/engage/segments { name, description?, filters } */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await EngageSegmentService.create(await readJson(request), caller.userId), undefined, 201);
  } catch (error) {
    return campaignFailFrom(error, 'engage-segment-create');
  }
}
