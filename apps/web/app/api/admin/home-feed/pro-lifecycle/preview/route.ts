import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { ProLifecycleAdminService } from '@/lib/services/pro-lifecycle-admin-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/home-feed/pro-lifecycle/preview { config?, enabled?, platform, version, timezone?, sample? }
 * → per state: the persona's full feed with the card as that client receives it + the push (before = published,
 * after = draft). Read-only.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await ProLifecycleAdminService.preview(await readJson(request)));
  } catch (error) {
    return feedFailFrom(error, 'admin-pro-lifecycle-preview');
  }
}
