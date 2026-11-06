import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';

/** PATCH /api/admin/remote-config/rules/{id} {name?, enabled?, priority?, audience?, value?} → rule. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRemoteConfigAdmin(request, { mutating: true });
    const { id } = await params;
    return ok(await RemoteConfigService.updateRule(id, await readJson(request), { email: actor.email }));
  } catch (error) {
    return remoteConfigFailFrom(error, 'update-rule');
  }
}

/** DELETE /api/admin/remote-config/rules/{id} → {deleted: true, id}. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRemoteConfigAdmin(request, { mutating: true });
    const { id } = await params;
    return ok(await RemoteConfigService.deleteRule(id, { email: actor.email }));
  } catch (error) {
    return remoteConfigFailFrom(error, 'delete-rule');
  }
}
