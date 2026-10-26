import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { fail, failFrom, ok } from '@/lib/referrals/http';
import { JOURNEY_EVENTS, JourneyService } from '@/lib/services/journey-service';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    event: z.enum(JOURNEY_EVENTS),
    /** paywall_shown: the paywall placement / Paywall Viewed source (e.g. first_meal_aha, feed_pro_value). */
    placement: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).optional(),
    /** paywall_shown: true (default) when the app presented it on its own; false for a user tap (doesn't start the 72 h spacing). */
    automatic: z.boolean().optional(),
  })
  .strict();

/**
 * POST /api/mobile/me/journey/events (docs/ACTIVATION_JOURNEY_SPEC.md Appendix A)
 *  { event: 'fitzy_opened' }                       Fitzy opened from any entry point (sets fitzy_opened_at once)
 *  { event: 'fitzy_intro_seen' }                   the post-first-meal Meet-Fitzy sheet was shown
 *  { event: 'paywall_shown', placement, automatic } an app-presented paywall (72 h spacing; first_meal_aha = once)
 * → 200 { event, ...stored timestamps }.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail(400, 'VALIDATION_ERROR', `event must be one of ${JOURNEY_EVENTS.join(', ')}`);
    const { event, placement, automatic } = parsed.data;
    const stored = await JourneyService.recordEvent(user.id, event, { placement, automatic, profile: user });
    return ok({ event, ...stored });
  } catch (error) {
    return failFrom(error, 'me/journey/events POST');
  }
}
