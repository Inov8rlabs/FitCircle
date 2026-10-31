import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { requireAdminUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { EngageMessageService } from '@/lib/services/engage-message-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/engage/messages/{id}/test { variantId?, platform? } — push/email
 * go to the caller now; cards/in-app add the caller to the preview list.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    requireAdminUser(caller);
    return ok(await EngageMessageService.test((await params).id, caller.profile!, await readJson(request)));
  } catch (error) {
    return campaignFailFrom(error, 'engage-message-test');
  }
}
