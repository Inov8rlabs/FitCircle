import { type NextRequest } from 'next/server';

import { fitzyFail, ok } from '@/lib/fitzy/http';
import { paywallFor } from '@/lib/fitzy/paywall';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyMemoryService } from '@/lib/services/fitzy-memory-service';
import { UsageService } from '@/lib/services/usage-service';

export const dynamic = 'force-dynamic';

/** GET /api/mobile/fitzy/memory → { items, locked, paywall? } (Free: locked teaser). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    if ((await UsageService.fitzyTier(user.id)) !== 'pro') return ok({ items: [], locked: true, paywall: paywallFor('memory') });
    return ok({ items: await FitzyMemoryService.items(user.id), locked: false });
  } catch (error) {
    return fitzyFail(error);
  }
}

/** DELETE /api/mobile/fitzy/memory — clear everything Fitzy remembers. */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    await FitzyMemoryService.clear(user.id);
    return ok({ items: [] });
  } catch (error) {
    return fitzyFail(error);
  }
}
