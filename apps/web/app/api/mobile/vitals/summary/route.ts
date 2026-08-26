import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { VitalsService } from '@/lib/services/vitals-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';

/**
 * GET /api/mobile/vitals/summary?days=7
 *
 * The dashboard Weight / BMI / Water cards, computed once on the server in
 * the user's timezone (x-client-timezone header → profile → UTC) and in
 * canonical units (kg, ml). Shared by iOS, Android and web.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const daysParam = Number(searchParams.get('days') ?? 7);
    const days = Number.isFinite(daysParam) ? daysParam : 7;

    const data = await VitalsService.getSummary(user.id, {
      days,
      timezone: resolveClientTimezone(request),
    });

    const response = NextResponse.json({
      success: true,
      data,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
    response.headers.set('Cache-Control', 'private, max-age=60');
    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    console.error('[GET /api/mobile/vitals/summary] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
