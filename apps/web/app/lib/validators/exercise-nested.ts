/**
 * Shared Zod validators + camelCase→snake_case mappers for the nested structured
 * exercise log used by POST/PUT /api/mobile/exercises.
 *
 * Wire contract (camelCase) is frozen in
 * docs/WORKOUT-EXERCISE-LOG-IMPLEMENTATION-PLAN.md §2.2. Weight is canonical kilograms.
 */

import { z } from 'zod';

import type { WorkoutExerciseInput } from '@/lib/types/exercise';

export const trackingTypeEnum = z.enum([
  'weight_reps',
  'reps_only',
  'duration',
  'distance_duration',
]);

export const setTypeEnum = z.enum(['normal', 'warmup', 'drop', 'failure', 'amrap']);

export const exerciseSetSchema = z.object({
  setNumber: z.number().int().min(1).max(100),
  setType: setTypeEnum.optional(),
  weightKg: z.number().min(0).max(2000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  distanceMeters: z.number().min(0).max(1000000).nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  isCompleted: z.boolean().optional(),
});

export const workoutExerciseSchema = z
  .object({
    exerciseId: z.string().uuid().optional(),
    customName: z.string().min(1).max(120).optional(),
    primaryMuscle: z.string().max(40).nullable().optional(),
    equipment: z.string().max(30).nullable().optional(),
    trackingType: trackingTypeEnum.nullable().optional(),
    position: z.number().int().min(0).max(200),
    notes: z.string().max(2000).nullable().optional(),
    restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
    sets: z.array(exerciseSetSchema).max(50).default([]),
  })
  .refine((d) => Boolean(d.exerciseId) || Boolean(d.customName), {
    message: 'Either exerciseId or customName is required',
  });

export const exercisesArraySchema = z.array(workoutExerciseSchema).max(50);

export type WorkoutExerciseWire = z.infer<typeof workoutExerciseSchema>;

/**
 * Map the validated camelCase wire array to the service-layer snake_case input.
 */
export function mapExercisesToInput(
  exercises: WorkoutExerciseWire[]
): WorkoutExerciseInput[] {
  return exercises.map((ex) => ({
    exercise_id: ex.exerciseId ?? null,
    custom_name: ex.customName ?? null,
    primary_muscle: ex.primaryMuscle ?? null,
    equipment: ex.equipment ?? null,
    tracking_type: ex.trackingType ?? null,
    position: ex.position,
    notes: ex.notes ?? null,
    rest_seconds: ex.restSeconds ?? null,
    sets: ex.sets.map((s) => ({
      set_number: s.setNumber,
      set_type: s.setType,
      weight_kg: s.weightKg ?? null,
      reps: s.reps ?? null,
      duration_seconds: s.durationSeconds ?? null,
      distance_meters: s.distanceMeters ?? null,
      rpe: s.rpe ?? null,
      is_completed: s.isCompleted,
    })),
  }));
}
