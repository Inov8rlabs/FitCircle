import { createAdminSupabase } from '../supabase-admin';
import { MomentumService } from './momentum-service';
import { BoostService } from './boost-service';

// ============================================================================
// TYPES
// ============================================================================

export interface QuickLogInput {
  brand: string;
  category: 'cardio' | 'strength' | 'flexibility' | 'sports' | 'outdoor' | 'other';
  duration_minutes: number;
  notes?: string;
}

export interface BrandInfo {
  id: string;
  display_name: string;
  icon: string;
  default_category: 'cardio' | 'strength' | 'flexibility' | 'sports' | 'outdoor' | 'other';
}

export interface RecentActivity {
  brand: string | null;
  category: string;
  exercise_type: string;
  last_used: string;
}

// ============================================================================
// BRAND CATALOG
// ============================================================================

const BRANDS: BrandInfo[] = [
  { id: 'orangetheory', display_name: 'OrangeTheory', icon: 'flame', default_category: 'cardio' },
  { id: 'crossfit', display_name: 'CrossFit', icon: 'dumbbell', default_category: 'strength' },
  { id: 'f45', display_name: 'F45', icon: 'timer', default_category: 'cardio' },
  { id: 'barrys', display_name: "Barry's", icon: 'zap', default_category: 'cardio' },
  { id: 'peloton', display_name: 'Peloton', icon: 'bike', default_category: 'cardio' },
  { id: 'apple_fitness', display_name: 'Apple Fitness+', icon: 'apple', default_category: 'cardio' },
  { id: 'ifit', display_name: 'iFit', icon: 'monitor', default_category: 'cardio' },
  { id: 'freeletics', display_name: 'Freeletics', icon: 'person', default_category: 'strength' },
  { id: 'planet_fitness', display_name: 'Planet Fitness', icon: 'building', default_category: 'strength' },
  { id: 'equinox', display_name: 'Equinox', icon: 'star', default_category: 'strength' },
  { id: 'ymca', display_name: 'YMCA', icon: 'building', default_category: 'other' },
  { id: 'soulcycle', display_name: 'SoulCycle', icon: 'bike', default_category: 'cardio' },
  { id: 'yoga_studio', display_name: 'Yoga Studio', icon: 'lotus', default_category: 'flexibility' },
  { id: 'swimming', display_name: 'Swimming', icon: 'waves', default_category: 'cardio' },
  { id: 'boxing', display_name: 'Boxing', icon: 'fist', default_category: 'sports' },
  { id: 'other', display_name: 'Other', icon: 'activity', default_category: 'other' },
];

// Map brand to a default exercise_type
const BRAND_EXERCISE_TYPE: Record<string, string> = {
  orangetheory: 'hiit',
  crossfit: 'crossTraining',
  f45: 'hiit',
  barrys: 'hiit',
  peloton: 'cycling',
  apple_fitness: 'mixedCardio',
  ifit: 'mixedCardio',
  freeletics: 'functionalTraining',
  planet_fitness: 'strengthTraining',
  equinox: 'strengthTraining',
  ymca: 'mixedCardio',
  soulcycle: 'cycling',
  yoga_studio: 'yoga',
  swimming: 'swimming',
  boxing: 'boxing',
  other: 'other',
};

// ============================================================================
// SERVICE
// ============================================================================

export class WorkoutLoggingService {
  /**
   * Quick log a workout with minimal input.
   * Creates exercise_log, sets counts_as_checkin if duration >= 10 min,
   * and triggers momentum check-in + circle boost recalculation.
   */
  static async quickLog(
    userId: string,
    input: QuickLogInput
  ): Promise<{ exercise: Record<string, unknown>; momentum: Record<string, unknown> | null }> {
    const supabaseAdmin = createAdminSupabase();
    const today = new Date().toISOString().split('T')[0];
    const countsAsCheckin = input.duration_minutes >= 10;
    const exerciseType = BRAND_EXERCISE_TYPE[input.brand] || 'other';

    console.log(`[WorkoutLoggingService.quickLog] User ${userId}, brand=${input.brand}, duration=${input.duration_minutes}min, checkin=${countsAsCheckin}`);

    // Estimate calories from profile weight
    let caloriesBurned: number | null = null;
    let caloriesEstimated = false;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('weight_kg')
      .eq('id', userId)
      .single();

    if (profile?.weight_kg) {
      // Simple MET-based estimation
      const met = 5.0; // moderate default
      caloriesBurned = Math.round(met * Number(profile.weight_kg) * (input.duration_minutes / 60));
      caloriesEstimated = true;
    }

    // Create the exercise log
    const { data: exercise, error } = await supabaseAdmin
      .from('exercise_logs')
      .insert({
        user_id: userId,
        exercise_type: exerciseType,
        category: input.category,
        duration_minutes: input.duration_minutes,
        calories_burned: caloriesBurned,
        calories_estimated: caloriesEstimated,
        exercise_date: today,
        source: 'manual',
        brand: input.brand,
        counts_as_checkin: countsAsCheckin,
        verified_source: false,
        body_areas: ['fullBody'],
        is_public: true,
        notes: input.notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error(`[WorkoutLoggingService.quickLog] Insert error:`, error);
      throw new Error(error.message);
    }

    // Record engagement activity for streak
    try {
      const { EngagementStreakService } = await import('./engagement-streak-service');
      await EngagementStreakService.recordActivity(userId, 'exercise_log', exercise.id, today);
    } catch (streakError) {
      console.error(`[WorkoutLoggingService.quickLog] Streak recording failed:`, streakError);
    }

    // Trigger momentum check-in if duration qualifies
    let momentumResult: Record<string, unknown> | null = null;
    if (countsAsCheckin) {
      try {
        const result = await MomentumService.checkIn(userId);
        momentumResult = {
          new_momentum: result.new_momentum,
          flame_level: result.flame_level,
          flame_label: result.flame_label,
          milestone_achieved: result.milestone_achieved,
        };
      } catch (momentumError) {
        console.error(`[WorkoutLoggingService.quickLog] Momentum check-in failed:`, momentumError);
      }

      // Recalculate circle boosts (non-blocking)
      try {
        await BoostService.recalculateAllCirclesForUser(userId);
      } catch (boostError) {
        console.error(`[WorkoutLoggingService.quickLog] Boost recalculation failed:`, boostError);
      }
    }

    return { exercise, momentum: momentumResult };
  }

  /**
   * Get the list of supported brands.
   */
  static getBrands(): BrandInfo[] {
    return BRANDS;
  }

  /**
   * Get user's recent unique brand+category combos.
   */
  static async getRecentActivities(userId: string, limit: number = 5): Promise<RecentActivity[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data: exercises, error } = await supabaseAdmin
      .from('exercise_logs')
      .select('brand, category, exercise_type, exercise_date')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('exercise_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error(`[WorkoutLoggingService.getRecentActivities] Error:`, error);
      throw new Error(error.message);
    }

    // Deduplicate by brand+category
    const seen = new Set<string>();
    const recent: RecentActivity[] = [];

    for (const e of exercises || []) {
      const key = `${e.brand || 'none'}:${e.category}`;
      if (!seen.has(key)) {
        seen.add(key);
        recent.push({
          brand: e.brand || null,
          category: e.category,
          exercise_type: e.exercise_type,
          last_used: e.exercise_date,
        });
        if (recent.length >= limit) break;
      }
    }

    return recent;
  }
}
