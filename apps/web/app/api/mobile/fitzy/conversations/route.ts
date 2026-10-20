import { type NextRequest } from 'next/server';

import { fitzyFail, ok } from '@/lib/fitzy/http';
import { paywallFor } from '@/lib/fitzy/paywall';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyConversationService } from '@/lib/services/fitzy-conversation-service';
import { UsageService } from '@/lib/services/usage-service';

export const dynamic = 'force-dynamic';

/** GET /api/mobile/fitzy/conversations → { conversations, historyLocked } (Free: latest only). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const tier = await UsageService.fitzyTier(user.id);
    const out = await FitzyConversationService.list(user.id, tier);
    return ok(out.historyLocked ? { ...out, paywall: paywallFor('history') } : out);
  } catch (error) {
    return fitzyFail(error);
  }
}
