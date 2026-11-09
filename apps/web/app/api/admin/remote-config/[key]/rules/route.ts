import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/remote-config/{key}/rules {name, enabled, priority, audience, value} → 201 rule. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const actor = await requireRemoteConfigAdmin(request, { mutating: true });
    const { key } = await params;
    return ok(await RemoteConfigService.createRule(key, await readJson(request), { email: actor.email }), undefined, 201);
  } catch (error) {
    return remoteConfigFailFrom(error, 'create-rule');
  }
}
