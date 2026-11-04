import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { ProLifecycleAdminService } from '@/lib/services/pro-lifecycle-admin-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/home-feed/pro-lifecycle/changes?limit= → { changes } newest first. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await ProLifecycleAdminService.changes(Number(request.nextUrl.searchParams.get('limit')) || 50));
  } catch (error) {
    return feedFailFrom(error, 'admin-pro-lifecycle-changes');
  }
}
