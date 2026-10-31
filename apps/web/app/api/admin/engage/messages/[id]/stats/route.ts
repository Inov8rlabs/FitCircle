import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { isPlatform } from '@/lib/engage/platform';
import { EngageStatsService } from '@/lib/services/engage-stats-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/engage/messages/{id}/stats?from&to&platform → MessageStats (+ byPlatform, funnel). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const sp = request.nextUrl.searchParams;
    const platform = sp.get('platform');
    return ok(
      await EngageStatsService.stats((await params).id, { from: sp.get('from'), to: sp.get('to'), platform: isPlatform(platform) ? platform : null })
    );
  } catch (error) {
    return campaignFailFrom(error, 'engage-message-stats');
  }
}
