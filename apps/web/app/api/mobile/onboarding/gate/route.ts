import { type NextRequest } from 'next/server';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { gateSchema, OnboardingFlowService } from '@/lib/services/onboarding-flow-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/onboarding/gate { reached: true } → data: { gate: 'none'|'subscription_required' }
 *
 * The onboarding paywall was shown (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §5.5).
 * Any user may call it (records profiles.onboarding_paywall_at for the
 * "paywall viewed" metric); the gate is set only for onboarding_v2 users
 * whose arm payload has paywall "hard" (variantA) while the experiment is running/concluded. Idempotent. Clients then
 * re-read GET /api/mobile/entitlements (gate / locked).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    gateSchema.parse(await readJson(request));
    return ok(await OnboardingFlowService.reachPaywall(user.id), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'onboarding/gate');
  }
}
