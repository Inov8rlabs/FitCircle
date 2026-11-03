import { type NextRequest, NextResponse } from 'next/server';

import { resolveMaxAgeHours } from '@/lib/onboarding-nudges/policy';
import { OnboardingNudgeService } from '@/lib/services/onboarding-nudge-service';

/**
 * GET /api/cron/onboarding-nudges — "finish setting up" push + email for
 * sign-ups who left onboarding midway (OnboardingNudgeService). Every 15 min.
 * CRON_SECRET-gated, FAIL CLOSED. Kill switch: ONBOARDING_NUDGES_ENABLED=false.
 *
 * Ops params:
 *   ?dryRun=1          read only: returns who WOULD be messaged (user id prefixes) and why others aren't
 *                      (also forced by ONBOARDING_NUDGES_DRY_RUN=true)
 *   ?maxAgeHours=120   widen the "created within" cutoff (default 72, max 336) for a deliberate one-off run
 *   ?flow=v3           only users on that onboarding flow
 *   ?userId=<uuid>     only that user
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const truthy = (v: string | null) => !!v && ['1', 'true', 'yes'].includes(v.toLowerCase());

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const userId = params.get('userId') ?? undefined;
  if (userId && !UUID.test(userId)) {
    return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });
  }
  const flow = params.get('flow') ?? undefined;
  if (flow && !/^v\d{1,2}$/.test(flow)) {
    return NextResponse.json({ error: 'flow must look like v3' }, { status: 400 });
  }
  try {
    const result = await OnboardingNudgeService.run({
      userId,
      flow,
      maxAgeHours: resolveMaxAgeHours(params.get('maxAgeHours')),
      dryRun: truthy(params.get('dryRun')),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron onboarding-nudges] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'onboarding nudges failed' }, { status: 500 });
  }
}
