import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const exerciseItemSchema = z.object({
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
  healthkitWorkoutId: z.string().max(100),
  sourceDeviceName: z.string().max(100).optional(),
  source: z.enum(['manual', 'healthkit']).optional().default('healthkit'),
});

const bulkSyncSchema = z.object({
  exercises: z.array(exerciseItemSchema).min(1).max(100),
  autoClaimStreak: z.boolean().optional().default(false),
});

/**
 * POST /api/mobile/exercises/sync
 * Bulk sync exercises from HealthKit
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const validated = bulkSyncSchema.parse(body);

    const supabaseAdmin = createAdminSupabase();

    const exercises = validated.exercises.map((e) => ({
      exercise_type: e.exerciseType,
      category: e.category,
      duration_minutes: e.durationMinutes,
      calories_burned: e.caloriesBurned,
      distance_meters: e.distanceMeters,
      avg_heart_rate: e.avgHeartRate,
      effort_level: e.effortLevel,
      location_type: e.locationType,
      workout_companion: e.workoutCompanion,
      is_indoor: e.isIndoor,
      notes: e.notes,
      date: e.date,
      started_at: e.startedAt,
      healthkit_workout_id: e.healthkitWorkoutId,
      source_device_name: e.sourceDeviceName,
      source: e.source as 'manual' | 'healthkit',
      auto_claim_streak: false, // Never claim streak for bulk sync
    }));

    const result = await ExerciseService.bulkSyncExercises(
      user.id,
      { exercises, auto_claim_streak: false },
      supabaseAdmin
    );

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'SYNC_FAILED', message: result.error.message } },
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

    console.error('[POST /api/mobile/exercises/sync] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
