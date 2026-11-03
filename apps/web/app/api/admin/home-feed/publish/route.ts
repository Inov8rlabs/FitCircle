import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { HomeFeedAdminService } from '@/lib/services/home-feed-admin-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/home-feed/publish { baseVersion, changes: RuleChange[], summary, note?, descriptions?, snapshotVersion? }
 * → { change, version, rules, propagation }. All changes apply together or not at all; 409 STALE_DRAFT when the
 * published rules changed since `baseVersion`; every attempt is recorded in home_feed_rule_changes with X-Admin-Actor.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await HomeFeedAdminService.publish(await readJson(request), caller, { requestId: request.headers.get('x-vercel-id') }));
  } catch (error) {
    return feedFailFrom(error, 'admin-publish');
  }
}
