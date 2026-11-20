/**
 * GET /api/mobile/streaks/celebrations — a streak milestone the app has not shown yet
 * (docs/ENGAGEMENT_115_SPEC.md §5.4). Call on launch / foreground and on route=streak_milestone.
 *
 * 200 { success, data: { pending: { milestone, name, icon, shields_granted, reached_on } | null } }
 * (pending only within 72 h). Ack with POST /api/mobile/streaks/celebrations/ack { milestone }.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakCelebrationService } from '@/lib/services/streak-celebration-service';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const pending = await StreakCelebrationService.getPending(user.id);
    return NextResponse.json({ success: true, error: null, meta: null, data: { pending } }, { headers: NO_STORE });
  } catch (error: any) {
    const unauthorized = error?.message === 'Unauthorized';
    if (!unauthorized) console.error('[GET /api/mobile/streaks/celebrations]', error?.message);
    return NextResponse.json(
      {
        success: false,
        data: null,
        meta: null,
        error: unauthorized
          ? { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }
          : { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() },
      },
      { status: unauthorized ? 401 : 500, headers: NO_STORE }
    );
  }
}
