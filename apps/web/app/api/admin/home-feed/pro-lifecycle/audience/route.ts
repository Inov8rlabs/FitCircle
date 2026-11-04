import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { ProLifecycleAdminService } from '@/lib/services/pro-lifecycle-admin-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/home-feed/pro-lifecycle/audience → who is in each state right now (read-only). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await ProLifecycleAdminService.audience());
  } catch (error) {
    return feedFailFrom(error, 'admin-pro-lifecycle-audience');
  }
}
