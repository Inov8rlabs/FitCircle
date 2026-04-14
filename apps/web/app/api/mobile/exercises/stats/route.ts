import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/exercises/stats?period=week
 * Get exercise statistics for a period
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'week';

    if (!['day', 'week', 'month'].includes(periodParam)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'period must be day, week, or month' } },
        { status: 400 }
      );
    }

    const period = periodParam as 'day' | 'week' | 'month';
    const supabaseAdmin = createAdminSupabase();
    const result = await ExerciseService.getStats(user.id, period, supabaseAdmin);

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'STATS_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });

    response.headers.set('Cache-Control', 'private, max-age=120');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/stats] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
