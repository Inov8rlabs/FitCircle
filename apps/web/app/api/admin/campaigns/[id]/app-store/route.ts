import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { appStoreStatus } from '@/lib/campaigns/app-store';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/campaigns/{id}/app-store → { connected, eventId, state, issues,
 * schedule, exportPack, … }. Works without ASC env (connected: false) so the
 * portal can show the export pack.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const row = await CampaignService.fetchById(id);
    return ok(await appStoreStatus(row, CampaignService.adminToday(request.headers.get('x-client-timezone'))));
  } catch (error) {
    return campaignFailFrom(error, 'admin-app-store');
  }
}
