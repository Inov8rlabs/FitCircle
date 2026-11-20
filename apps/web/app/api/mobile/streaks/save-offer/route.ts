/**
 * GET /api/mobile/streaks/save-offer — can yesterday's broken streak still be saved?
 * (docs/ENGAGEMENT_115_SPEC.md §5.3, docs/ENGAGEMENT_115_CLIENT_CONTRACT.md §6)
 *
 * 200 { success, data: { eligible: true, offer_id, missed_date, lost_streak, restored_streak,
 *   expires_at, path: 'activate'|'paywall', shields_available, unlimited }
 *   | { eligible: false, reason: 'nothing_to_save'|'expired'|'zombie_guard'|'too_short' } }
 * Side effect: marks the offer opened (created on demand) — except with `?peek=1` (read-only, for
 * dashboard / Streaks card checks). Saving = POST /api/streaks/freeze/activate
 * { date: missed_date }. 401 UNAUTHORIZED · 500. Cache-Control: private, no-store.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakSaveService } from '@/lib/services/streak-save-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ success: false, data: null, meta: null, error: { code, message, details: {}, timestamp: new Date().toISOString() } }, { status, headers: NO_STORE });

export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const peek = ['1', 'true'].includes((request.nextUrl.searchParams.get('peek') ?? '').toLowerCase());
    const data = await StreakSaveService.getOffer(user.id, { timezone: resolveClientTimezone(request), peek });
    return NextResponse.json({ success: true, error: null, meta: null, data }, { headers: NO_STORE });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
    console.error('[GET /api/mobile/streaks/save-offer]', error?.message);
    return fail(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}
