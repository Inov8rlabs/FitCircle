import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';

/** PUT /api/admin/remote-config/{key}/default {value} — `null` resets to the code default. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const actor = await requireRemoteConfigAdmin(request, { mutating: true });
    const { key } = await params;
    return ok(await RemoteConfigService.setDefault(key, await readJson(request), { email: actor.email }));
  } catch (error) {
    return remoteConfigFailFrom(error, 'default');
  }
}
