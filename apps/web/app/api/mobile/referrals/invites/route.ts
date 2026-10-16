import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { failFrom, ok } from '@/lib/referrals/http';
import { inviteContactsSchema } from '@/lib/referrals/schemas';
import { ReferralService } from '@/lib/services/referral-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ interval: 60 * 60_000, uniqueTokenPerInterval: 5000, maxRequests: 30 });

/**
 * POST /api/mobile/referrals/invites {contacts[≤10], circleId?} — invite friends.
 * Emails are sent by us (Resend); phones mean "I texted them from my phone"
 * (recorded only). Per-contact results; daily caps in ReferralInviteService.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const limited = await applyRateLimit(request, limiter, getIdentifier(request, user.id));
    if (limited) return limited;
    const body = parseLenient(inviteContactsSchema, await request.json());
    return ok(await ReferralService.inviteContacts(user.id, { contacts: body.contacts, circleId: body.circleId ?? null }), startTime);
  } catch (error) {
    return failFrom(error, 'invites');
  }
}
