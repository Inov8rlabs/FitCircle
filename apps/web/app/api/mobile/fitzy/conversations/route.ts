import { type NextRequest } from 'next/server';

import { fitzyFail, ok } from '@/lib/fitzy/http';
import { paywallFor } from '@/lib/fitzy/paywall';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyConversationService } from '@/lib/services/fitzy-conversation-service';
import { JourneyService } from '@/lib/services/journey-service';
import { UsageService } from '@/lib/services/usage-service';
import { runAfterResponse } from '@/lib/utils/after-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/fitzy/conversations → { conversations, historyLocked } (Free: latest only).
 * iOS calls this only when the Fitzy sheet opens, so it also records the first Fitzy open.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    // First Fitzy open → profiles.fitzy_opened_at (ACTIVATION_JOURNEY_SPEC §6). Zero queries once set.
    runAfterResponse(() => JourneyService.markFitzyOpened(user.id, user), 'fitzy opened');
    const tier = await UsageService.fitzyTier(user.id);
    const out = await FitzyConversationService.list(user.id, tier);
    return ok(out.historyLocked ? { ...out, paywall: paywallFor('history') } : out);
  } catch (error) {
    return fitzyFail(error);
  }
}
