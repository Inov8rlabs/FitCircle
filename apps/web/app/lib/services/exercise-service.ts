/**
 * Exercise Service
 *
 * Business logic for exercise/workout tracking including:
 * - Manual entry CRUD operations
 * - HealthKit bulk sync with deduplication
 * - Statistics and aggregations
 * - Calorie estimation via MET values
 * - Milestone and personal record detection
 * - Streak integration (manual entries claim streaks)
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { localToday } from '../streaks/streak-calculator';
import { workoutCountsForStreak } from '../streaks/workout-claim-policy';
import { StreakClaimingService } from './streak-claiming-service';
import type { AutoClaimResult } from '../types/streak-claiming';

import type {
  ExerciseLog,
  ExerciseLogCreateInput,
  ExerciseBulkSyncInput,
  ExerciseBulkSyncResponse,
  ExerciseSyncResult,
  ExerciseStatsResponse,
  RecentExerciseType,
  CalorieBalanceResponse,
  DetectedMilestone,
  DetectedPR,
  ExerciseCreateResponse,
  WorkoutExerciseInput,
  WorkoutExerciseRead,
  ExerciseSetRead,
  ExerciseCatalogSummary,
  CustomExerciseInput,
  ExerciseHistoryResponse,
  ExerciseHistorySession,
  ExerciseTrackingType,
} from '../types/exercise';

// MET values for calorie estimation (MET × weight_kg × duration_hours)
const MET_VALUES: Record<string, number> = {
  // Cardio
  running: 8.0,
  walking: 3.5,
  cycling: 6.0,
  swimming: 7.0,
  hiking: 5.5,
  elliptical: 5.0,
  rowing: 6.0,
  stairClimbing: 6.0,
  jumpRope: 10.0,
  hiit: 8.0,
  mixedCardio: 6.0,
  cardioDance: 5.5,
  // Strength
  strengthTraining: 5.0,
  functionalTraining: 5.0,
  coreTraining: 3.5,
  crossTraining: 6.0,
  kickboxing: 7.0,
  // Flexibility
  yoga: 2.5,
  pilates: 3.0,
  barre: 3.5,
  stretching: 2.0,
  taiChi: 2.5,
  mindAndBody: 1.5,
  cooldown: 2.0,
  // Sports
  basketball: 6.5,
  soccer: 7.0,
  tennis: 6.0,
  pickleball: 4.5,
  golf: 3.5,
  baseball: 4.0,
  volleyball: 4.0,
  badminton: 5.5,
  tableTennis: 4.0,
  boxing: 7.5,
  martialArts: 6.0,
  wrestling: 6.0,
  // Outdoor
  skiing: 6.0,
  snowboarding: 5.0,
  crossCountrySkiing: 8.0,
  surfing: 5.0,
  climbing: 7.0,
  skating: 5.0,
  paddleSports: 5.0,
  // Other
  other: 4.0,
};

// Default body areas per exercise type (silently assigned)
const DEFAULT_BODY_AREAS: Record<string, string[]> = {
  running: ['legs', 'core'],
  walking: ['legs'],
  cycling: ['legs', 'core'],
  swimming: ['fullBody'],
  hiking: ['legs', 'core'],
  elliptical: ['legs', 'arms'],
  rowing: ['back', 'arms', 'core'],
  stairClimbing: ['legs', 'glutes'],
  jumpRope: ['legs', 'shoulders'],
  hiit: ['fullBody'],
  mixedCardio: ['fullBody'],
  cardioDance: ['fullBody'],
  strengthTraining: ['fullBody'],
  functionalTraining: ['fullBody'],
  coreTraining: ['core'],
  crossTraining: ['fullBody'],
  kickboxing: ['fullBody'],
  yoga: ['fullBody'],
  pilates: ['core', 'legs'],
  barre: ['legs', 'core'],
  stretching: ['fullBody'],
  taiChi: ['fullBody'],
  mindAndBody: [],
  cooldown: [],
  basketball: ['fullBody'],
  soccer: ['legs', 'core'],
  tennis: ['arms', 'legs', 'core'],
  pickleball: ['arms', 'legs'],
  golf: ['core', 'arms'],
  baseball: ['arms', 'core'],
  volleyball: ['arms', 'legs'],
  badminton: ['arms', 'legs'],
  tableTennis: ['arms'],
  boxing: ['arms', 'core'],
  martialArts: ['fullBody'],
  wrestling: ['fullBody'],
  skiing: ['legs', 'core'],
  snowboarding: ['legs', 'core'],
  crossCountrySkiing: ['fullBody'],
  surfing: ['arms', 'core'],
  climbing: ['arms', 'back', 'core'],
  skating: ['legs', 'core'],
  paddleSports: ['arms', 'back'],
  other: ['fullBody'],
};

export class ExerciseService {
  /**
   * Create a single exercise log (manual entry)
   */
  static async createExercise(
    userId: string,
    data: ExerciseLogCreateInput,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseCreateResponse | null; error: Error | null }> {
    try {
      // Default to the USER's local today, not the server's UTC date — a
      // 9pm workout in California is still "today" for the streak.
      const exerciseDate = data.date || localToday(data.timezone);
      const source = data.source || 'manual';

      // Auto-assign body areas from defaults if not provided
      const bodyAreas = DEFAULT_BODY_AREAS[data.exercise_type] || ['fullBody'];

      // Estimate calories if not provided and user has weight
      let caloriesBurned = data.calories_burned ?? null;
      let caloriesEstimated = false;
      if (caloriesBurned == null) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('weight_kg')
          .eq('id', userId)
          .single();

        if (profile?.weight_kg) {
          caloriesBurned = this.estimateCalories(
            data.exercise_type,
            data.duration_minutes,
            Number(profile.weight_kg)
          );
          caloriesEstimated = true;
        }
      }

      // Any workout >= 10 min counts as a check-in
      const countsAsCheckin = data.duration_minutes >= 10;

      const { data: exercise, error } = await supabase
        .from('exercise_logs')
        .insert({
          user_id: userId,
          exercise_type: data.exercise_type,
          category: data.category,
          duration_minutes: data.duration_minutes,
          calories_burned: caloriesBurned,
          calories_estimated: caloriesEstimated,
          exercise_date: exerciseDate,
          started_at: data.started_at || null,
          source,
          distance_meters: data.distance_meters ?? null,
          avg_heart_rate: data.avg_heart_rate ?? null,
          effort_level: data.effort_level ?? null,
          location_type: data.location_type ?? null,
          workout_companion: data.workout_companion ?? null,
          body_areas: bodyAreas,
          is_indoor: data.is_indoor ?? null,
          notes: data.notes ?? null,
          healthkit_workout_id: data.healthkit_workout_id ?? null,
          source_device_name: data.source_device_name ?? null,
          is_public: true,
          counts_as_checkin: countsAsCheckin,
        })
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Persist the optional nested structured exercise log (workout_exercises + exercise_sets),
      // then recompute the exercise_logs rollups. Ownership is guaranteed here because we just
      // created this parent row for `userId`.
      let strengthPRs: DetectedPR[] = [];
      if (data.exercises && data.exercises.length > 0) {
        const { error: persistError } = await this.persistExerciseLog(
          exercise.id,
          userId,
          data.exercises,
          supabase,
          { replace: false }
        );
        if (persistError) {
          // Data-loss guard: the client submitted a non-empty `exercises` array, so silently
          // succeeding would drop their sets. Fail the request instead (route turns this into a
          // non-2xx, matching the PUT path). Since the parent log only exists because of this
          // failed create, clean it up so the caller isn't left with a phantom empty workout and
          // can safely retry (there are no transactions here — CLAUDE.md forbids stored procs).
          console.error('[ExerciseService] Nested exercise persist failed:', persistError);
          await supabase.from('workout_exercises').delete().eq('exercise_log_id', exercise.id);
          await supabase.from('exercise_logs').delete().eq('id', exercise.id);
          return { data: null, error: persistError };
        } else {
          // Refresh the parent row so the response carries the recomputed rollups.
          const { data: refreshed } = await supabase
            .from('exercise_logs')
            .select('*')
            .eq('id', exercise.id)
            .single();
          if (refreshed) Object.assign(exercise, refreshed);
          strengthPRs = await this.detectStrengthPRs(userId, exercise.id, supabase);
        }
      }

      // Engagement HISTORY only (the activity feed / calendar). The streak
      // claim itself is written by the route via
      // StreakClaimingService.autoClaimForManualLog — recordActivity does not
      // create a streak_claims row, so it never counted toward the streak.
      // Same policy as the claim: any manual log, or a synced workout of
      // >= 10 minutes (see workout-claim-policy).
      const shouldClaimStreak = workoutCountsForStreak(data.duration_minutes, source);
      if (shouldClaimStreak) {
        try {
          const { EngagementStreakService } = await import('./engagement-streak-service');
          await EngagementStreakService.recordActivity(
            userId,
            'exercise_log',
            exercise.id,
            exerciseDate
          );
        } catch (streakError) {
          // Non-blocking: streak failure shouldn't fail the exercise log
          console.error('[ExerciseService] Streak recording failed:', streakError);
        }
      }

      // Trigger momentum check-in and circle boost if workout qualifies
      if (countsAsCheckin) {
        try {
          const { MomentumService } = await import('./momentum-service');
          await MomentumService.checkIn(userId);
        } catch (momentumError) {
          console.error('[ExerciseService] Momentum check-in failed:', momentumError);
        }

        try {
          const { BoostService } = await import('./boost-service');
          await BoostService.recalculateAllCirclesForUser(userId);
        } catch (boostError) {
          console.error('[ExerciseService] Boost recalculation failed:', boostError);
        }
      }

      // Post a "workout done" system post to the user's circle chats.
      // Manual entries only — HealthKit/Health Connect imports are historical backfill
      // and must NOT spam the chat (consistent with bulkSyncExercises, which omits this).
      // Fire-and-forget: a chat failure must never affect the exercise log.
      if (source === 'manual') {
        const { ChatActivityHooks } = await import('./chat-activity-hooks');
        ChatActivityHooks.onWorkoutCompleted(userId, exercise.id).catch(() => {});
      }

      // Detect milestones and PRs (workout-level PRs + strength/set-level PRs)
      const milestones = await this.detectMilestones(userId, supabase);
      const personalRecords = await this.detectPRs(userId, exercise, supabase);

      return {
        data: {
          exercise,
          new_milestones: milestones,
          new_personal_records: [...personalRecords, ...strengthPRs],
        },
        error: null,
      };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error('Failed to create exercise'),
      };
    }
  }

  /**
   * Bulk sync exercises from HealthKit
   */
  static async bulkSyncExercises(
    userId: string,
    data: ExerciseBulkSyncInput,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseBulkSyncResponse | null; error: Error | null; streak: AutoClaimResult | null }> {
    try {
      const results: ExerciseSyncResult[] = [];
      let synced = 0;
      let skipped = 0;
      let failed = 0;
      // Newly inserted workouts that qualify for the streak: claimed in date
      // order after the loop so the final streakCount is the current one.
      const claimable: { id: string; day: string }[] = [];

      for (const exercise of data.exercises) {
        try {
          // Skip if no HealthKit ID (required for sync)
          if (!exercise.healthkit_workout_id) {
            results.push({
              healthkit_workout_id: null,
              exercise_type: exercise.exercise_type,
              status: 'failed',
              reason: 'Missing healthkit_workout_id',
            });
            failed++;
            continue;
          }

          // Check if already synced
          const { data: existing } = await supabase
            .from('exercise_logs')
            .select('id')
            .eq('user_id', userId)
            .eq('healthkit_workout_id', exercise.healthkit_workout_id)
            .maybeSingle();

          if (existing) {
            results.push({
              healthkit_workout_id: exercise.healthkit_workout_id,
              exercise_type: exercise.exercise_type,
              status: 'skipped',
              reason: 'Already synced',
            });
            skipped++;
            continue;
          }

          // User-local today, not the server's UTC date, when the client sent no date.
          const exerciseDate = exercise.date || localToday(data.timezone);
          const bodyAreas = DEFAULT_BODY_AREAS[exercise.exercise_type] || ['fullBody'];
          const countsAsCheckin = exercise.duration_minutes >= 10;

          const { data: inserted, error: insertError } = await supabase
            .from('exercise_logs')
            .insert({
              user_id: userId,
              exercise_type: exercise.exercise_type,
              category: exercise.category,
              duration_minutes: exercise.duration_minutes,
              calories_burned: exercise.calories_burned ?? null,
              calories_estimated: false, // HealthKit provides real data
              exercise_date: exerciseDate,
              started_at: exercise.started_at || null,
              source: 'healthkit',
              distance_meters: exercise.distance_meters ?? null,
              avg_heart_rate: exercise.avg_heart_rate ?? null,
              effort_level: exercise.effort_level ?? null,
              location_type: exercise.location_type ?? null,
              workout_companion: exercise.workout_companion ?? null,
              body_areas: bodyAreas,
              is_indoor: exercise.is_indoor ?? null,
              notes: exercise.notes ?? null,
              healthkit_workout_id: exercise.healthkit_workout_id,
              source_device_name: exercise.source_device_name ?? null,
              is_public: true,
              counts_as_checkin: countsAsCheckin,
            })
            .select('id')
            .single();

          if (insertError) {
            // Handle unique constraint violation gracefully
            if (insertError.code === '23505') {
              results.push({
                healthkit_workout_id: exercise.healthkit_workout_id,
                exercise_type: exercise.exercise_type,
                status: 'skipped',
                reason: 'Duplicate',
              });
              skipped++;
            } else {
              results.push({
                healthkit_workout_id: exercise.healthkit_workout_id,
                exercise_type: exercise.exercise_type,
                status: 'failed',
                reason: insertError.message,
              });
              failed++;
            }
          } else {
            results.push({
              healthkit_workout_id: exercise.healthkit_workout_id,
              exercise_type: exercise.exercise_type,
              status: 'created',
            });
            synced++;
            if (workoutCountsForStreak(exercise.duration_minutes, 'healthkit') && inserted?.id) {
              claimable.push({ id: inserted.id, day: exerciseDate });
            }
          }
        } catch (itemError) {
          results.push({
            healthkit_workout_id: exercise.healthkit_workout_id || null,
            exercise_type: exercise.exercise_type,
            status: 'failed',
            reason: itemError instanceof Error ? itemError.message : 'Unknown error',
          });
          failed++;
        }
      }

      // If any synced exercises qualify as check-in, trigger momentum + boost
      if (synced > 0) {
        const hasCheckinExercise = data.exercises.some(e => e.duration_minutes >= 10);
        if (hasCheckinExercise) {
          try {
            const { MomentumService } = await import('./momentum-service');
            await MomentumService.checkIn(userId);
          } catch (momentumError) {
            console.error('[ExerciseService.bulkSync] Momentum check-in failed:', momentumError);
          }

          try {
            const { BoostService } = await import('./boost-service');
            await BoostService.recalculateAllCirclesForUser(userId);
          } catch (boostError) {
            console.error('[ExerciseService.bulkSync] Boost recalculation failed:', boostError);
          }
        }
      }

      // A synced workout of >= 10 min is "showing up": claim each day it
      // covers (bounded by the retro window; already-claimed days are fine).
      // Oldest first so the last result carries the up-to-date streak count.
      let streak: AutoClaimResult | null = null;
      let anyClaimed = false;
      for (const item of claimable.sort((a, b) => a.day.localeCompare(b.day))) {
        const outcome = await StreakClaimingService.autoClaimForManualLog(userId, {
          occurredAt: item.day,
          timezone: data.timezone,
          source: 'exercise_log',
          referenceId: item.id,
        });
        anyClaimed = anyClaimed || outcome.claimed;
        if (outcome.claimed || outcome.alreadyClaimed || !streak) streak = outcome;
      }
      if (streak) streak = { ...streak, claimed: anyClaimed };

      return {
        data: { synced, skipped, failed, results },
        error: null,
        streak,
      };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error('Failed to sync exercises'),
        streak: null,
      };
    }
  }

  /**
   * Get exercise logs with date range filter and pagination
   */
  static async getExercises(
    userId: string,
    options: {
      startDate?: string;
      endDate?: string;
      category?: string;
      page?: number;
      limit?: number;
    },
    supabase: SupabaseClient
  ): Promise<{
    data: ExerciseLog[];
    total: number;
    hasMore: boolean;
    totalMinutes: number;
    totalCalories: number;
    error: Error | null;
  }> {
    try {
      const page = options.page || 1;
      const limit = Math.min(options.limit || 20, 100);
      const offset = (page - 1) * limit;

      let query = supabase
        .from('exercise_logs')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .order('exercise_date', { ascending: false })
        .order('started_at', { ascending: false, nullsFirst: false });

      if (options.startDate) {
        query = query.gte('exercise_date', options.startDate);
      }
      if (options.endDate) {
        query = query.lte('exercise_date', options.endDate);
      }
      if (options.category) {
        query = query.eq('category', options.category);
      }

      const { data, error, count } = await query.range(offset, offset + limit - 1);

      if (error) {
        return { data: [], total: 0, hasMore: false, totalMinutes: 0, totalCalories: 0, error: new Error(error.message) };
      }

      // Calculate aggregate stats for the filtered set
      // Use pagination to avoid Supabase 1000-row default limit
      let allStatsData: { duration_minutes: number; calories_burned: number | null }[] = [];
      let statsOffset = 0;
      const statsPageSize = 1000;
      let hasMoreStats = true;

      while (hasMoreStats) {
        let statsQuery = supabase
          .from('exercise_logs')
          .select('duration_minutes, calories_burned')
          .eq('user_id', userId)
          .eq('is_deleted', false);

        if (options.startDate) statsQuery = statsQuery.gte('exercise_date', options.startDate);
        if (options.endDate) statsQuery = statsQuery.lte('exercise_date', options.endDate);
        if (options.category) statsQuery = statsQuery.eq('category', options.category);

        const { data: statsPage } = await statsQuery.range(statsOffset, statsOffset + statsPageSize - 1);

        if (statsPage && statsPage.length > 0) {
          allStatsData = allStatsData.concat(statsPage);
          statsOffset += statsPageSize;
          hasMoreStats = statsPage.length === statsPageSize;
        } else {
          hasMoreStats = false;
        }
      }

      const totalMinutes = allStatsData.reduce((sum, e) => sum + (e.duration_minutes || 0), 0);
      const totalCalories = allStatsData.reduce((sum, e) => sum + Number(e.calories_burned || 0), 0);

      return {
        data: data || [],
        total: count || 0,
        hasMore: count ? count > offset + limit : false,
        totalMinutes,
        totalCalories,
        error: null,
      };
    } catch (err) {
      return {
        data: [],
        total: 0,
        hasMore: false,
        totalMinutes: 0,
        totalCalories: 0,
        error: err instanceof Error ? err : new Error('Failed to get exercises'),
      };
    }
  }

  /**
   * Get a single exercise log
   */
  static async getExercise(
    exerciseId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseLog | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('id', exerciseId)
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Attach the nested structured exercise log (owner already verified above).
      const exercises = await this.loadWorkoutExercises(exerciseId, supabase);
      (data as ExerciseLog).exercises = exercises;

      return { data, error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to get exercise') };
    }
  }

  /**
   * Load the nested workout_exercises (+ catalog + sets) for a workout, ordered by position.
   */
  private static async loadWorkoutExercises(
    exerciseLogId: string,
    supabase: SupabaseClient
  ): Promise<WorkoutExerciseRead[]> {
    const { data: rows, error } = await supabase
      .from('workout_exercises')
      .select(
        `id, exercise_id, position, notes, rest_seconds,
         exercise:exercises ( id, name, primary_muscle, equipment, tracking_type, is_custom ),
         sets:exercise_sets ( id, set_number, set_type, weight_kg, reps, duration_seconds, distance_meters, rpe, is_completed )`
      )
      .eq('exercise_log_id', exerciseLogId)
      .order('position', { ascending: true });

    if (error || !rows) return [];

    return rows.map((row: Record<string, unknown>): WorkoutExerciseRead => {
      const cat = row.exercise as Record<string, unknown> | null;
      const rawSets = (row.sets as Record<string, unknown>[] | null) || [];
      const sets: ExerciseSetRead[] = rawSets
        .map((s) => ({
          id: s.id as string,
          set_number: s.set_number as number,
          set_type: s.set_type as ExerciseSetRead['set_type'],
          weight_kg: s.weight_kg == null ? null : Number(s.weight_kg),
          reps: s.reps == null ? null : Number(s.reps),
          duration_seconds: s.duration_seconds == null ? null : Number(s.duration_seconds),
          distance_meters: s.distance_meters == null ? null : Number(s.distance_meters),
          rpe: s.rpe == null ? null : Number(s.rpe),
          is_completed: s.is_completed as boolean,
        }))
        .sort((a, b) => a.set_number - b.set_number);

      return {
        id: row.id as string,
        exercise_id: row.exercise_id as string,
        position: row.position as number,
        notes: (row.notes as string | null) ?? null,
        rest_seconds: (row.rest_seconds as number | null) ?? null,
        exercise: cat
          ? {
              id: cat.id as string,
              name: cat.name as string,
              primary_muscle: (cat.primary_muscle as string | null) ?? null,
              equipment: (cat.equipment as string | null) ?? null,
              tracking_type: cat.tracking_type as ExerciseTrackingType,
              is_custom: cat.is_custom as boolean,
            }
          : null,
        sets,
      };
    });
  }

  /**
   * Update an exercise log (add notes, effort, location, and/or a structured exercise log).
   *
   * When `data.exercises` is provided it is treated as the FULL desired state of the log
   * (replace semantics): existing workout_exercises/sets are cleared and re-created, and the
   * exercise_logs rollups are recomputed. Strength PRs are re-run afterward.
   *
   * HealthKit protection: when the workout `source === 'healthkit'`, HealthKit-owned scalar
   * fields (type/duration/calories/distance/heart-rate/started_at) are never overwritten —
   * only the enrichment layer (notes, effort, location, companion, is_indoor, exercises) applies.
   */
  static async updateExercise(
    exerciseId: string,
    userId: string,
    data: Partial<ExerciseLogCreateInput>,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseLog | null; error: Error | null; newPersonalRecords?: DetectedPR[] }> {
    try {
      // Verify ownership + fetch source for HealthKit protection
      const { data: existing } = await supabase
        .from('exercise_logs')
        .select('user_id, source')
        .eq('id', exerciseId)
        .eq('is_deleted', false)
        .single();

      if (!existing || existing.user_id !== userId) {
        return { data: null, error: new Error('Not authorized') };
      }

      const isHealthKit = existing.source === 'healthkit';

      // Build update object with only provided fields.
      const updateData: Record<string, unknown> = {};
      // Enrichment fields — always editable, even for HealthKit workouts.
      if (data.effort_level !== undefined) updateData.effort_level = data.effort_level;
      if (data.location_type !== undefined) updateData.location_type = data.location_type;
      if (data.workout_companion !== undefined) updateData.workout_companion = data.workout_companion;
      if (data.is_indoor !== undefined) updateData.is_indoor = data.is_indoor;
      if (data.notes !== undefined) updateData.notes = data.notes;

      // HealthKit-owned fields — only editable for manual entries.
      if (!isHealthKit) {
        if (data.exercise_type !== undefined) updateData.exercise_type = data.exercise_type;
        if (data.category !== undefined) updateData.category = data.category;
        if (data.duration_minutes !== undefined) updateData.duration_minutes = data.duration_minutes;
        if (data.calories_burned !== undefined) updateData.calories_burned = data.calories_burned;
        if (data.distance_meters !== undefined) updateData.distance_meters = data.distance_meters;
        if (data.avg_heart_rate !== undefined) updateData.avg_heart_rate = data.avg_heart_rate;
        if (data.started_at !== undefined) updateData.started_at = data.started_at;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updErr } = await supabase
          .from('exercise_logs')
          .update(updateData)
          .eq('id', exerciseId);
        if (updErr) {
          return { data: null, error: new Error(updErr.message) };
        }
      }

      // Replace-semantics nested exercise log write (if provided).
      let newPersonalRecords: DetectedPR[] = [];
      if (data.exercises !== undefined) {
        const { error: persistError } = await this.persistExerciseLog(
          exerciseId,
          userId,
          data.exercises,
          supabase,
          { replace: true }
        );
        if (persistError) {
          return { data: null, error: persistError };
        }
        newPersonalRecords = await this.detectStrengthPRs(userId, exerciseId, supabase);
      }

      const { data: updated, error } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('id', exerciseId)
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Attach the (possibly newly-written) nested exercise log to the response.
      (updated as ExerciseLog).exercises = await this.loadWorkoutExercises(exerciseId, supabase);

      return { data: updated, error: null, newPersonalRecords };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to update exercise') };
    }
  }

  // ============================================================
  // Structured exercise log — persistence, rollups, catalog, PRs
  // ============================================================

  /**
   * Persist a workout's structured exercise log: resolves/creates catalog entries, writes
   * workout_exercises + exercise_sets, then recomputes the exercise_logs rollups.
   *
   * NOTE: the repo forbids stored procedures/RPCs (see CLAUDE.md), so a true single DB
   * transaction is not available. We approximate the spec's "single transaction" with ordered
   * service-role writes: on `replace`, the old rows are deleted first (cascade removes sets),
   * and any insert failure aborts and returns an error so the caller can react. The parent
   * workout row is never mutated here beyond the rollups.
   */
  private static async persistExerciseLog(
    exerciseLogId: string,
    userId: string,
    exercises: WorkoutExerciseInput[],
    supabase: SupabaseClient,
    options: { replace: boolean }
  ): Promise<{ error: Error | null }> {
    try {
      // Replace semantics: clear existing workout_exercises (sets cascade-delete).
      if (options.replace) {
        const { error: delError } = await supabase
          .from('workout_exercises')
          .delete()
          .eq('exercise_log_id', exerciseLogId);
        if (delError) return { error: new Error(delError.message) };
      }

      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];

        // Resolve the catalog exercise id (create-on-save for custom_name).
        const resolvedId = await this.resolveCatalogExerciseId(userId, ex, supabase);
        if (!resolvedId) {
          return { error: new Error('Could not resolve exercise (missing exerciseId/customName)') };
        }

        const { data: we, error: weError } = await supabase
          .from('workout_exercises')
          .insert({
            exercise_log_id: exerciseLogId,
            exercise_id: resolvedId,
            position: ex.position ?? i,
            notes: ex.notes ?? null,
            rest_seconds: ex.rest_seconds ?? null,
          })
          .select('id')
          .single();

        if (weError || !we) {
          return { error: new Error(weError?.message || 'Failed to insert workout exercise') };
        }

        if (ex.sets && ex.sets.length > 0) {
          const setRows = ex.sets.map((s, idx) => ({
            workout_exercise_id: we.id,
            set_number: s.set_number ?? idx + 1,
            set_type: s.set_type ?? 'normal',
            reps: s.reps ?? null,
            weight_kg: s.weight_kg ?? null,
            duration_seconds: s.duration_seconds ?? null,
            distance_meters: s.distance_meters ?? null,
            rpe: s.rpe ?? null,
            is_completed: s.is_completed ?? true,
          }));

          const { error: setError } = await supabase.from('exercise_sets').insert(setRows);
          if (setError) {
            return { error: new Error(setError.message) };
          }
        }
      }

      await this.recomputeRollups(exerciseLogId, supabase);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Failed to persist exercise log') };
    }
  }

  /**
   * Resolve a WorkoutExerciseInput to a catalog exercise id.
   * - exercise_id present → use it, but ONLY after verifying it is visible to this user
   *   (global/public OR owned by the user) and not soft-deleted. Because writes run under the
   *   service-role client (RLS bypassed), this TS gate is the only thing preventing a caller
   *   from attaching another user's private custom exercise — or an arbitrary UUID — to their
   *   own workout (which would then leak that private exercise's name/muscle/equipment back
   *   via loadWorkoutExercises). A non-visible/nonexistent id throws a validation-style error
   *   (surfaced as a 400 by the route), consistent with other persist failures.
   * - custom_name present → find-or-create a private custom exercise for this user.
   */
  private static async resolveCatalogExerciseId(
    userId: string,
    ex: WorkoutExerciseInput,
    supabase: SupabaseClient
  ): Promise<string | null> {
    if (ex.exercise_id) {
      const { data: cat } = await supabase
        .from('exercises')
        .select('id, is_public, created_by, is_deleted')
        .eq('id', ex.exercise_id)
        .maybeSingle();

      const visible =
        cat && cat.is_deleted !== true && (cat.is_public === true || cat.created_by === userId);
      if (!visible) {
        throw new Error('Exercise not found or not accessible');
      }
      return cat.id as string;
    }
    if (ex.custom_name && ex.custom_name.trim().length > 0) {
      const created = await this.findOrCreateCustomExercise(
        userId,
        {
          name: ex.custom_name.trim(),
          primary_muscle: ex.primary_muscle ?? null,
          equipment: ex.equipment ?? null,
          tracking_type: ex.tracking_type ?? 'weight_reps',
        },
        supabase
      );
      return created?.id ?? null;
    }
    return null;
  }

  /**
   * Recompute and persist the denormalized rollups on exercise_logs.
   * total_volume_kg = Σ(reps × weight_kg) over COMPLETED, NON-warmup sets.
   */
  private static async recomputeRollups(
    exerciseLogId: string,
    supabase: SupabaseClient
  ): Promise<void> {
    const { data: weRows } = await supabase
      .from('workout_exercises')
      .select('id')
      .eq('exercise_log_id', exerciseLogId);

    const exerciseCount = weRows?.length || 0;
    let totalSets = 0;
    let totalVolume = 0;

    if (exerciseCount > 0) {
      const weIds = weRows!.map((r) => r.id);
      const { data: sets } = await supabase
        .from('exercise_sets')
        .select('reps, weight_kg, set_type, is_completed, workout_exercise_id')
        .in('workout_exercise_id', weIds);

      for (const s of sets || []) {
        totalSets++;
        const isWorking = s.set_type !== 'warmup' && s.is_completed !== false;
        if (isWorking && s.reps != null && s.weight_kg != null) {
          totalVolume += Number(s.reps) * Number(s.weight_kg);
        }
      }
    }

    await supabase
      .from('exercise_logs')
      .update({
        exercise_count: exerciseCount,
        total_sets: totalSets,
        total_volume_kg: Math.round(totalVolume * 100) / 100,
        has_exercise_log: exerciseCount > 0,
      })
      .eq('id', exerciseLogId);
  }

  /**
   * Search the exercise catalog (global library + the user's custom exercises).
   */
  static async searchCatalog(
    userId: string,
    options: { search?: string; muscle?: string; equipment?: string; limit?: number },
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseCatalogSummary[]; error: Error | null }> {
    try {
      const limit = Math.min(options.limit || 50, 200);

      let query = supabase
        .from('exercises')
        .select('id, name, primary_muscle, equipment, tracking_type, is_custom')
        .eq('is_deleted', false)
        .or(`is_public.eq.true,created_by.eq.${userId}`);

      if (options.search && options.search.trim().length > 0) {
        query = query.ilike('name', `%${options.search.trim()}%`);
      }
      if (options.muscle) {
        query = query.eq('primary_muscle', options.muscle);
      }
      if (options.equipment) {
        query = query.eq('equipment', options.equipment);
      }

      const { data, error } = await query.order('name', { ascending: true }).limit(limit);

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      return { data: (data as ExerciseCatalogSummary[]) || [], error: null };
    } catch (err) {
      return { data: [], error: err instanceof Error ? err : new Error('Failed to search catalog') };
    }
  }

  /**
   * Create (or return an existing) custom exercise owned by the user.
   */
  static async createCustomExercise(
    userId: string,
    input: CustomExerciseInput,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseCatalogSummary | null; error: Error | null }> {
    try {
      const row = await this.findOrCreateCustomExercise(
        userId,
        {
          name: input.name.trim(),
          primary_muscle: input.primary_muscle ?? null,
          equipment: input.equipment ?? null,
          tracking_type: input.tracking_type ?? 'weight_reps',
        },
        supabase
      );
      if (!row) {
        return { data: null, error: new Error('Failed to create custom exercise') };
      }
      return {
        data: {
          id: row.id,
          name: row.name,
          primary_muscle: row.primary_muscle,
          equipment: row.equipment,
          tracking_type: row.tracking_type,
          is_custom: true,
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to create custom exercise') };
    }
  }

  private static async findOrCreateCustomExercise(
    userId: string,
    input: { name: string; primary_muscle: string | null; equipment: string | null; tracking_type: ExerciseTrackingType },
    supabase: SupabaseClient
  ): Promise<{
    id: string;
    name: string;
    primary_muscle: string | null;
    equipment: string | null;
    tracking_type: ExerciseTrackingType;
  } | null> {
    const slug = this.slugify(input.name);

    // Dedup: reuse an existing custom exercise with the same slug for this user.
    const { data: existing } = await supabase
      .from('exercises')
      .select('id, name, primary_muscle, equipment, tracking_type')
      .eq('created_by', userId)
      .eq('is_custom', true)
      .eq('is_deleted', false)
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      return existing as {
        id: string;
        name: string;
        primary_muscle: string | null;
        equipment: string | null;
        tracking_type: ExerciseTrackingType;
      };
    }

    const { data: created, error } = await supabase
      .from('exercises')
      .insert({
        name: input.name,
        slug,
        primary_muscle: input.primary_muscle,
        equipment: input.equipment,
        tracking_type: input.tracking_type,
        is_custom: true,
        is_public: false,
        created_by: userId,
      })
      .select('id, name, primary_muscle, equipment, tracking_type')
      .single();

    if (error || !created) return null;
    return created as {
      id: string;
      name: string;
      primary_muscle: string | null;
      equipment: string | null;
      tracking_type: ExerciseTrackingType;
    };
  }

  private static slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Per-exercise history for the "Previous" column + insights (last session's sets, best set,
   * e1RM series, volume series). Only the requesting user's own logs are considered.
   */
  static async getExerciseHistory(
    userId: string,
    exerciseId: string,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseHistoryResponse | null; error: Error | null }> {
    try {
      // Verify the exercise is visible to this user (global or their own custom).
      const { data: cat } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, equipment, tracking_type, is_custom, is_public, created_by')
        .eq('id', exerciseId)
        .maybeSingle();

      if (!cat || (!cat.is_public && cat.created_by !== userId)) {
        return { data: null, error: new Error('Exercise not found') };
      }

      // All of the user's performances of this movement, with the parent log's date.
      const { data: rows, error } = await supabase
        .from('workout_exercises')
        .select(
          `id, exercise_log_id,
           log:exercise_logs!inner ( exercise_date, user_id, is_deleted ),
           sets:exercise_sets ( id, set_number, set_type, weight_kg, reps, duration_seconds, distance_meters, rpe, is_completed )`
        )
        .eq('exercise_id', exerciseId)
        .eq('log.user_id', userId)
        .eq('log.is_deleted', false);

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      const catalog: ExerciseCatalogSummary = {
        id: cat.id,
        name: cat.name,
        primary_muscle: cat.primary_muscle,
        equipment: cat.equipment,
        tracking_type: cat.tracking_type,
        is_custom: cat.is_custom,
      };

      const sessions: ExerciseHistorySession[] = (rows || []).map((row: Record<string, unknown>) => {
        const log = row.log as Record<string, unknown>;
        const rawSets = (row.sets as Record<string, unknown>[] | null) || [];
        const sets: ExerciseSetRead[] = rawSets
          .map((s) => ({
            id: s.id as string,
            set_number: s.set_number as number,
            set_type: s.set_type as ExerciseSetRead['set_type'],
            weight_kg: s.weight_kg == null ? null : Number(s.weight_kg),
            reps: s.reps == null ? null : Number(s.reps),
            duration_seconds: s.duration_seconds == null ? null : Number(s.duration_seconds),
            distance_meters: s.distance_meters == null ? null : Number(s.distance_meters),
            rpe: s.rpe == null ? null : Number(s.rpe),
            is_completed: s.is_completed as boolean,
          }))
          .sort((a, b) => a.set_number - b.set_number);

        const working = sets.filter(
          (s) => s.set_type !== 'warmup' && s.is_completed !== false
        );
        let volume = 0;
        let bestSet: ExerciseSetRead | null = null;
        let bestSetWeight = -1;
        let bestE1rm: number | null = null;
        for (const s of working) {
          if (s.reps != null && s.weight_kg != null) {
            volume += s.reps * s.weight_kg;
            if (s.weight_kg > bestSetWeight) {
              bestSetWeight = s.weight_kg;
              bestSet = s;
            }
            const e1rm = s.weight_kg * (1 + s.reps / 30); // Epley
            if (bestE1rm == null || e1rm > bestE1rm) bestE1rm = e1rm;
          }
        }

        return {
          exercise_log_id: row.exercise_log_id as string,
          workout_exercise_id: row.id as string,
          exercise_date: log.exercise_date as string,
          sets,
          volume_kg: Math.round(volume * 100) / 100,
          best_set: bestSet,
          best_e1rm_kg: bestE1rm == null ? null : Math.round(bestE1rm * 100) / 100,
        };
      });

      // Sort sessions by date ascending for the series; last_session = most recent.
      sessions.sort((a, b) => a.exercise_date.localeCompare(b.exercise_date));
      const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

      // Best set + best e1RM across all sessions.
      let overallBestSet: ExerciseSetRead | null = null;
      let overallBestWeight = -1;
      let overallBestE1rm: number | null = null;
      for (const s of sessions) {
        if (s.best_set && s.best_set.weight_kg != null && s.best_set.weight_kg > overallBestWeight) {
          overallBestWeight = s.best_set.weight_kg;
          overallBestSet = s.best_set;
        }
        if (s.best_e1rm_kg != null && (overallBestE1rm == null || s.best_e1rm_kg > overallBestE1rm)) {
          overallBestE1rm = s.best_e1rm_kg;
        }
      }

      const e1rmSeries = sessions
        .filter((s) => s.best_e1rm_kg != null)
        .map((s) => ({ date: s.exercise_date, e1rm_kg: s.best_e1rm_kg as number }));
      const volumeSeries = sessions.map((s) => ({ date: s.exercise_date, volume_kg: s.volume_kg }));

      return {
        data: {
          exercise: catalog,
          last_session: lastSession,
          best_set: overallBestSet,
          best_e1rm_kg: overallBestE1rm,
          e1rm_series: e1rmSeries,
          volume_series: volumeSeries,
          session_count: sessions.length,
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to get exercise history') };
    }
  }

  /**
   * Detect strength PRs (heaviest weight, best estimated 1RM) produced by the sets just saved
   * to a workout, compared against the user's prior history for each movement.
   * Reuses the DetectedPR / newPersonalRecords surface. Warmups are excluded.
   */
  private static async detectStrengthPRs(
    userId: string,
    exerciseLogId: string,
    supabase: SupabaseClient
  ): Promise<DetectedPR[]> {
    const prs: DetectedPR[] = [];
    try {
      // This workout's exercises + their sets + catalog name.
      const { data: weRows } = await supabase
        .from('workout_exercises')
        .select(
          `id, exercise_id,
           exercise:exercises ( name ),
           sets:exercise_sets ( set_type, weight_kg, reps, is_completed )`
        )
        .eq('exercise_log_id', exerciseLogId);

      for (const we of (weRows || []) as unknown as Record<string, unknown>[]) {
        // PostgREST may type a to-one embed as an array; normalize to a single object.
        const catRel = we.exercise as Record<string, unknown> | Record<string, unknown>[] | null;
        const cat = Array.isArray(catRel) ? catRel[0] : catRel;
        const catName = (cat?.name as string) || 'Exercise';
        const rawSets = (we.sets as Record<string, unknown>[] | null) || [];

        // Current best for this movement in THIS workout.
        let curWeight = -1;
        let curE1rm = -1;
        for (const s of rawSets) {
          if (s.set_type === 'warmup' || s.is_completed === false) continue;
          const w = s.weight_kg == null ? null : Number(s.weight_kg);
          const r = s.reps == null ? null : Number(s.reps);
          if (w != null && w > curWeight) curWeight = w;
          if (w != null && r != null) {
            const e1rm = w * (1 + r / 30);
            if (e1rm > curE1rm) curE1rm = e1rm;
          }
        }
        if (curWeight <= 0 && curE1rm <= 0) continue;

        // Prior history for this movement (all the user's OTHER logs).
        const { data: priorWe } = await supabase
          .from('workout_exercises')
          .select(
            `id, exercise_log_id,
             log:exercise_logs!inner ( user_id, is_deleted ),
             sets:exercise_sets ( set_type, weight_kg, reps, is_completed )`
          )
          .eq('exercise_id', we.exercise_id as string)
          .eq('log.user_id', userId)
          .eq('log.is_deleted', false)
          .neq('exercise_log_id', exerciseLogId);

        let prevWeight = -1;
        let prevE1rm = -1;
        for (const pw of priorWe || []) {
          const psets = (pw.sets as Record<string, unknown>[] | null) || [];
          for (const s of psets) {
            if (s.set_type === 'warmup' || s.is_completed === false) continue;
            const w = s.weight_kg == null ? null : Number(s.weight_kg);
            const r = s.reps == null ? null : Number(s.reps);
            if (w != null && w > prevWeight) prevWeight = w;
            if (w != null && r != null) {
              const e1rm = w * (1 + r / 30);
              if (e1rm > prevE1rm) prevE1rm = e1rm;
            }
          }
        }

        // Only celebrate when there IS prior history and we beat it (mirrors existing PR behavior).
        if (prevWeight >= 0 && curWeight > prevWeight) {
          prs.push({
            type: 'heaviest_weight',
            exercise_type: catName,
            value: Math.round(curWeight * 100) / 100,
            previous_value: Math.round(prevWeight * 100) / 100,
            unit: 'kg',
          });
        }
        if (prevE1rm >= 0 && curE1rm > prevE1rm) {
          prs.push({
            type: 'best_e1rm',
            exercise_type: catName,
            value: Math.round(curE1rm * 100) / 100,
            previous_value: Math.round(prevE1rm * 100) / 100,
            unit: 'kg',
          });
        }
      }
    } catch (err) {
      console.error('[ExerciseService] Strength PR detection failed:', err);
    }
    return prs;
  }

  /**
   * Soft-delete an exercise log
   */
  static async deleteExercise(
    exerciseId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error: Error | null }> {
    try {
      // Verify ownership
      const { data: existing } = await supabase
        .from('exercise_logs')
        .select('user_id')
        .eq('id', exerciseId)
        .eq('is_deleted', false)
        .single();

      if (!existing || existing.user_id !== userId) {
        return { success: false, error: new Error('Not authorized') };
      }

      const { error } = await supabase
        .from('exercise_logs')
        .update({ is_deleted: true })
        .eq('id', exerciseId);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err : new Error('Failed to delete exercise') };
    }
  }

  /**
   * Get exercise statistics for a period
   */
  static async getStats(
    userId: string,
    period: 'day' | 'week' | 'month',
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseStatsResponse | null; error: Error | null }> {
    try {
      const now = new Date();
      let startDate: string;

      if (period === 'day') {
        startDate = now.toISOString().split('T')[0];
      } else if (period === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
      } else {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        startDate = monthAgo.toISOString().split('T')[0];
      }

      const endDate = now.toISOString().split('T')[0];

      // Paginate to avoid Supabase 1000-row default limit
      let logs: ExerciseLog[] = [];
      let fetchOffset = 0;
      const fetchPageSize = 1000;
      let hasMoreData = true;

      while (hasMoreData) {
        const { data: page, error } = await supabase
          .from('exercise_logs')
          .select('*')
          .eq('user_id', userId)
          .eq('is_deleted', false)
          .gte('exercise_date', startDate)
          .lte('exercise_date', endDate)
          .range(fetchOffset, fetchOffset + fetchPageSize - 1);

        if (error) {
          return { data: null, error: new Error(error.message) };
        }

        if (page && page.length > 0) {
          logs = logs.concat(page);
          fetchOffset += fetchPageSize;
          hasMoreData = page.length === fetchPageSize;
        } else {
          hasMoreData = false;
        }
      }

      // Totals
      const totalWorkouts = logs.length;
      const totalMinutes = logs.reduce((sum, e) => sum + e.duration_minutes, 0);
      const totalCalories = logs.reduce((sum, e) => sum + Number(e.calories_burned || 0), 0);
      const averageDuration = totalWorkouts > 0 ? Math.round(totalMinutes / totalWorkouts) : 0;

      // Average effort (only for entries with effort)
      const effortEntries = logs.filter((e) => e.effort_level != null);
      const averageEffort =
        effortEntries.length > 0
          ? Math.round((effortEntries.reduce((sum, e) => sum + e.effort_level!, 0) / effortEntries.length) * 10) / 10
          : null;

      // Category breakdown
      const categoryBreakdown: Record<string, number> = {};
      for (const e of logs) {
        categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + 1;
      }
      const topCategory = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // Body area frequency
      const bodyAreaFrequency: Record<string, number> = {};
      for (const e of logs) {
        if (e.body_areas) {
          for (const area of e.body_areas) {
            bodyAreaFrequency[area] = (bodyAreaFrequency[area] || 0) + 1;
          }
        }
      }

      // Location breakdown
      const locationBreakdown: Record<string, number> = {};
      for (const e of logs) {
        if (e.location_type) {
          locationBreakdown[e.location_type] = (locationBreakdown[e.location_type] || 0) + 1;
        }
      }

      // Streak days (consecutive days with exercise ending today or yesterday)
      const uniqueDatesSet = new Set(logs.map((e) => e.exercise_date));
      let streakDays = 0;
      const today = new Date(endDate);

      // Start from today; if today has no exercise, start from yesterday
      let startOffset = 0;
      const todayStr = today.toISOString().split('T')[0];
      if (!uniqueDatesSet.has(todayStr)) {
        // Check yesterday - if no exercise yesterday either, streak is 0
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        if (!uniqueDatesSet.has(yesterdayStr)) {
          streakDays = 0;
        } else {
          startOffset = 1; // Start counting from yesterday
        }
      }

      if (startOffset === 0 && uniqueDatesSet.has(todayStr) || startOffset === 1) {
        for (let i = startOffset; ; i++) {
          const checkDate = new Date(today);
          checkDate.setDate(checkDate.getDate() - i);
          const checkStr = checkDate.toISOString().split('T')[0];
          if (uniqueDatesSet.has(checkStr)) {
            streakDays++;
          } else {
            break;
          }
        }
      }

      return {
        data: {
          period,
          total_workouts: totalWorkouts,
          total_minutes: totalMinutes,
          total_calories: Math.round(totalCalories),
          average_duration: averageDuration,
          average_effort: averageEffort,
          top_category: topCategory,
          category_breakdown: categoryBreakdown,
          body_area_frequency: bodyAreaFrequency,
          location_breakdown: locationBreakdown,
          streak_days: streakDays,
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to get stats') };
    }
  }

  /**
   * Get recently used exercise types for Quick Log
   */
  static async getRecentTypes(
    userId: string,
    supabase: SupabaseClient,
    limit: number = 3
  ): Promise<{ data: RecentExerciseType[]; error: Error | null }> {
    try {
      // Get most recent manual exercises (limit to recent history for performance)
      const { data: exercises, error } = await supabase
        .from('exercise_logs')
        .select('exercise_type, category, duration_minutes, calories_burned, exercise_date')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .eq('source', 'manual')
        .order('exercise_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      // Group by type, keep most recent, count occurrences
      const typeMap = new Map<string, RecentExerciseType>();
      for (const e of exercises || []) {
        if (!typeMap.has(e.exercise_type)) {
          typeMap.set(e.exercise_type, {
            exercise_type: e.exercise_type,
            category: e.category,
            last_duration: e.duration_minutes,
            last_calories: e.calories_burned ? Number(e.calories_burned) : null,
            count: 1,
            last_used: e.exercise_date,
          });
        } else {
          typeMap.get(e.exercise_type)!.count++;
        }
      }

      // Sort by last_used descending, take top N
      const recent = Array.from(typeMap.values())
        .sort((a, b) => b.last_used.localeCompare(a.last_used))
        .slice(0, limit);

      return { data: recent, error: null };
    } catch (err) {
      return { data: [], error: err instanceof Error ? err : new Error('Failed to get recent types') };
    }
  }

  /**
   * Get calorie balance for a date (exercise + food)
   */
  static async getCalorieBalance(
    userId: string,
    date: string,
    supabase: SupabaseClient
  ): Promise<{ data: CalorieBalanceResponse | null; error: Error | null }> {
    try {
      // Exercise calories burned
      const { data: exercises, error: exError } = await supabase
        .from('exercise_logs')
        .select('calories_burned')
        .eq('user_id', userId)
        .eq('exercise_date', date)
        .eq('is_deleted', false);

      if (exError) {
        return { data: null, error: new Error(exError.message) };
      }

      const caloriesBurned = (exercises || []).reduce(
        (sum, e) => sum + Number(e.calories_burned || 0),
        0
      );
      const exerciseCount = (exercises || []).length;

      // Food calories consumed (from food_log_entries)
      const { data: foodLogs, error: foodError } = await supabase
        .from('food_log_entries')
        .select('nutrition_data')
        .eq('user_id', userId)
        .eq('entry_date', date)
        .is('deleted_at', null);

      if (foodError) {
        return { data: null, error: new Error(foodError.message) };
      }

      let caloriesConsumed = 0;
      const foodLogCount = (foodLogs || []).length;
      for (const log of foodLogs || []) {
        if (log.nutrition_data && typeof log.nutrition_data === 'object') {
          caloriesConsumed += Number((log.nutrition_data as Record<string, unknown>).calories || 0);
        }
      }

      return {
        data: {
          date,
          calories_consumed: Math.round(caloriesConsumed),
          calories_burned: Math.round(caloriesBurned),
          net_calories: Math.round(caloriesConsumed - caloriesBurned),
          exercise_count: exerciseCount,
          food_log_count: foodLogCount,
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to get calorie balance') };
    }
  }

  /**
   * Estimate calories from MET values
   * Formula: MET × weight_kg × duration_hours
   */
  static estimateCalories(
    exerciseType: string,
    durationMinutes: number,
    weightKg: number
  ): number {
    const met = MET_VALUES[exerciseType] || 4.0;
    return Math.round(met * weightKg * (durationMinutes / 60));
  }

  /**
   * Detect new milestones after exercise creation
   */
  private static async detectMilestones(
    userId: string,
    supabase: SupabaseClient
  ): Promise<DetectedMilestone[]> {
    const milestones: DetectedMilestone[] = [];

    try {
      const { count } = await supabase
        .from('exercise_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_deleted', false);

      const total = count || 0;

      if (total === 1) {
        milestones.push({
          type: 'first_workout',
          title: 'First Workout!',
          description: 'You logged your first workout. Keep it up!',
        });
      } else if (total === 100) {
        milestones.push({
          type: 'century_club',
          title: '100 Workouts!',
          description: 'You\'ve logged 100 workouts. Incredible dedication!',
        });
      }

      // Check total minutes (paginate to avoid 1000-row limit)
      let allMinutesData: { duration_minutes: number }[] = [];
      let mOffset = 0;
      let mHasMore = true;
      while (mHasMore) {
        const { data: mPage } = await supabase
          .from('exercise_logs')
          .select('duration_minutes')
          .eq('user_id', userId)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .range(mOffset, mOffset + 999);

        if (mPage && mPage.length > 0) {
          allMinutesData = allMinutesData.concat(mPage);
          mOffset += 1000;
          mHasMore = mPage.length === 1000;
        } else {
          mHasMore = false;
        }
      }

      const totalMinutes = allMinutesData.reduce((sum, e) => sum + e.duration_minutes, 0);

      // The first entry is the most recently created; check if this one pushed us over 1000
      if (totalMinutes >= 1000 && totalMinutes - (allMinutesData[0]?.duration_minutes || 0) < 1000) {
        milestones.push({
          type: 'marathon_minutes',
          title: '1,000 Minutes!',
          description: 'You\'ve logged 1,000 minutes of exercise!',
        });
      }

      // Check this week's workouts
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { count: weekCount } = await supabase
        .from('exercise_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .gte('exercise_date', weekAgo.toISOString().split('T')[0]);

      if (weekCount === 5) {
        milestones.push({
          type: 'week_warrior',
          title: '5 Workouts This Week!',
          description: 'You\'ve hit 5 workouts this week. Week warrior!',
        });
      }

      // Check category variety
      const { data: categories } = await supabase
        .from('exercise_logs')
        .select('category')
        .eq('user_id', userId)
        .eq('is_deleted', false);

      const uniqueCategories = new Set((categories || []).map((e) => e.category));
      if (uniqueCategories.size >= 5 && categories && categories.length >= 5) {
        milestones.push({
          type: 'variety_pack',
          title: 'Well-Rounded!',
          description: 'You\'ve logged workouts in 5 different categories!',
        });
      }
    } catch (err) {
      console.error('[ExerciseService] Milestone detection failed:', err);
    }

    return milestones;
  }

  /**
   * Detect personal records on new exercise log
   */
  private static async detectPRs(
    userId: string,
    exerciseLog: ExerciseLog,
    supabase: SupabaseClient
  ): Promise<DetectedPR[]> {
    const prs: DetectedPR[] = [];

    try {
      // Get previous max duration for this exercise type
      const { data: prevDuration } = await supabase
        .from('exercise_logs')
        .select('duration_minutes')
        .eq('user_id', userId)
        .eq('exercise_type', exerciseLog.exercise_type)
        .eq('is_deleted', false)
        .neq('id', exerciseLog.id)
        .order('duration_minutes', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevDuration && exerciseLog.duration_minutes > prevDuration.duration_minutes) {
        prs.push({
          type: 'longest_duration',
          exercise_type: exerciseLog.exercise_type,
          value: exerciseLog.duration_minutes,
          previous_value: prevDuration.duration_minutes,
          unit: 'min',
        });
      }

      // Check distance PR (for distance-relevant types)
      if (exerciseLog.distance_meters && exerciseLog.distance_meters > 0) {
        const { data: prevDistance } = await supabase
          .from('exercise_logs')
          .select('distance_meters')
          .eq('user_id', userId)
          .eq('exercise_type', exerciseLog.exercise_type)
          .eq('is_deleted', false)
          .neq('id', exerciseLog.id)
          .not('distance_meters', 'is', null)
          .order('distance_meters', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevDistance && Number(exerciseLog.distance_meters) > Number(prevDistance.distance_meters)) {
          prs.push({
            type: 'longest_distance',
            exercise_type: exerciseLog.exercise_type,
            value: Number(exerciseLog.distance_meters),
            previous_value: Number(prevDistance.distance_meters),
            unit: 'm',
          });
        }
      }

      // Check calories PR
      if (exerciseLog.calories_burned && Number(exerciseLog.calories_burned) > 0 && !exerciseLog.calories_estimated) {
        const { data: prevCalories } = await supabase
          .from('exercise_logs')
          .select('calories_burned')
          .eq('user_id', userId)
          .eq('exercise_type', exerciseLog.exercise_type)
          .eq('is_deleted', false)
          .eq('calories_estimated', false)
          .neq('id', exerciseLog.id)
          .not('calories_burned', 'is', null)
          .order('calories_burned', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevCalories && Number(exerciseLog.calories_burned) > Number(prevCalories.calories_burned)) {
          prs.push({
            type: 'highest_calories',
            exercise_type: exerciseLog.exercise_type,
            value: Number(exerciseLog.calories_burned),
            previous_value: Number(prevCalories.calories_burned),
            unit: 'kcal',
          });
        }
      }
    } catch (err) {
      console.error('[ExerciseService] PR detection failed:', err);
    }

    return prs;
  }
}
