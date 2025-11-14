/**
 * Beverage Log Service
 *
 * Business logic for beverage logging including:
 * - Entry CRUD operations
 * - Favorites management
 * - Statistics and aggregations
 * - Privacy controls
 *
 * Part of Beverage Logging Feature
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  BeverageLogEntry,
  BeverageLogStats,
  CreateBeverageLogInput,
  UpdateBeverageLogInput,
  FavoriteBeverage,
  BeverageCategory,
} from '@/lib/types/beverage-log';

export class BeverageLogService {
  /**
   * Create a new beverage log entry
   */
  static async createEntry(
    userId: string,
    data: CreateBeverageLogInput,
    supabase: SupabaseClient
  ): Promise<{ data: BeverageLogEntry | null; error: Error | null }> {
    try {
      const { data: entry, error } = await supabase
        .from('beverage_logs')
        .insert({
          user_id: userId,
          category: data.category,
          beverage_type: data.beverage_type,
          customizations: data.customizations || {},
          volume_ml: data.volume_ml,
          calories: data.calories,
          caffeine_mg: data.caffeine_mg,
          sugar_g: data.sugar_g,
          notes: data.notes,
          is_favorite: data.is_favorite ?? false,
          favorite_name: data.favorite_name,
          is_private: data.is_private ?? true,
          logged_at: data.logged_at || new Date().toISOString(),
          entry_date: data.entry_date || new Date().toISOString().split('T')[0],
          source: data.source || 'manual',
        })
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      return { data: entry, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get user's beverage log entries with pagination and filters
   */
  static async getEntries(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      category?: string;
      start_date?: string;
      end_date?: string;
      favorites_only?: boolean;
    },
    supabase: SupabaseClient
  ): Promise<{
    data: BeverageLogEntry[];
    total: number;
    hasMore: boolean;
    error: Error | null;
  }> {
    try {
      const page = options.page || 1;
      const limit = Math.min(options.limit || 20, 100);
      const offset = (page - 1) * limit;

      let query = supabase
        .from('beverage_logs')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('logged_at', { ascending: false });

      // Apply filters
      if (options.category && options.category !== 'all') {
        query = query.eq('category', options.category);
      }

      if (options.start_date) {
        query = query.gte('entry_date', options.start_date);
      }

      if (options.end_date) {
        query = query.lte('entry_date', options.end_date);
      }

      if (options.favorites_only === true) {
        query = query.eq('is_favorite', true);
      }

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        return { data: [], total: 0, hasMore: false, error: new Error(error.message) };
      }

      const hasMore = count ? count > offset + limit : false;

      return { data: data || [], total: count || 0, hasMore, error: null };
    } catch (error) {
      return {
        data: [],
        total: 0,
        hasMore: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get single beverage log entry by ID
   */
  static async getEntryById(
    entryId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ data: BeverageLogEntry | null; error: Error | null }> {
    try {
      const { data: entry, error } = await supabase
        .from('beverage_logs')
        .select('*')
        .eq('id', entryId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      return { data: entry, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Update beverage log entry
   */
  static async updateEntry(
    entryId: string,
    userId: string,
    data: UpdateBeverageLogInput,
    supabase: SupabaseClient
  ): Promise<{ data: BeverageLogEntry | null; error: Error | null }> {
    try {
      // Verify ownership
      const { data: existing } = await supabase
        .from('beverage_logs')
        .select('user_id')
        .eq('id', entryId)
        .is('deleted_at', null)
        .single();

      if (!existing || existing.user_id !== userId) {
        return { data: null, error: new Error('Not authorized') };
      }

      // Build update object (only include provided fields)
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (data.beverage_type !== undefined) updateData.beverage_type = data.beverage_type;
      if (data.customizations !== undefined) updateData.customizations = data.customizations;
      if (data.volume_ml !== undefined) updateData.volume_ml = data.volume_ml;
      if (data.calories !== undefined) updateData.calories = data.calories;
      if (data.caffeine_mg !== undefined) updateData.caffeine_mg = data.caffeine_mg;
      if (data.sugar_g !== undefined) updateData.sugar_g = data.sugar_g;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.is_favorite !== undefined) updateData.is_favorite = data.is_favorite;
      if (data.favorite_name !== undefined) updateData.favorite_name = data.favorite_name;
      if (data.is_private !== undefined) updateData.is_private = data.is_private;

      // Update entry
      const { data: updated, error } = await supabase
        .from('beverage_logs')
        .update(updateData)
        .eq('id', entryId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      return { data: updated, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Soft delete beverage log entry
   */
  static async deleteEntry(
    entryId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error: Error | null }> {
    try {
      // Verify ownership
      const { data: entry } = await supabase
        .from('beverage_logs')
        .select('user_id')
        .eq('id', entryId)
        .single();

      if (!entry || entry.user_id !== userId) {
        return { success: false, error: new Error('Not authorized') };
      }

      // Soft delete entry
      const { error } = await supabase
        .from('beverage_logs')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('user_id', userId);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get user's favorite beverages
   */
  static async getFavorites(
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ data: FavoriteBeverage[]; error: Error | null }> {
    try {
      const { data: favorites, error } = await supabase
        .from('beverage_logs')
        .select('*')
        .eq('user_id', userId)
        .eq('is_favorite', true)
        .is('deleted_at', null)
        .order('favorite_name', { ascending: true });

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      // Transform to FavoriteBeverage format
      const favoritesData: FavoriteBeverage[] = (favorites || []).map((fav) => ({
        id: fav.id,
        favorite_name: fav.favorite_name,
        category: fav.category,
        beverage_type: fav.beverage_type,
        customizations: fav.customizations,
        volume_ml: fav.volume_ml,
        calories: fav.calories,
        caffeine_mg: fav.caffeine_mg,
        sugar_g: fav.sugar_g,
        last_used_at: fav.logged_at,
      }));

      return { data: favoritesData, error: null };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get aggregated statistics for user
   */
  static async getStats(
    userId: string,
    startDate: string,
    endDate: string,
    supabase: SupabaseClient
  ): Promise<{ data: BeverageLogStats | null; error: Error | null }> {
    try {
      // Get all entries in date range
      const { data: entries, error } = await supabase
        .from('beverage_logs')
        .select('category, volume_ml, caffeine_mg, calories, sugar_g, entry_date, beverage_type')
        .eq('user_id', userId)
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .is('deleted_at', null);

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      if (!entries || entries.length === 0) {
        // Return zero stats
        return {
          data: {
            total_entries: 0,
            by_category: {} as Record<BeverageCategory, number>,
            total_volume_ml: 0,
            total_water_ml: 0,
            total_caffeine_mg: 0,
            total_calories: 0,
            total_sugar_g: 0,
            avg_daily_entries: 0,
            avg_daily_water_ml: 0,
            streak_days: 0,
            favorite_count: 0,
          },
          error: null,
        };
      }

      // Get favorite count
      const { count: favoriteCount } = await supabase
        .from('beverage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_favorite', true)
        .is('deleted_at', null);

      // Aggregate statistics
      const byCategory: Record<string, number> = {};
      let totalVolume = 0;
      let totalWater = 0;
      let totalCaffeine = 0;
      let totalCalories = 0;
      let totalSugar = 0;

      // Count by beverage type to find most common
      const beverageTypeCounts: Record<string, { count: number; category: string }> = {};

      entries.forEach((entry) => {
        // Category count
        byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;

        // Beverage type count
        const key = `${entry.category}:${entry.beverage_type}`;
        if (!beverageTypeCounts[key]) {
          beverageTypeCounts[key] = { count: 0, category: entry.category };
        }
        beverageTypeCounts[key].count++;

        // Volume
        totalVolume += entry.volume_ml || 0;
        if (entry.category === 'water') {
          totalWater += entry.volume_ml || 0;
        }

        // Nutrients
        totalCaffeine += entry.caffeine_mg || 0;
        totalCalories += entry.calories || 0;
        totalSugar += entry.sugar_g || 0;
      });

      // Find most common beverage
      let mostCommon: BeverageLogStats['most_common_beverage'] = undefined;
      let maxCount = 0;
      Object.entries(beverageTypeCounts).forEach(([key, { count, category }]) => {
        if (count > maxCount) {
          maxCount = count;
          const beverageType = key.split(':')[1];
          mostCommon = {
            beverage_type: beverageType,
            category: category as BeverageCategory,
            count,
          };
        }
      });

      // Calculate averages
      const daysDiff = Math.max(
        1,
        Math.ceil(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
        ) + 1
      );

      const avgDailyEntries = Number((entries.length / daysDiff).toFixed(1));
      const avgDailyWater = Math.round(totalWater / daysDiff);

      // Calculate streak
      const streakDays = await this.calculateStreak(userId, supabase);

      const stats: BeverageLogStats = {
        total_entries: entries.length,
        by_category: byCategory as Record<BeverageCategory, number>,
        total_volume_ml: totalVolume,
        total_water_ml: totalWater,
        total_caffeine_mg: totalCaffeine,
        total_calories: totalCalories,
        total_sugar_g: Number(totalSugar.toFixed(2)),
        avg_daily_entries: avgDailyEntries,
        avg_daily_water_ml: avgDailyWater,
        streak_days: streakDays,
        favorite_count: favoriteCount || 0,
        most_common_beverage: mostCommon,
      };

      return { data: stats, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Calculate consecutive days with beverage logs
   */
  private static async calculateStreak(
    userId: string,
    supabase: SupabaseClient
  ): Promise<number> {
    try {
      // Get unique dates with entries, sorted descending
      const { data: entries } = await supabase
        .from('beverage_logs')
        .select('entry_date')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('entry_date', { ascending: false });

      if (!entries || entries.length === 0) return 0;

      const today = new Date().toISOString().split('T')[0];
      const uniqueDates = [...new Set(entries.map((e) => e.entry_date))];

      // Check if streak is current (entry today or yesterday)
      const latestDate = uniqueDates[0];
      const daysSinceLatest = Math.floor(
        (new Date(today).getTime() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLatest > 1) return 0; // Streak broken

      // Count consecutive days
      let streak = 1;
      for (let i = 1; i < uniqueDates.length; i++) {
        const prevDate = new Date(uniqueDates[i - 1]);
        const currDate = new Date(uniqueDates[i]);
        const daysDiff = Math.floor(
          (prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff === 1) {
          streak++;
        } else {
          break;
        }
      }

      return streak;
    } catch (error) {
      return 0;
    }
  }
}
