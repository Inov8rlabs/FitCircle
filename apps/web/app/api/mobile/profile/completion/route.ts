import { type NextRequest } from 'next/server';

import { mobileFailFrom, ok, readJson } from '@/lib/experiments/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { profileAnswerSchema } from '@/lib/profile-completion/model';
import { ProfileCompletionService } from '@/lib/services/profile-completion-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/profile/completion
 * → data: { percent, answered, total, remaining, units, hints }
 *
 * The profile completion status (docs/PROFILE_COMPLETION_CARD_SPEC.md), the
 * same shape as the home feed `profile_completion@1` card props.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    return ok(await ProfileCompletionService.status(user.id), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'profile/completion');
  }
}

/**
 * POST /api/mobile/profile/completion { key, value, source? }
 * → data: { percent, answered, total, remaining, units, hints, key, targets_updated }
 *
 * Saves one answer where the app already keeps it (profile columns, today's
 * weigh-in, the vitals weight goal, preferences.about_you), then refreshes the
 * daily targets when they are still the untouched onboarding plan
 * (`targets_updated` lists the fields; clients refetch GET /api/mobile/targets).
 * 400 VALIDATION_ERROR { issues } for an unknown key or an out-of-range value.
 * Idempotent: resending the same answer is safe (offline queues may retry).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const answer = profileAnswerSchema.parse(await readJson(request));
    return ok(await ProfileCompletionService.answer(user.id, answer, { timezone: resolveClientTimezone(request) }), startTime);
  } catch (error) {
    return mobileFailFrom(error, 'profile/completion');
  }
}
