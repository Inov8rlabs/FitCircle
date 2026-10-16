import { type NextRequest } from 'next/server';

import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { failFrom, ok } from '@/lib/referrals/http';
import { ReferralService } from '@/lib/services/referral-service';

export const dynamic = 'force-dynamic';

const previewLimiter = createRateLimiter({ interval: 60_000, uniqueTokenPerInterval: 5000, maxRequests: 60 });

/**
 * GET /api/referrals/preview?code=XXX[&ref=YYY] — public (no auth).
 * Who invited you + which circle, for landing pages and the app's
 * "Got an invite?" step. Unknown codes answer 200 {valid:false}.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const limited = await applyRateLimit(request, previewLimiter, getIdentifier(request));
    if (limited) return limited;
    const params = request.nextUrl.searchParams;
    const code = (params.get('code') ?? '').slice(0, 32);
    const ref = params.get('ref')?.slice(0, 32) ?? null;
    if (!code) return ok({ valid: false }, startTime);
    return ok(await ReferralService.preview(code, ref), startTime);
  } catch (error) {
    return failFrom(error, 'preview');
  }
}
