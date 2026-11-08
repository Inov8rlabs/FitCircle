import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, requireAdsAdmin } from '@/lib/ads/http';
import { TrialsAdminService } from '@/lib/trials/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/subscriptions/trials/:userId → TrialDetail (lib/trials/types.ts):
 * profile, location signals, UA source, subscription + event timeline, experiments,
 * engagement, devices, test/QA flags. 400 INVALID_USER_ID, 404 NOT_FOUND / NOT_A_TRIAL.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdsAdmin(request);
    const { userId } = await params;
    return ok(await TrialsAdminService.detail(userId));
  } catch (error) {
    return adsFailFrom(error, 'trials/detail');
  }
}
