/**
 * GET /api/mobile/rating-prompt — may this user be asked for a store rating,
 * and at which moments? Server-driven (docs/RATING_PROMPT.md): the apps ask the
 * OS (iOS RequestReview / Play In-App Review) only when `eligible` is true AND
 * the moment's trigger key is in `triggers`. Fetched at most once per app
 * session. no-store.
 *
 * Client context from the headers every mobile request carries:
 *   X-App-Platform ios | android, X-App-Version 1.1.2 (+ Vercel's IP country).
 *
 * data: { eligible, reason, triggers: [{ key, streakLengths? }], cooldownUntil,
 *         promptCount, maxPrompts, exclusions: { paywallSameSession,
 *         paywallSameDay, recentErrorMinutes }, configVersion }
 * Any failure → 200 with eligible:false, reason "unavailable" (never prompt on doubt).
 */
import { type NextRequest } from 'next/server';

import { readExperimentRequestInfo } from '@/lib/experiments/request-info';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { fail, ok } from '@/lib/referrals/http';
import { RatingPromptService } from '@/lib/services/rating-prompt-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let user: { id: string };
  try {
    user = await requireMobileAuth(request);
  } catch {
    return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  const info = readExperimentRequestInfo(request);
  try {
    const decision = await RatingPromptService.decide(user.id, {
      platform: info.platform,
      appVersion: info.appVersion,
      country: info.ipCountry,
    });
    return ok(decision, startTime);
  } catch (error: any) {
    console.error('[Mobile API] rating-prompt decision failed:', error?.message ?? error);
    return ok(
      {
        eligible: false,
        reason: 'unavailable',
        triggers: [],
        cooldownUntil: null,
        promptCount: 0,
        maxPrompts: 0,
        exclusions: { paywallSameSession: true, paywallSameDay: true, recentErrorMinutes: 0 },
        configVersion: null,
      },
      startTime
    );
  }
}
