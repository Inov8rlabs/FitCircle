import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { HomeFeedService } from '@/lib/services/home-feed-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/home-feed/preview?userId=…[&cards=…&platform=ios&version=1.0.8&build=63&timezone=…&includeDisabled=true]
 * → { feed, killSwitch, context, trace, rulesEvaluated }. Read-only: no decision is recorded.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await HomeFeedService.preview(request.nextUrl.searchParams));
  } catch (error) {
    return feedFailFrom(error, 'admin-preview');
  }
}
