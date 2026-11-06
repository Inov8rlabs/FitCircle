import { type NextRequest } from 'next/server';

import { ok, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/remote-config/changes?key= → {changes: [{id, key, target, ruleId, action, actor, before, after, at}]} (newest first, ≤ 200). */
export async function GET(request: NextRequest) {
  try {
    await requireRemoteConfigAdmin(request);
    const key = request.nextUrl.searchParams.get('key');
    return ok(await RemoteConfigService.listChanges(key && key.trim() ? key.trim() : null));
  } catch (error) {
    return remoteConfigFailFrom(error, 'changes');
  }
}
