/**
 * Food Log Service
 *
 * Business logic for food, water, and supplement logging including:
 * - Entry CRUD operations
 * - Privacy and sharing controls
 * - Permission checks
 * - Statistics and aggregations
 *
 * Part of Food Logging Feature (Premium/Enterprise)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  FoodLogEntry,
  FoodLogStats,
  CreateFoodLogEntryInput,
  UpdateFoodLogEntryInput,
  ShareFoodLogInput,
  FoodLogShare,
} from '@/lib/types/food-log';

export class FoodLogService {
  /**
   * Create a new food log entry
   */
  static async createEntry(
    userId: string,
    data: CreateFoodLogEntryInput,
    supabase: SupabaseClient
  ): Promise<{ data: FoodLogEntry | null; error: Error | null }> {
    try {
      // Validate entry type requirements
      this.validateEntryData(data);

      const { data: entry, error } = await supabase
        .from('food_log_entries')
        .insert({
          user_id: userId,
          entry_type: data.entry_type,
          logged_at: data.logged_at || new Date().toISOString(),
          entry_date: data.entry_date || new Date().toISOString().split('T')[0],
          meal_type: data.meal_type,
          title: data.title,
          description: data.description,
          notes: data.notes,
          nutrition_data: data.nutrition_data,
          water_ml: data.water_ml,
          supplement_name: data.supplement_name,
          supplement_dosage: data.supplement_dosage,
          is_private: data.is_private ?? true,
          visibility: data.visibility || 'private',
          tags: data.tags || [],
        })
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Audit log
      await this.auditLog(userId, entry.id, 'create', supabase);

      return { data: entry, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get user's food log entries with pagination
   */
  static async getEntries(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      entry_type?: string;
      start_date?: string;
      end_date?: string;
      meal_type?: string;
      tags?: string[];
    },
    supabase: SupabaseClient
  ): Promise<{
    data: FoodLogEntry[];
    total: number;
    hasMore: boolean;
    error: Error | null;
  }> {
    try {
      const page = options.page || 1;
      const limit = Math.min(options.limit || 20, 100);
      const offset = (page - 1) * limit;

      let query = supabase
        .from('food_log_entries')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('logged_at', { ascending: false });

      // Apply filters
      if (options.entry_type && options.entry_type !== 'all') {
        query = query.eq('entry_type', options.entry_type);
      }

      if (options.start_date) {
        query = query.gte('entry_date', options.start_date);
      }

      if (options.end_date) {
        query = query.lte('entry_date', options.end_date);
      }

      if (options.meal_type) {
        query = query.eq('meal_type', options.meal_type);
      }

      if (options.tags && options.tags.length > 0) {
        query = query.overlaps('tags', options.tags);
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
   * Get single food log entry by ID
   */
  static async getEntryById(
    entryId: string,
    viewerId: string,
    supabase: SupabaseClient
  ): Promise<{ data: FoodLogEntry | null; error: Error | null }> {
    try {
      // Check permission
      const canView = await this.canViewEntry(entryId, viewerId, supabase);
      if (!canView) {
        return { data: null, error: new Error('Not authorized to view this entry') };
      }

      const { data: entry, error } = await supabase
        .from('food_log_entries')
        .select('*')
        .eq('id', entryId)
        .is('deleted_at', null)
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Audit log view action
      if (entry.user_id !== viewerId) {
        await this.auditLog(viewerId, entryId, 'view', supabase, { actor_id: viewerId });
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
   * Update food log entry
   */
  static async updateEntry(
    entryId: string,
    userId: string,
    data: UpdateFoodLogEntryInput,
    supabase: SupabaseClient
  ): Promise<{ data: FoodLogEntry | null; error: Error | null }> {
    try {
      // Verify ownership
      const { data: existing } = await supabase
        .from('food_log_entries')
        .select('user_id')
        .eq('id', entryId)
        .is('deleted_at', null)
        .single();

      if (!existing || existing.user_id !== userId) {
        return { data: null, error: new Error('Not authorized') };
      }

      // Update entry
      const { data: updated, error } = await supabase
        .from('food_log_entries')
        .update({
          meal_type: data.meal_type,
          title: data.title,
          description: data.description,
          notes: data.notes,
          nutrition_data: data.nutrition_data,
          water_ml: data.water_ml,
          supplement_name: data.supplement_name,
          supplement_dosage: data.supplement_dosage,
          is_private: data.is_private,
          visibility: data.visibility,
          tags: data.tags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', entryId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Audit log
      await this.auditLog(userId, entryId, 'update', supabase, { changes: data });

      return { data: updated, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Check if user can view a food log entry
   */
  static async canViewEntry(
    entryId: string,
    viewerId: string,
    supabase: SupabaseClient
  ): Promise<boolean> {
    try {
      // Check if user owns the entry
      const { data: entry } = await supabase
        .from('food_log_entries')
        .select('user_id, entry_type')
        .eq('id', entryId)
        .is('deleted_at', null)
        .single();

      if (!entry) return false;
      if (entry.user_id === viewerId) return true;

      // Supplements are ALWAYS private - cannot be shared
      if (entry.entry_type === 'supplement') return false;

      // Check if entry is shared with viewer
      const { data: share } = await supabase
        .from('food_log_shares')
        .select('id')
        .eq('food_log_entry_id', entryId)
        .eq('shared_with_user_id', viewerId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .single();

      return !!share;
    } catch (error) {
      return false;
    }
  }

  /**
   * Share food log entry with user or circle
   */
  static async shareEntry(
    entryId: string,
    ownerId: string,
    options: ShareFoodLogInput,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; shares?: FoodLogShare[]; error: Error | null }> {
    try {
      // Verify ownership
      const { data: entry } = await supabase
        .from('food_log_entries')
        .select('user_id, entry_type')
        .eq('id', entryId)
        .is('deleted_at', null)
        .single();

      if (!entry || entry.user_id !== ownerId) {
        return { success: false, error: new Error('Not authorized') };
      }

      // CRITICAL: Supplements cannot be shared
      if (entry.entry_type === 'supplement') {
        return { success: false, error: new Error('Supplements cannot be shared for privacy') };
      }

      if (options.share_with === 'user' && options.user_ids) {
        // Share with specific users
        const shares = options.user_ids.map(userId => ({
          food_log_entry_id: entryId,
          owner_id: ownerId,
          shared_with_user_id: userId,
          can_comment: options.can_comment || false,
          expires_at: options.expires_at,
          share_message: options.message,
        }));

        const { data, error } = await supabase
          .from('food_log_shares')
          .upsert(shares)
          .select();

        if (error) {
          return { success: false, error: new Error(error.message) };
        }

        // Update entry visibility
        await supabase
          .from('food_log_entries')
          .update({ visibility: 'shared', is_private: false })
          .eq('id', entryId);

        // Audit log
        await this.auditLog(ownerId, entryId, 'share', supabase, {
          shared_with_users: options.user_ids,
        });

        return { success: true, shares: data, error: null };
      } else if (options.share_with === 'circle' && options.circle_id) {
        // Share with circle
        const { data, error } = await supabase
          .from('food_log_shares')
          .upsert({
            food_log_entry_id: entryId,
            owner_id: ownerId,
            shared_with_circle_id: options.circle_id,
            can_comment: options.can_comment || false,
            expires_at: options.expires_at,
            share_message: options.message,
          })
          .select();

        if (error) {
          return { success: false, error: new Error(error.message) };
        }

        // Update entry visibility
        await supabase
          .from('food_log_entries')
          .update({ visibility: 'circle', is_private: false })
          .eq('id', entryId);

        // Audit log
        await this.auditLog(ownerId, entryId, 'share', supabase, {
          shared_with_circle: options.circle_id,
        });

        return { success: true, shares: data, error: null };
      } else {
        return { success: false, error: new Error('Invalid share options') };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get shares for an entry
   */
  static async getShares(
    entryId: string,
    ownerId: string,
    supabase: SupabaseClient
  ): Promise<{ data: FoodLogShare[]; error: Error | null }> {
    try {
      // Verify ownership
      const { data: entry } = await supabase
        .from('food_log_entries')
        .select('user_id')
        .eq('id', entryId)
        .single();

      if (!entry || entry.user_id !== ownerId) {
        return { data: [], error: new Error('Not authorized') };
      }

      const { data: shares, error } = await supabase
        .from('food_log_shares')
        .select('*')
        .eq('food_log_entry_id', entryId)
        .eq('owner_id', ownerId);

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      return { data: shares || [], error: null };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Revoke share access
   */
  static async revokeShare(
    shareId: string,
    ownerId: string,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error: Error | null }> {
    try {
      const { error } = await supabase
        .from('food_log_shares')
        .delete()
        .eq('id', shareId)
        .eq('owner_id', ownerId);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      // Audit log
      await this.auditLog(ownerId, shareId, 'unshare', supabase);

      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
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
  ): Promise<{ data: FoodLogStats | null; error: Error | null }> {
    try {
      // Get all entries in date range
      const { data: entries, error } = await supabase
        .from('food_log_entries')
        .select('entry_type, meal_type, water_ml, entry_date')
        .eq('user_id', userId)
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .is('deleted_at', null);

      if (error) {
        return { data: null, error: new Error(error.message) };
      }

      // Aggregate statistics
      const stats: FoodLogStats = {
        total_entries: entries.length,
        by_type: {
          food: entries.filter(e => e.entry_type === 'food').length,
          water: entries.filter(e => e.entry_type === 'water').length,
          supplement: entries.filter(e => e.entry_type === 'supplement').length,
        },
        by_meal: {
          breakfast: entries.filter(e => e.meal_type === 'breakfast').length,
          lunch: entries.filter(e => e.meal_type === 'lunch').length,
          dinner: entries.filter(e => e.meal_type === 'dinner').length,
          snack: entries.filter(e => e.meal_type === 'snack').length,
          other: entries.filter(e => e.meal_type === 'other').length,
        },
        total_water_ml: entries
          .filter(e => e.water_ml)
          .reduce((sum, e) => sum + (e.water_ml || 0), 0),
        avg_daily_entries: this.calculateAvgDailyEntries(entries, startDate, endDate),
        streak_days: await this.calculateStreak(userId, supabase),
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
   * Soft delete food log entry (images handled separately)
   */
  static async deleteEntry(
    entryId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error: Error | null }> {
    try {
      // Verify ownership
      const { data: entry } = await supabase
        .from('food_log_entries')
        .select('user_id')
        .eq('id', entryId)
        .single();

      if (!entry || entry.user_id !== userId) {
        return { success: false, error: new Error('Not authorized') };
      }

      // Soft delete entry
      const { error } = await supabase
        .from('food_log_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('user_id', userId);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      // Audit log
      await this.auditLog(userId, entryId, 'delete', supabase);

      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  // Private helper methods

  private static validateEntryData(data: any): void {
    if (data.entry_type === 'food' && !data.meal_type) {
      throw new Error('meal_type required for food entries');
    }
    if (data.entry_type === 'water' && !data.water_ml) {
      throw new Error('water_ml required for water entries');
    }
    if (data.entry_type === 'supplement' && !data.supplement_name) {
      throw new Error('supplement_name required for supplement entries');
    }
  }

  private static calculateAvgDailyEntries(
    entries: any[],
    startDate: string,
    endDate: string
  ): number {
    const days = Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return days > 0 ? Number((entries.length / days).toFixed(1)) : 0;
  }

  private static async calculateStreak(
    userId: string,
    supabase: SupabaseClient
  ): Promise<number> {
    // Get dates with entries, sorted descending
    const { data: entries } = await supabase
      .from('food_log_entries')
      .select('entry_date')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('entry_date', { ascending: false });

    if (!entries || entries.length === 0) return 0;

    // Count consecutive days
    let streak = 1;
    const today = new Date().toISOString().split('T')[0];
    const uniqueDates = [...new Set(entries.map(e => e.entry_date))];

    // Check if streak is current (entry today or yesterday)
    const latestDate = uniqueDates[0];
    const daysSinceLatest = Math.floor(
      (new Date(today).getTime() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLatest > 1) return 0; // Streak broken

    // Count consecutive days
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
  }

  private static async auditLog(
    userId: string,
    entryId: string,
    action: string,
    supabase: SupabaseClient,
    metadata?: any
  ): Promise<void> {
    await supabase.from('food_log_audit').insert({
      food_log_entry_id: entryId,
      user_id: userId,
      action,
      actor_id: metadata?.actor_id,
      metadata: metadata || {},
    });
  }
}
