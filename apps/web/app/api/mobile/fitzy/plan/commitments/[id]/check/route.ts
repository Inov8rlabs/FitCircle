import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { todayFor } from '@/lib/fitzy/dates';
import { fitzyFail, ok, readJson } from '@/lib/fitzy/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyPlanService } from '@/lib/services/fitzy-plan-service';
import { UsageService } from '@/lib/services/usage-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: z.boolean() });

/** POST /api/mobile/fitzy/plan/commitments/{id}/check { date, done } → { plan } (Pro). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireMobileAuth(request);
    const { date, done } = bodySchema.parse(await readJson(request));
    const tier = await UsageService.fitzyTier(user.id);
    const plan = await FitzyPlanService.check(user.id, (await params).id, date, done, todayFor(request.headers.get('x-client-timezone')), tier === 'pro');
    return ok({ plan });
  } catch (error) {
    return fitzyFail(error);
  }
}
