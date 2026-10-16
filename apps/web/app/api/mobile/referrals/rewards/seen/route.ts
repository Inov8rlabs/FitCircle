import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { failFrom, ok } from '@/lib/referrals/http';
import { ReferralService } from '@/lib/services/referral-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const seenSchema = z.object({ ids: z.array(z.string().uuid()).max(100) });

/** POST /api/mobile/referrals/rewards/seen {ids} — the celebration for these rewards played. */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { ids } = parseLenient(seenSchema, await request.json());
    return ok({ updated: await ReferralService.markRewardsSeen(user.id, ids) }, startTime);
  } catch (error) {
    return failFrom(error, 'rewards/seen');
  }
}
