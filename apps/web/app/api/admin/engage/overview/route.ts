import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { EngageStatsService } from '@/lib/services/engage-stats-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/engage/overview → live/upcoming messages, last-7-day totals, top messages. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await EngageStatsService.overview());
  } catch (error) {
    return campaignFailFrom(error, 'engage-overview');
  }
}
