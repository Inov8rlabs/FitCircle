import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { ProLifecycleAdminService } from '@/lib/services/pro-lifecycle-admin-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/home-feed/pro-lifecycle → { config, enabled, version (publish's baseVersion), source, defaults,
 * killSwitch, limits, placeholders, states, lastChange, propagation } (docs/PRO_LIFECYCLE_PROMPTS.md §6).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await ProLifecycleAdminService.state());
  } catch (error) {
    return feedFailFrom(error, 'admin-pro-lifecycle');
  }
}
