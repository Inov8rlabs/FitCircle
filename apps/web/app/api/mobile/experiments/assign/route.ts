import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { readExperimentRequestInfo } from '@/lib/experiments/request-info';
import { ExperimentService } from '@/lib/experiments/service';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({ keys: z.array(z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/)).min(1).max(10) })
  .strip();

/**
 * POST /api/mobile/experiments/assign { keys: ['onboarding_v2'] }
 * → data: { assignments: { onboarding_v2: { arm, payload, enrolled } } }
 *
 * Called right after sign-up (before the first onboarding screen) and on
 * resume. Idempotent and sticky. Unknown keys are absent from `assignments`
 * (clients then use their default arm with enrolled=false). Reads
 * X-App-Platform / X-App-Version for the audience (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.3–§6.4).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { keys } = bodySchema.parse(await readJson(request));
    const assignments = await ExperimentService.assign(user, keys, readExperimentRequestInfo(request));
    return ok({ assignments }, startTime);
  } catch (error) {
    return mobileFailFrom(error, 'experiments/assign');
  }
}
