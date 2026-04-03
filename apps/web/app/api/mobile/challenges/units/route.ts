import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { UNITS_BY_CATEGORY } from '@/lib/services/template-service';

/**
 * GET /api/mobile/challenges/units?category=
 * Return valid units per challenge category
 */
export async function GET(request: NextRequest) {
  try {
    await requireMobileAuth(request);

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (category && UNITS_BY_CATEGORY[category]) {
      return NextResponse.json({
        success: true,
        data: { [category]: UNITS_BY_CATEGORY[category] },
        error: null,
      });
    }

    return NextResponse.json({
      success: true,
      data: UNITS_BY_CATEGORY,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}
