import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { WorkoutLoggingService } from '@/lib/services/workout-logging-service';

/**
 * GET /api/mobile/exercises/brands
 * Returns the list of supported workout brands with icons and default categories
 */
export async function GET(request: NextRequest) {
  try {
    await requireMobileAuth(request);

    const brands = WorkoutLoggingService.getBrands();

    const response = NextResponse.json({
      success: true,
      data: brands,
      error: null,
    });

    // Cache for 24 hours (static data)
    response.headers.set('Cache-Control', 'private, max-age=86400');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/brands] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
