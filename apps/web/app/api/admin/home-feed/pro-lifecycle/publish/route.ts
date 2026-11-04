import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { ProLifecycleAdminService } from '@/lib/services/pro-lifecycle-admin-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/home-feed/pro-lifecycle/publish { baseVersion, config, enabled, summary, note? }
 * → { config, enabled, version, change, propagation }. 409 STALE_DRAFT when the published settings changed since
 * `baseVersion`; audited with X-Admin-Actor (experiment_audit_log, key config:pro_lifecycle_prompts).
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await ProLifecycleAdminService.publish(await readJson(request), caller));
  } catch (error) {
    return feedFailFrom(error, 'admin-pro-lifecycle-publish');
  }
}
