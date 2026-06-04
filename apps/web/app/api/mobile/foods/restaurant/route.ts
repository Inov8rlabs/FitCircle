import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { RestaurantFoodsService } from '@/lib/services/restaurant-foods-service';

/**
 * GET /api/mobile/foods/restaurant?q=
 * PRD §6.12 (Dining-Out) — restaurant/chain item lookup via Nutritionix.
 *
 * ENV-GATED: returns data only when NUTRITIONIX_APP_ID + NUTRITIONIX_API_KEY are set; otherwise
 * returns an empty list so the client falls back to photo estimation. Failure-isolated: any
 * upstream error yields []. Thin route: logic lives in RestaurantFoodsService.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    void user; // auth-gated; results are not user-scoped (external reference data)

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';

    const results = await RestaurantFoodsService.searchRestaurantItem(q);

    return NextResponse.json({
      success: true,
      data: results,
      meta: {
        requestTime: Date.now() - startTime,
        count: results.length,
        // Signals whether the restaurant DB is provisioned (keys present). When false, an empty
        // list is expected and the client should fall back to photo estimation.
        provider: process.env.NUTRITIONIX_APP_ID ? 'nutritionix' : 'disabled',
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
    console.error('[Mobile API] Restaurant foods error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
