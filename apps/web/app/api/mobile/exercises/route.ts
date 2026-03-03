import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const createExerciseSchema = z.object({
  exerciseType: z.string().min(1).max(50),
  category: z.enum(['cardio', 'strength', 'flexibility', 'sports', 'outdoor', 'other']),
  durationMinutes: z.number().int().min(1).max(1440),
  caloriesBurned: z.number().positive().optional(),
  distanceMeters: z.number().positive().optional(),
  avgHeartRate: z.number().int().min(1).max(300).optional(),
  effortLevel: z.number().int().min(1).max(10).optional(),
  locationType: z.enum(['home', 'gym', 'outdoor', 'studio']).optional(),
  workoutCompanion: z.enum(['solo', 'group', 'trainer', 'virtual_class']).optional(),
  isIndoor: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startedAt: z.string().datetime().optional(),
  healthkitWorkoutId: z.string().max(100).optional(),
  sourceDeviceName: z.string().max(100).optional(),
  source: z.enum(['manual', 'healthkit']).optional().default('manual'),
  autoClaimStreak: z.boolean().optional(),
});

/**
 * POST /api/mobile/exercises
 * Create a single exercise log (manual entry)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const validated = createExerciseSchema.parse(body);

    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.createExercise(
      user.id,
      {
        exercise_type: validated.exerciseType,
        category: validated.category,
        duration_minutes: validated.durationMinutes,
        calories_burned: validated.caloriesBurned,
        distance_meters: validated.distanceMeters,
        avg_heart_rate: validated.avgHeartRate,
        effort_level: validated.effortLevel,
        location_type: validated.locationType,
        workout_companion: validated.workoutCompanion,
        is_indoor: validated.isIndoor,
        notes: validated.notes,
        date: validated.date,
        started_at: validated.startedAt,
        healthkit_workout_id: validated.healthkitWorkoutId,
        source_device_name: validated.sourceDeviceName,
        source: validated.source,
        auto_claim_streak: validated.autoClaimStreak,
      },
      supabaseAdmin
    );

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'CREATE_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data?.exercise,
      newMilestones: result.data?.new_milestones || [],
      newPersonalRecords: result.data?.new_personal_records || [],
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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            details: error.errors.reduce(
              (acc: Record<string, string>, err) => {
                acc[err.path.join('.')] = err.message;
                return acc;
              },
              {}
            ),
          },
        },
        { status: 400 }
      );
    }

    console.error('[POST /api/mobile/exercises] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mobile/exercises
 * Get exercise logs with date range filter and pagination
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const category = searchParams.get('category') || undefined;
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;
    const requestedLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20;
    const limit = Math.min(requestedLimit, 100);

    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.getExercises(
      user.id,
      { startDate, endDate, category, page, limit },
      supabaseAdmin
    );

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'FETCH_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      meta: {
        totalCount: result.total,
        totalMinutes: result.totalMinutes,
        totalCalories: result.totalCalories,
        page,
        limit,
        hasMore: result.hasMore,
        requestTime: Date.now() - startTime,
      },
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

    console.error('[GET /api/mobile/exercises] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
