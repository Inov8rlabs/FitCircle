import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAdmin, requireAdminUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ onMyDevices: z.boolean().optional(), asOf: z.string().nullable().optional() });

/**
 * POST /api/admin/campaigns/{id}/preview { onMyDevices, asOf? } — toggles the
 * caller in preview_user_ids and sets (date) / clears (null) their
 * preferences.campaignPreview.asOf. → { campaign, asOf, onMyDevices }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    const userId = requireAdminUser(caller);
    const { id } = await params;
    const body = bodySchema.parse(await readJson(request));
    return ok(await CampaignService.setPreview(id, userId, body, request.headers.get('x-client-timezone')));
  } catch (error) {
    return campaignFailFrom(error, 'admin-preview');
  }
}
