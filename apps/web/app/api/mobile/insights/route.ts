import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CrossSignalService } from '@/lib/services/cross-signal-service';
import { UsageService } from '@/lib/services/usage-service';
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
    let lookbackDays = lookbackRaw ? parseInt(lookbackRaw, 10) : DEFAULT_LOOKBACK_DAYS;

    // History soft-gate: free tier sees a 14-day window once history_extended is
    // live. CLAMP, never 403 — the client renders an "unlock full history" footer
    // off meta.clamped instead of losing the feature.
    const windowDays = await UsageService.historyWindowDays(user.id);
    const clamped = Number.isFinite(windowDays) && lookbackDays > windowDays;
    if (clamped) lookbackDays = windowDays as number;

    const insights = await CrossSignalService.getInsights(user.id, lookbackDays);

    return NextResponse.json({
      success: true,
      data: insights,
      meta: {
        requestTime: Date.now() - startTime,
        count: insights.length,
        ...(clamped ? { clamped: true, feature: 'history_extended', windowDays } : {}),
      },
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
