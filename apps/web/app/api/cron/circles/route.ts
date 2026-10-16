import { type NextRequest, NextResponse } from 'next/server';

import { CircleLobbyService } from '@/lib/services/circle-lobby-service';
import { CircleStreakService } from '@/lib/services/circle-streak-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/circles (hourly) — REFERRALS_SPEC §10.
 *  1. Settle each live circle streak's local "yesterday" (a missed day ends it).
 *  2. Lobby circles whose 72h timer ran out kick off anyway.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result: Record<string, unknown> = {};
  try {
    result.streaks = await CircleStreakService.settleYesterday();
  } catch (err: any) {
    result.streaks = { error: err?.message };
  }
  try {
    result.lobbiesStarted = await CircleLobbyService.autoStartDue();
  } catch (err: any) {
    result.lobbiesStarted = { error: err?.message };
  }
  return NextResponse.json(result);
}
