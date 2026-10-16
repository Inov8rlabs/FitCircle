import { type NextRequest } from 'next/server';

import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { failFrom, ok } from '@/lib/referrals/http';
import { inviteContactsSchema } from '@/lib/referrals/schemas';
import { requireWebUser } from '@/lib/referrals/web-auth';
import { ReferralService } from '@/lib/services/referral-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ interval: 60 * 60_000, uniqueTokenPerInterval: 5000, maxRequests: 30 });

/**
 * POST /api/referrals/me/invites { contacts[≤10], circleId? } — web "Invite by email".
 * Emails are sent by the server; phone contacts are record-only ("I texted them").
 * Same schema and shape as POST /api/mobile/referrals/invites (§9.2). Cookie auth.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireWebUser();
    const limited = await applyRateLimit(request, limiter, getIdentifier(request, user.id));
    if (limited) return limited;
    const body = parseLenient(inviteContactsSchema, await request.json().catch(() => ({})));
    return ok(
      await ReferralService.inviteContacts(user.id, { contacts: body.contacts, circleId: body.circleId ?? null }),
      startTime
    );
  } catch (error) {
    return failFrom(error, 'web invites');
  }
}
