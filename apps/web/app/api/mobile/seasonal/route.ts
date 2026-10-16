import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { failFrom, ok } from '@/lib/referrals/http';
import { seasonsFor } from '@/lib/seasonal/seasons';
import { localToday } from '@/lib/streaks/streak-calculator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/seasonal — the promoted seasonal circle (REFERRALS_SPEC §10.4).
 * "Today" is the caller's local day (x-client-timezone).
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    await requireMobileAuth(request);
    const today = localToday(request.headers.get('x-client-timezone'));
    return ok(seasonsFor(today), startTime);
  } catch (error) {
    return failFrom(error, 'seasonal');
  }
}
