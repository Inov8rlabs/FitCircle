import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { todayFor } from '@/lib/fitzy/dates';
import { fitzyFail, ok, readJson } from '@/lib/fitzy/http';
import { paywallFor } from '@/lib/fitzy/paywall';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyPlanService } from '@/lib/services/fitzy-plan-service';
import { FitzyService } from '@/lib/services/fitzy-service';
import { UsageService } from '@/lib/services/usage-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ goal: z.string().trim().max(200).nullish() });

/**
 * GET /api/mobile/fitzy/plan → { plan, locked, preview?, paywall? }
 * Pro: this week's plan (or null). Free: the cached teaser (goal + first commitment + "N more").
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const tz = request.headers.get('x-client-timezone');
    const today = todayFor(tz);
    const tier = await UsageService.fitzyTier(user.id);
    if (tier === 'pro') return ok({ plan: await FitzyPlanService.current(user.id, today), locked: false });
    const grounding = await FitzyService.grounding(user.id, tier, { timezone: tz });
    const preview = await FitzyPlanService.preview(user.id, today, null, grounding, FitzyService.guard);
    return ok({ plan: null, locked: true, preview, paywall: paywallFor('weekly_plan') });
  } catch (error) {
    return fitzyFail(error);
  }
}

/** POST /api/mobile/fitzy/plan { goal? } → Pro: { plan } (Sonnet, 3–5 commitments); Free: { locked: true, preview, paywall }. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const { goal } = bodySchema.parse(await readJson(request));
    const tz = request.headers.get('x-client-timezone');
    const today = todayFor(tz);
    const tier = await UsageService.fitzyTier(user.id);
    const grounding = await FitzyService.grounding(user.id, tier, { timezone: tz });
    if (tier === 'pro') return ok({ plan: await FitzyPlanService.create(user.id, today, goal ?? null, grounding, FitzyService.guard), locked: false });
    const preview = await FitzyPlanService.preview(user.id, today, goal ?? null, grounding, FitzyService.guard);
    return ok({ plan: null, locked: true, preview, paywall: paywallFor('weekly_plan') });
  } catch (error) {
    return fitzyFail(error);
  }
}
