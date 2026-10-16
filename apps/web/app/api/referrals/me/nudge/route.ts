import { type NextRequest } from 'next/server';

import { failFrom, ok } from '@/lib/referrals/http';
import { nudgeSchema } from '@/lib/referrals/schemas';
import { requireWebUser } from '@/lib/referrals/web-auth';
import { ReferralService } from '@/lib/services/referral-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

/**
 * POST /api/referrals/me/nudge { inviteId } | { referralId } — rate-limited nudge
 * (push to a joined friend, reminder email, or an smsBody for a texted invite).
 * Same schema and shape as POST /api/mobile/referrals/nudge. Cookie auth.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireWebUser();
    const body = parseLenient(nudgeSchema, await request.json().catch(() => ({})));
    return ok(await ReferralService.nudge(user.id, body), startTime);
  } catch (error) {
    return failFrom(error, 'web nudge');
  }
}
