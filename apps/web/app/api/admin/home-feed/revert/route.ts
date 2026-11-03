import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { HomeFeedAdminService } from '@/lib/services/home-feed-admin-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/home-feed/revert { changeId, baseVersion, summary?, note?, descriptions?, snapshotVersion? }
 * → same as publish: the change's rules_before is published as a new `revert` change (same checks + audit).
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await HomeFeedAdminService.revert(await readJson(request), caller, { requestId: request.headers.get('x-vercel-id') }));
  } catch (error) {
    return feedFailFrom(error, 'admin-revert');
  }
}
