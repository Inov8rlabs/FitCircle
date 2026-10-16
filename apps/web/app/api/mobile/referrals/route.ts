import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DEVICE_HEADER, failFrom, ok } from '@/lib/referrals/http';
import { ReferralService } from '@/lib/services/referral-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/referrals — the "Better Together" hub payload (also feeds the
 * home card and the build-your-circle wizard). docs/REFERRALS_SPEC.md §4.
 * Optional `X-FitCircle-Device` (IDFV / ANDROID_ID) is hashed and remembered
 * for referral fraud checks only.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await ReferralService.recordDevice(user.id, request.headers.get(DEVICE_HEADER));
    return ok(await ReferralService.getHub(user.id), startTime);
  } catch (error) {
    return failFrom(error, 'hub');
  }
}
