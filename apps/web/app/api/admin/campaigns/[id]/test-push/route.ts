import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAdmin, requireAdminUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { CampaignDeliveryService } from '@/lib/services/campaign-delivery-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ key: z.string().min(1).max(40) });

/** POST /api/admin/campaigns/{id}/test-push { key } — sends that push to the caller only (ignores dedupe/caps). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    requireAdminUser(caller);
    const { id } = await params;
    const { key } = bodySchema.parse(await readJson(request));
    return ok(await CampaignDeliveryService.sendTestPush(id, caller.profile!, key));
  } catch (error) {
    return campaignFailFrom(error, 'admin-test-push');
  }
}
