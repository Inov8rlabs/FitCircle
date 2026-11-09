import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/admin/remote-config/{key}/estimate {audience} → {count, total, approximate, ignored[]}. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    await requireRemoteConfigAdmin(request);
    const { key } = await params;
    return ok(await RemoteConfigService.estimate(key, await readJson(request)));
  } catch (error) {
    return remoteConfigFailFrom(error, 'estimate');
  }
}
