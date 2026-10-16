import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { fail, failFrom, ok } from '@/lib/referrals/http';
import { CircleLobbyService } from '@/lib/services/circle-lobby-service';
import { CircleService } from '@/lib/services/circle-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/circles/{id}/start — the creator kicks off a lobby circle
 * now instead of waiting for the crew (REFERRALS_SPEC §10.2). Returns the
 * updated circle.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const outcome = await CircleLobbyService.startNow(id, user.id);
    if (outcome === 'forbidden') return fail(403, 'FORBIDDEN', 'Only the circle creator can start it');
    if (outcome === 'not_lobby') return fail(404, 'NOT_FOUND', 'This circle is not waiting to start');
    return ok({ status: outcome, circle: await CircleService.getCircle(id) }, startTime);
  } catch (error) {
    return failFrom(error, 'circle start');
  }
}
