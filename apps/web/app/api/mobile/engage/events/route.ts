import { type NextRequest } from 'next/server';

import { requireUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { resolvePlatform } from '@/lib/engage/platform';
import { EngageDeliveryService } from '@/lib/services/engage-delivery-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/engage/events { events: EngageEventInput[] (≤ 50) } → { accepted, dropped }.
 * Impressions dedupe per message per user per 30 min; card dismissals are permanent.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const profile = await requireUser(request);
    const out = await EngageDeliveryService.ingestEvents(profile.id, resolvePlatform(request), await readJson(request));
    return ok(out, startTime);
  } catch (error) {
    return campaignFailFrom(error, 'engage-events');
  }
}
