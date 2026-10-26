import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { MEAL_SLOTS } from '@/lib/journey/meal-slots';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { fail, failFrom, ok } from '@/lib/referrals/http';
import { JourneyService } from '@/lib/services/journey-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/me/journey (docs/ACTIVATION_JOURNEY_SPEC.md Appendix A)
 * The activation facts the apps need for the post-first-meal Meet-Fitzy sheet
 * and the soft paywall: { mealsLoggedEver, firstMealAt, fitzyOpenedAt,
 * fitzyIntroSeenAt, paywallAutoEligible, autoEligible, postAhaEligible,
 * nextAutoEligibleAt, paywallAutoLastAt, paywallAhaShownAt, isPro,
 * subscriptionsEnabled, signupAt, mealReminderPrefs }.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    return ok(await JourneyService.getJourney(user));
  } catch (error) {
    return failFrom(error, 'me/journey GET');
  }
}

const patchSchema = z
  .object({
    mealReminderPrefs: z
      .object(Object.fromEntries(MEAL_SLOTS.map((s) => [s, z.boolean().optional()])) as Record<(typeof MEAL_SLOTS)[number], z.ZodOptional<z.ZodBoolean>>)
      .strict(),
  })
  .strict();

/**
 * PATCH /api/mobile/me/journey  { mealReminderPrefs: { breakfast?, lunch?, snack?, dinner? } }
 * (the same toggles are also accepted by PATCH /api/mobile/notifications/preferences as `meal_reminders`).
 * → 200 { mealReminderPrefs } (full, with defaults).
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'Body must be { mealReminderPrefs: { breakfast?, lunch?, snack?, dinner? } } with booleans');
    const mealReminderPrefs = await JourneyService.updateMealReminderPrefs(user.id, parsed.data.mealReminderPrefs);
    return ok({ mealReminderPrefs });
  } catch (error) {
    return failFrom(error, 'me/journey PATCH');
  }
}
