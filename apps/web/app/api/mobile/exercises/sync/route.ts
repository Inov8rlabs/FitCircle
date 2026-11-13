import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { platformFrom } from '@/lib/services/app-open-service';
import { ExerciseService } from '@/lib/services/exercise-service';
import { HealthSyncPushService } from '@/lib/services/health-sync-push-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';
import { localToday } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { runAfterResponse } from '@/lib/utils/after-response';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';
import { isoInstant, optionalPositiveMeasure } from '@/lib/validators/exercise-fields';
import { exerciseSourceInputSchema, resolveExerciseSource } from '@/lib/validators/exercise-source';

const exerciseItemSchema = z.object({
  exerciseType: z.string().min(1).max(50),
  category: z.enum(['cardio', 'strength', 'flexibility', 'sports', 'outdoor', 'other']),
  durationMinutes: z.number().int().min(1).max(1440),
  caloriesBurned: optionalPositiveMeasure,
  distanceMeters: optionalPositiveMeasure,
  avgHeartRate: z.number().int().min(1).max(300).optional(),
  effortLevel: z.number().int().min(1).max(10).optional(),
  locationType: z.enum(['home', 'gym', 'outdoor', 'studio']).optional(),
  workoutCompanion: z.enum(['solo', 'group', 'trainer', 'virtual_class']).optional(),
  isIndoor: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startedAt: isoInstant.optional(),
  healthkitWorkoutId: z.string().max(100),
  sourceDeviceName: z.string().max(100).optional(),
  // Accepts health_connect / google_fit too; the row is stored as 'healthkit' and the
  // declared origin goes in source_platform (lib/validators/exercise-source.ts).
  source: exerciseSourceInputSchema.optional().default('healthkit'),
});

const bulkSyncSchema = z.object({
  exercises: z.array(exerciseItemSchema).min(1).max(100),
  /** Accepted for old clients; ignored — the server decides (workout-claim-policy). */
  autoClaimStreak: z.boolean().optional(),
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
    const validated = parseLenient(bulkSyncSchema, body, { ignore: ['timezone'] }); // timezone: read below

    const supabaseAdmin = createAdminSupabase();

    const exercises = validated.exercises.map((e) => {
      const { source, sourcePlatform } = resolveExerciseSource(e.source, 'healthkit');
      return {
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
        source,
        source_platform: sourcePlatform,
      };
    });

    // Synced workouts of >= 10 min claim their streak day (workout-claim-policy);
    // the outcome rides back in meta.streak so the client can refresh the card.
    const timezone = resolveClientTimezone(request, body?.timezone);
    const result = await ExerciseService.bulkSyncExercises(user.id, { exercises, timezone }, supabaseAdmin);

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'SYNC_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    // Health sync update push (docs/PUSH_NOTIFICATIONS.md §8.5): NEW workouts only,
    // decided after the response (never affects the sync).
    const created = new Set((result.data?.results ?? []).filter((r) => r.status === 'created').map((r) => r.healthkit_workout_id));
    if (created.size > 0) {
      const workouts = exercises
        .filter((e) => created.has(e.healthkit_workout_id))
        .map((e) => ({ exerciseType: e.exercise_type, minutes: e.duration_minutes, date: e.date || localToday(timezone) }));
      const streak = result.streak;
      runAfterResponse(() => HealthSyncPushService.onWorkoutsSynced(user.id, { workouts, platform: platformFrom(request), streak }), 'health-sync push');
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: { requestTime: Date.now() - startTime, streak: result.streak },
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
            message: validationMessage(error),
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
