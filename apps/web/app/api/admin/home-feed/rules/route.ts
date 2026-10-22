import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { HomeFeedService } from '@/lib/services/home-feed-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/home-feed/rules → { rules: AdminRule[] } (all rows, with validation status). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok({ rules: await HomeFeedService.listRules() });
  } catch (error) {
    return feedFailFrom(error, 'admin-rules-list');
  }
}

/** POST /api/admin/home-feed/rules  { key, enabled?, priority?, ...definition } → AdminRule (201). */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await HomeFeedService.createRule(await readJson(request), caller.userId), undefined, 201);
  } catch (error) {
    return feedFailFrom(error, 'admin-rules-create');
  }
}

/** PATCH /api/admin/home-feed/rules  { id | key, enabled?, priority?, definition? } → AdminRule. */
export async function PATCH(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await HomeFeedService.patchRule(await readJson(request), caller.userId));
  } catch (error) {
    return feedFailFrom(error, 'admin-rules-patch');
  }
}
