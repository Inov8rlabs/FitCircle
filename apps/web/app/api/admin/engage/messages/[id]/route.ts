import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { EngageMessageService } from '@/lib/services/engage-message-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/engage/messages/{id} → EngageMessage + launch checklist */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    const row = await EngageMessageService.fetchRow((await params).id);
    const [message, check] = await Promise.all([EngageMessageService.get(row.id), EngageMessageService.check(row)]);
    return ok({ ...message, checklist: check });
  } catch (error) {
    return campaignFailFrom(error, 'engage-message');
  }
}

/** PATCH /api/admin/engage/messages/{id} { version, ...Partial<MessageInput> } (409 VERSION_CONFLICT) */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const caller = await requireAdmin(request);
    return ok(await EngageMessageService.patch((await params).id, await readJson(request), caller.userId));
  } catch (error) {
    return campaignFailFrom(error, 'engage-message-patch');
  }
}

/** DELETE /api/admin/engage/messages/{id} = archive */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const caller = await requireAdmin(request);
    return ok(await EngageMessageService.archive((await params).id, caller.userId));
  } catch (error) {
    return campaignFailFrom(error, 'engage-message-archive');
  }
}
