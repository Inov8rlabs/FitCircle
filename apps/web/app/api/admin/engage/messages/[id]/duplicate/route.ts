import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { EngageMessageService } from '@/lib/services/engage-message-service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/engage/messages/{id}/duplicate */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    return ok(await EngageMessageService.duplicate((await params).id, caller.userId), undefined, 201);
  } catch (error) {
    return campaignFailFrom(error, 'engage-message-duplicate');
  }
}
