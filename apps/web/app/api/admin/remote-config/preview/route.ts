import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/remote-config/preview {userId, platform?, appVersion?, country?}
 * → {userId, values: {key: {value, source: 'rule'|'default'|'code', ruleId?, ruleName?}}, context}
 */
export async function POST(request: NextRequest) {
  try {
    await requireRemoteConfigAdmin(request);
    return ok(await RemoteConfigService.preview(await readJson(request)));
  } catch (error) {
    return remoteConfigFailFrom(error, 'preview');
  }
}
