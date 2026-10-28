import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { ExperimentService } from '@/lib/experiments/service';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/),
    arm: z.string().regex(/^[a-z0-9][a-z0-9_]{0,39}$/),
    surface: z.string().trim().min(1).max(64),
  })
  .strip();

/**
 * POST /api/mobile/experiments/exposure { key, arm, surface } → data: { ok: true }
 *
 * The first onboarding screen of the arm rendered. Sets first_exposed_at once,
 * and only when `arm` is the user's persisted arm; always answers ok so a
 * client never retries (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.4).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { key, arm, surface } = bodySchema.parse(await readJson(request));
    await ExperimentService.recordExposure(user.id, key, arm, surface);
    return ok({ ok: true }, startTime);
  } catch (error) {
    return mobileFailFrom(error, 'experiments/exposure');
  }
}
