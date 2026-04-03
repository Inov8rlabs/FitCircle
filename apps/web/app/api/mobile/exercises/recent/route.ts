import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { WorkoutLoggingService } from '@/lib/services/workout-logging-service';

/**
 * GET /api/mobile/exercises/recent
 * Returns the user's last 5 unique brand+category workout combos
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 20);

    const recent = await WorkoutLoggingService.getRecentActivities(user.id, limit);

    const response = NextResponse.json({
      success: true,
      data: recent,
      error: null,
    });

    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/recent] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
