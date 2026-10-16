import { type NextRequest } from 'next/server';

import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { fail, failFrom, ok } from '@/lib/referrals/http';
import { ReferralInviteService, verifyUnsubscribeToken } from '@/lib/services/referral-invite-service';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ interval: 60_000, uniqueTokenPerInterval: 5000, maxRequests: 30 });

/**
 * GET /api/referrals/unsubscribe?t= — public, side-effect free: only says whether
 * the link is valid. Mail security scanners prefetch links, so a GET must never
 * unsubscribe anyone.
 */
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, limiter, getIdentifier(request));
  if (limited) return limited;
  const valid = !!verifyUnsubscribeToken(request.nextUrl.searchParams.get('t') ?? '');
  return valid ? ok({ valid: true }) : fail(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid');
}

/**
 * POST /api/referrals/unsubscribe?t= — performs the opt-out. Used by the
 * /invite/unsubscribe confirm button and by mail clients' RFC 8058 one-click
 * (List-Unsubscribe-Post), which always POSTs.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await applyRateLimit(request, limiter, getIdentifier(request));
    if (limited) return limited;
    const token = request.nextUrl.searchParams.get('t') ?? '';
    const done = await ReferralInviteService.unsubscribe(token);
    return done ? ok({ unsubscribed: true }) : fail(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid');
  } catch (error) {
    return failFrom(error, 'unsubscribe');
  }
}
