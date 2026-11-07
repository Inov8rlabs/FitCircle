import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { parseClientPlatform } from '@/lib/experiments/request-info';
import { checkIntegrity, isIntegrityClient } from '@/lib/integrity/enforcement';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { acceptInvite } from '@/lib/referrals/accept-invite';
import { failFrom, ok } from '@/lib/referrals/http';
import { ATTRIBUTION_SOURCES, type AttributionSource } from '@/lib/referrals/types';
import { parseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const claimLimiter = createRateLimiter({ name: 'referral-claim', interval: 60 * 60_000, uniqueTokenPerInterval: 5000, maxRequests: 20 });

const claimSchema = z.object({
  code: z.string().min(1).max(32),
  ref: z.string().max(32).optional(),
  source: z.enum(ATTRIBUTION_SOURCES as unknown as [AttributionSource, ...AttributionSource[]]),
  deviceId: z.string().max(128).optional(),
});

/**
 * POST /api/mobile/referrals/claim — accept an invite for this account.
 * Body {code, ref?, source, deviceId?}.
 *
 * 1. Attribution (new accounts only). Errors: INVALID_CODE 404, SELF_REFERRAL
 *    400, ALREADY_ATTRIBUTED 409, WINDOW_CLOSED / DEVICE_INELIGIBLE 422,
 *    PROGRAM_DISABLED 403 (unchanged envelope).
 * 2. For a CIRCLE code, the person is also joined to the circle — whatever
 *    happened to the attribution (an existing account or a reused device still
 *    gets their seat). Idempotent (CircleService.joinViaInvite).
 *
 * `circleJoin` ({status: joined|rejoined|already_member, circle:{id,name,inviteCode}}
 * or {status:'failed', reason, message}) is in `data.circleJoin` on success and
 * in `error.details.circleJoin` on a refused attribution. Shipped clients ignore
 * it and still call POST /circles/join afterwards, which now answers 200 for an
 * existing member, so their flow completes as a success.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const limited = await applyRateLimit(request, claimLimiter, getIdentifier(request, user.id));
    if (limited) return limited;
    const integrity = await checkIntegrity(request, { action: 'referral_claim', userId: user.id });
    if (!integrity.allowed) return integrity.response!;
    const body = parseLenient(claimSchema, await request.json());
    const { referral, circleJoin } = await acceptInvite(user.id, {
      code: body.code,
      ref: body.ref ?? null,
      source: body.source,
      deviceId: body.deviceId ?? null,
      attestedDeviceId: integrity.attestedDeviceId,
      integrityClient: isIntegrityClient(request),
      platform: parseClientPlatform(request.headers.get('x-app-platform') ?? request.headers.get('x-platform')),
    });
    if (referral.claimed) return ok({ ...referral.result, circleJoin }, startTime);

    const error = referral.error;
    const response = failFrom(error ?? new Error('claim failed'), 'claim');
    if (!circleJoin) return response;
    // Same envelope, plus what happened to the circle.
    const payload = await response.json();
    payload.error = { ...payload.error, details: { ...(payload.error?.details ?? {}), circleJoin } };
    return NextResponse.json(payload, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failFrom(error, 'claim');
  }
}
