import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodsService } from '@/lib/services/foods-service';

/**
 * GET /api/mobile/foods/search?q=&limit=&locale=
 * PRD §6.1 — combined full-text search over OFF + USDA + the user's custom foods, locale-biased.
 * Thin route: ranking/logic lives in FoodsService.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';
    const limitRaw = searchParams.get('limit');
    const locale = searchParams.get('locale') ?? undefined;

    const results = await FoodsService.search(user.id, {
      query: q,
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
      locale,
    });

    return NextResponse.json({
      success: true,
      data: results,
      meta: { requestTime: Date.now() - startTime, count: results.length },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    console.error('[Mobile API] Foods search error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
