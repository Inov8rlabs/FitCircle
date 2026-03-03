import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/exercises/calorie-balance?date=2026-03-01
 * Get calorie balance for a date (exercise + food)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD format' } },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminSupabase();
    const result = await ExerciseService.getCalorieBalance(user.id, date, supabaseAdmin);

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'FETCH_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/calorie-balance] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
