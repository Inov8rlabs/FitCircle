import { type NextRequest } from 'next/server';

import { requireUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { resolvePlatform } from '@/lib/engage/platform';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/** GET /api/mobile/campaigns/{slug} → CampaignView (404 NOT_FOUND when not visible). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const startTime = Date.now();
  try {
    const profile = await requireUser(request);
    const { slug } = await params;
    return ok(await CampaignService.getForViewer(profile, request.headers.get('x-client-timezone'), slug, resolvePlatform(request)), startTime);
  } catch (error) {
    return campaignFailFrom(error, 'get');
  }
}
