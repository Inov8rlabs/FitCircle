import { type NextRequest } from 'next/server';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { OnboardingFlowService, progressSchema } from '@/lib/services/onboarding-flow-service';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/mobile/onboarding/progress { flow: 'v1'|'v2'|'v3', step, data?, birthYear?, dateOfBirth? }
 * → data: { flow, step, data, updatedAt }
 *
 * Server-persisted resume point (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md R2).
 * Called (debounced) on every step change. `data` replaces the saved answers
 * when present and is kept when omitted. Also records profiles.onboarding_flow,
 * and (1.1.0+) saves birthYear / dateOfBirth to profiles.date_of_birth
 * (docs/USER_TARGETS_CONTRACT.md §3; never echoed back).
 */
export async function PATCH(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const input = progressSchema.parse(await readJson(request));
    return ok(await OnboardingFlowService.saveProgress(user.id, input), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'onboarding/progress');
  }
}
