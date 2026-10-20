import { type NextRequest } from 'next/server';

import { fitzyFail, ok } from '@/lib/fitzy/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyFocusService } from '@/lib/services/fitzy-focus-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/mobile/fitzy/today → daily focus (cached per user per local day; x-client-timezone). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    return ok(await FitzyFocusService.get(user.id, request.headers.get('x-client-timezone')));
  } catch (error) {
    return fitzyFail(error);
  }
}
