import { type NextRequest } from 'next/server';

import { requireUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { resolvePlatform } from '@/lib/engage/platform';
import { EngageDeliveryService } from '@/lib/services/engage-delivery-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/engage → EngageResponse (docs/ENGAGE_SPEC.md §8).
 * Headers: x-platform (ios|android|web; cookie sessions default to web),
 * x-app-version, x-client-timezone.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const profile = await requireUser(request);
    const data = await EngageDeliveryService.getEngage(profile, {
      platform: resolvePlatform(request),
      appVersion: request.headers.get('x-app-version'),
      timezone: request.headers.get('x-client-timezone'),
    });
    return ok(data, startTime);
  } catch (error) {
    return campaignFailFrom(error, 'engage');
  }
}
