import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { appStoreStatus, requireAscConfig, submitAppEvent } from '@/lib/campaigns/app-store';
import { CampaignError, campaignFailFrom, ok } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/admin/campaigns/{id}/app-store/submit → status (submits the synced event for review). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    requireAscConfig();
    const { id } = await params;
    const today = CampaignService.adminToday(request.headers.get('x-client-timezone'));
    const row = await CampaignService.fetchById(id);
    try {
      const appStore = await submitAppEvent(row);
      const updated = await CampaignService.patchColumns(id, { app_store: appStore as any }, caller.userId);
      return ok(await appStoreStatus(updated, today));
    } catch (err) {
      if (err instanceof CampaignError && err.code === 'APP_STORE_ERROR') {
        await CampaignService.patchColumns(id, { app_store: { ...(row.app_store ?? {}), lastError: err.message } as any }, caller.userId);
      }
      throw err;
    }
  } catch (error) {
    return campaignFailFrom(error, 'admin-app-store-submit');
  }
}
