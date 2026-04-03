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

import { SupabaseClient } from '@supabase/supabase-js';
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
      const exerciseDate = data.date || new Date().toISOString().split('T')[0];
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

      // Streak claiming: manual entries claim streaks, HealthKit does not
      const shouldClaimStreak = source === 'manual' && data.auto_claim_streak !== false;
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

      // Detect milestones and PRs
      const milestones = await this.detectMilestones(userId, supabase);
      const personalRecords = await this.detectPRs(userId, exercise, supabase);

      return {
        data: {
          exercise,
          new_milestones: milestones,
          new_personal_records: personalRecords,
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
  ): Promise<{ data: ExerciseBulkSyncResponse | null; error: Error | null }> {
    try {
      const results: ExerciseSyncResult[] = [];
      let synced = 0;
      let skipped = 0;
      let failed = 0;

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

          const exerciseDate = exercise.date || new Date().toISOString().split('T')[0];
          const bodyAreas = DEFAULT_BODY_AREAS[exercise.exercise_type] || ['fullBody'];
          const countsAsCheckin = exercise.duration_minutes >= 10;

          const { error: insertError } = await supabase
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
            });

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

      return {
        data: { synced, skipped, failed, results },
        error: null,
      };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error('Failed to sync exercises'),
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

      return { data, error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to get exercise') };
    }
  }

  /**
   * Update an exercise log (add notes, effort, location, etc.)
   */
  static async updateExercise(
    exerciseId: string,
    userId: string,
    data: Partial<ExerciseLogCreateInput>,
    supabase: SupabaseClient
  ): Promise<{ data: ExerciseLog | null; error: Error | null }> {
    try {
      // Verify ownership
      const { data: existing } = await supabase
        .from('exercise_logs')
        .select('user_id')
        .eq('id', exerciseId)
        .eq('is_deleted', false)
        .single();

      if (!existing || existing.user_id !== userId) {
        return { data: null, error: new Error('Not authorized') };
      }

      // Build update object with only provided fields
      const updateData: Record<string, unknown> = {};
      if (data.exercise_type !== undefined) updateData.exercise_type = data.exercise_type;
      if (data.category !== undefined) updateData.category = data.category;
      if (data.duration_minutes !== undefined) updateData.duration_minutes = data.duration_minutes;
      if (data.calories_burned !== undefined) updateData.calories_burned = data.calories_burned;
      if (data.distance_meters !== undefined) updateData.distance_meters = data.distance_meters;
      if (data.avg_heart_rate !== undefined) updateData.avg_heart_rate = data.avg_heart_rate;
      if (data.effort_level !== undefined) updateData.effort_level = data.effort_level;
      if (data.location_type !== undefined) updateData.location_type = data.location_type;
      if (data.workout_companion !== undefined) updateData.workout_companion = data.workout_companion;
      if (data.is_indoor !== undefined) updateData.is_indoor = data.is_indoor;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.started_at !== undefined) updateData.started_at = data.started_at;

      const { data: updated, error } = await supabase
        .from('exercise_logs')
        .update(updateData)
        .eq('id', exerciseId)
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      return { data: updated, error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error('Failed to update exercise') };
    }
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
