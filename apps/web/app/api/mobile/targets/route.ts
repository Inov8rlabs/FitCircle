import { type NextRequest } from 'next/server';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { UserTargetsService } from '@/lib/services/user-targets-service';
import { targetsPatchSchema } from '@/lib/targets/user-targets';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/targets
 * → data: { calories, proteinG, carbsG, fatG, waterMl, steps, sources, origin, updatedAt }
 *
 * The user's daily targets (docs/USER_TARGETS_CONTRACT.md), each the user's own
 * value or today's server default (`sources` says which). Plate score, the
 * vitals water card and hydration responses use the same values.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    return ok(await UserTargetsService.get(user.id, user), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'targets GET');
  }
}

/**
 * PUT|PATCH /api/mobile/targets { calories?, proteinG?, carbsG?, fatG?, waterMl?, steps?, origin? }
 * → data: same as GET.
 *
 * Partial update: omitted keys are kept, `null` clears a target (back to the
 * default). Integers within TARGET_LIMITS (lib/targets/user-targets.ts); 400
 * VALIDATION_ERROR { issues } otherwise. Onboarding v3 calls this with the
 * accepted plan and `origin: "onboarding_plan"`.
 */
async function update(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const patch = targetsPatchSchema.parse(await readJson(request));
    return ok(await UserTargetsService.update(user.id, patch), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'targets PUT');
  }
}

export const PUT = update;
export const PATCH = update;
