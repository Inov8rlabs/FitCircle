import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { VitalsService } from '@/lib/services/vitals-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';

const goalsSchema = z
  .object({
    /** kg; null clears the weight goal. */
    target_weight_kg: z.number().min(20).max(400).nullable().optional(),
    starting_weight_kg: z.number().min(20).max(400).nullable().optional(),
    /** ml per day; null reverts to the default. */
    daily_water_ml_target: z.number().int().min(250).max(10000).nullable().optional(),
  })
  .refine(v => v.target_weight_kg !== undefined || v.starting_weight_kg !== undefined || v.daily_water_ml_target !== undefined, {
    message: 'Nothing to update',
  });

/**
 * PUT /api/mobile/vitals/goals
 * Set / clear the weight goal and the daily hydration target. Returns the
 * refreshed vitals summary so the caller can re-render without a second call.
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = goalsSchema.parse(await request.json());

    await VitalsService.updateGoals(user.id, body);
    const data = await VitalsService.getSummary(user.id, { days: 7, timezone: resolveClientTimezone(request) });

    return NextResponse.json({ success: true, data, error: null, meta: { timestamp: new Date().toISOString() } });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message ?? 'Invalid input' } },
        { status: 400 }
      );
    }
    console.error('[PUT /api/mobile/vitals/goals] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
