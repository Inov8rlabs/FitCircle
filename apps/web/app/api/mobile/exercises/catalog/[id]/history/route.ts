import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/exercises/catalog/:id/history
 * Per-exercise history for the "Previous" column + insights:
 * last session's sets, best set, e1RM series, volume series. Owner-scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.getExerciseHistory(user.id, id, supabaseAdmin);

    if (result.error) {
      const notFound = result.error.message === 'Exercise not found';
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: notFound ? 'NOT_FOUND' : 'FETCH_FAILED',
            message: result.error.message,
          },
        },
        { status: notFound ? 404 : 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/catalog/:id/history] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
