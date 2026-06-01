import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodsService } from '@/lib/services/foods-service';

/**
 * GET /api/mobile/foods/barcode/[code]
 * PRD §6.1 — barcode lookup against the foods reference table. 404 when not found, so the
 * client can offer manual search / an OFF contribution.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const startTime = Date.now();
  try {
    await requireMobileAuth(request);
    const { code } = await params;

    const food = await FoodsService.lookupBarcode(code);

    if (!food) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: 'No food matched that barcode', details: { barcode: code }, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: food,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    console.error('[Mobile API] Barcode lookup error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
