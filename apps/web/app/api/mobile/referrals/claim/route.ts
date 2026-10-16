import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { failFrom, ok } from '@/lib/referrals/http';
import { ATTRIBUTION_SOURCES, type AttributionSource } from '@/lib/referrals/types';
import { ReferralService } from '@/lib/services/referral-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const claimLimiter = createRateLimiter({ interval: 60 * 60_000, uniqueTokenPerInterval: 5000, maxRequests: 20 });

const claimSchema = z.object({
  code: z.string().min(1).max(32),
  ref: z.string().max(32).optional(),
  source: z.enum(ATTRIBUTION_SOURCES as unknown as [AttributionSource, ...AttributionSource[]]),
  deviceId: z.string().max(128).optional(),
});

/**
 * POST /api/mobile/referrals/claim — attribute this (new) account to an invite.
 * Body {code, ref?, source, deviceId?}. Errors: INVALID_CODE 404, SELF_REFERRAL
 * 400, ALREADY_ATTRIBUTED 409, WINDOW_CLOSED / DEVICE_INELIGIBLE 422,
 * PROGRAM_DISABLED 403. Does not join circles (POST /circles/join does that).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const limited = await applyRateLimit(request, claimLimiter, getIdentifier(request, user.id));
    if (limited) return limited;
    const body = parseLenient(claimSchema, await request.json());
    const result = await ReferralService.claim(user.id, {
      code: body.code,
      ref: body.ref ?? null,
      source: body.source,
      deviceId: body.deviceId ?? null,
    });
    return ok(result, startTime);
  } catch (error) {
    return failFrom(error, 'claim');
  }
}
