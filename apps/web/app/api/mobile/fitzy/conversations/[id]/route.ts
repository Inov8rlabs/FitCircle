import { type NextRequest } from 'next/server';

import { fitzyFail, ok } from '@/lib/fitzy/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyConversationService } from '@/lib/services/fitzy-conversation-service';
import { UsageService } from '@/lib/services/usage-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/mobile/fitzy/conversations/{id} → { id, title, messages } (Free: latest only, else 403 + history paywall). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireMobileAuth(request);
    const tier = await UsageService.fitzyTier(user.id);
    return ok(await FitzyConversationService.get(user.id, tier, (await params).id));
  } catch (error) {
    return fitzyFail(error);
  }
}

/** DELETE /api/mobile/fitzy/conversations/{id} */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireMobileAuth(request);
    await FitzyConversationService.remove(user.id, (await params).id);
    return ok({ deleted: true });
  } catch (error) {
    return fitzyFail(error);
  }
}
