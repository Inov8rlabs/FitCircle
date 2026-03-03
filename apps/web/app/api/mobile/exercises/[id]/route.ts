import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const updateExerciseSchema = z.object({
  exerciseType: z.string().min(1).max(50).optional(),
  category: z.enum(['cardio', 'strength', 'flexibility', 'sports', 'outdoor', 'other']).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  caloriesBurned: z.number().positive().optional(),
  distanceMeters: z.number().positive().optional(),
  avgHeartRate: z.number().int().min(1).max(300).optional(),
  effortLevel: z.number().int().min(1).max(10).optional(),
  locationType: z.enum(['home', 'gym', 'outdoor', 'studio']).nullable().optional(),
  workoutCompanion: z.enum(['solo', 'group', 'trainer', 'virtual_class']).nullable().optional(),
  isIndoor: z.boolean().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
});

/**
 * GET /api/mobile/exercises/:id
 * Get a single exercise log
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.getExercise(id, user.id, supabaseAdmin);

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: result.error.message } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result.data, error: null });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/:id] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mobile/exercises/:id
 * Update an exercise log
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const body = await request.json();
    const validated = updateExerciseSchema.parse(body);

    const supabaseAdmin = createAdminSupabase();

    const updateData: Record<string, unknown> = {};
    if (validated.exerciseType !== undefined) updateData.exercise_type = validated.exerciseType;
    if (validated.category !== undefined) updateData.category = validated.category;
    if (validated.durationMinutes !== undefined) updateData.duration_minutes = validated.durationMinutes;
    if (validated.caloriesBurned !== undefined) updateData.calories_burned = validated.caloriesBurned;
    if (validated.distanceMeters !== undefined) updateData.distance_meters = validated.distanceMeters;
    if (validated.avgHeartRate !== undefined) updateData.avg_heart_rate = validated.avgHeartRate;
    if (validated.effortLevel !== undefined) updateData.effort_level = validated.effortLevel;
    if (validated.locationType !== undefined) updateData.location_type = validated.locationType;
    if (validated.workoutCompanion !== undefined) updateData.workout_companion = validated.workoutCompanion;
    if (validated.isIndoor !== undefined) updateData.is_indoor = validated.isIndoor;
    if (validated.notes !== undefined) updateData.notes = validated.notes;
    if (validated.startedAt !== undefined) updateData.started_at = validated.startedAt;

    const result = await ExerciseService.updateExercise(id, user.id, updateData, supabaseAdmin);

    if (result.error) {
      const status = result.error.message === 'Not authorized' ? 403 : 400;
      return NextResponse.json(
        { success: false, data: null, error: { code: status === 403 ? 'FORBIDDEN' : 'UPDATE_FAILED', message: result.error.message } },
        { status }
      );
    }

    return NextResponse.json({ success: true, data: result.data, error: null });
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

    console.error('[PUT /api/mobile/exercises/:id] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mobile/exercises/:id
 * Soft-delete an exercise log
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.deleteExercise(id, user.id, supabaseAdmin);

    if (result.error) {
      const status = result.error.message === 'Not authorized' ? 403 : 400;
      return NextResponse.json(
        { success: false, error: { code: status === 403 ? 'FORBIDDEN' : 'DELETE_FAILED', message: result.error.message } },
        { status }
      );
    }

    return NextResponse.json({ success: true, error: null });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[DELETE /api/mobile/exercises/:id] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
