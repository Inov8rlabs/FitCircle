import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BodyCompTrendsService } from '@/lib/services/body-comp-trends-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { bodyCompTrendsQuerySchema } from '@/lib/types/body-composition';

/**
 * GET /api/mobile/body-comp/trends?lookbackDays=180 — server-computed trend engine
 * output (state, smoothed series, noise-flagged deltas, projection band, verbatim
 * insight copy + disclaimer). Feature gate: body_comp_trends.
 * BODY_COMP_BUILD_CONTRACT §2.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_trends');
    const { searchParams } = new URL(request.url);
    const { lookbackDays } = bodyCompTrendsQuerySchema.parse({
      lookbackDays: searchParams.get('lookbackDays') ?? undefined,
    });
    const trends = await BodyCompTrendsService.getTrends(user.id, lookbackDays);
    return NextResponse.json({ success: true, data: trends, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    return mapError(error);
  }
}

function mapError(error: any) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'PREMIUM_REQUIRED') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'PREMIUM_REQUIRED', message: 'This feature requires a premium subscription', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors.reduce((a: any, e) => { a[e.path.join('.')] = e.message; return a; }, {}), timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error('[Mobile API] body-comp trends error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}
