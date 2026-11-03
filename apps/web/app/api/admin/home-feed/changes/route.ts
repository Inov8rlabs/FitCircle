import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { HomeFeedAdminService } from '@/lib/services/home-feed-admin-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/home-feed/changes?limit=50&before=<seq> → { changes: ChangeEntry[], nextBefore } (newest first, incl. rolled-back attempts). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await HomeFeedAdminService.listChanges(request.nextUrl.searchParams));
  } catch (error) {
    return feedFailFrom(error, 'admin-changes');
  }
}
