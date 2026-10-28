import { type NextRequest } from 'next/server';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { OnboardingFlowService, planWithBirthDateSchema } from '@/lib/services/onboarding-flow-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/onboarding/plan { goal, heightCm?, weightKg?, targetWeightKg?, sex?, age?, unitsSystem?, activityLevel?, birthYear?, dateOfBirth? }
 * → data: { calories, proteinG, waterMl, steps, basis: 'personal'|'default', assumptions: [...] }
 *
 * v2 "Your plan" targets (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §5.3 step 4;
 * formulas in lib/onboarding/plan.ts). Missing body fields fall back to the
 * saved profile (height, weight, date of birth). The client saves the
 * accepted targets with PUT /api/mobile/targets (docs/USER_TARGETS_CONTRACT.md).
 * birthYear / dateOfBirth (1.1.0+) stand in for `age` and are saved to
 * profiles.date_of_birth (a year never overwrites a full date).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const input = planWithBirthDateSchema.parse(await readJson(request));
    await OnboardingFlowService.saveBirthDate(user.id, input);
    return ok(OnboardingFlowService.plan(user, input), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'onboarding/plan');
  }
}
