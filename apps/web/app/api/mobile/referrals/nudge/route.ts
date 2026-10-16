import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { failFrom, ok } from '@/lib/referrals/http';
import { nudgeSchema } from '@/lib/referrals/schemas';
import { ReferralService } from '@/lib/services/referral-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/referrals/nudge {inviteId} | {referralId} — remind a friend.
 * Joined friend → push; email invite → reminder email; text invite → returns
 * smsBody for the composer. Rate limits come back as status too_soon/limit_reached.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const body = parseLenient(nudgeSchema, await request.json());
    return ok(await ReferralService.nudge(user.id, body), startTime);
  } catch (error) {
    return failFrom(error, 'nudge');
  }
}
