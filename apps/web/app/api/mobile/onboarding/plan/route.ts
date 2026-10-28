import { type NextRequest } from 'next/server';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { planRequestSchema } from '@/lib/onboarding/plan';
import { OnboardingFlowService } from '@/lib/services/onboarding-flow-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/onboarding/plan { goal, heightCm?, weightKg?, targetWeightKg?, sex?, age?, unitsSystem?, activityLevel? }
 * → data: { calories, proteinG, waterMl, steps, basis: 'personal'|'default', assumptions: [...] }
 *
 * v2 "Your plan" targets (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §5.3 step 4;
 * formulas in lib/onboarding/plan.ts). Missing body fields fall back to the
 * saved profile (height, weight, date of birth). Pure compute — the client
 * saves the accepted targets as daily goals.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const input = planRequestSchema.parse(await readJson(request));
    return ok(OnboardingFlowService.plan(user, input), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'onboarding/plan');
  }
}
