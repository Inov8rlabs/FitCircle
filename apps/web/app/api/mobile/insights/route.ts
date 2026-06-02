import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CrossSignalService } from '@/lib/services/cross-signal-service';
import { DEFAULT_LOOKBACK_DAYS } from '@/lib/types/cross-signal';

/**
 * GET /api/mobile/insights?lookbackDays=
 * PRD §6.10 — gentle, correlational cross-signal insights computed from existing data.
 * Thin route: all correlation math + healthy-engagement copy framing lives in
 * CrossSignalService. Returns InsightDTO[].
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const lookbackRaw = searchParams.get('lookbackDays');
    const lookbackDays = lookbackRaw ? parseInt(lookbackRaw, 10) : DEFAULT_LOOKBACK_DAYS;

    const insights = await CrossSignalService.getInsights(user.id, lookbackDays);

    return NextResponse.json({
      success: true,
      data: insights,
      meta: { requestTime: Date.now() - startTime, count: insights.length },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    console.error('[Mobile API] Insights error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
