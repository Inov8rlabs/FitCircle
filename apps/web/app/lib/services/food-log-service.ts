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

import { type SupabaseClient } from '@supabase/supabase-js';

import type {
  FoodLogEntry,
  FoodLogStats,
  CreateFoodLogEntryInput,
  UpdateFoodLogEntryInput,
  ShareFoodLogInput,
  FoodLogShare,
} from '@/lib/types/food-log';

import { CircleMealPostService } from './circle-meal-post-service';

/**
 * Runs best-effort work that must not hold up the response. Routes pass Next's
 * `after()` (see lib/utils/after-response); without one, work runs inline as before.
 */
export type DeferFn = (task: () => Promise<unknown> | unknown) => void;

const POSTGRES_UNIQUE_VIOLATION = '23505';
/** invalid_text_representation — e.g. a non-UUID id. */
const POSTGRES_INVALID_TEXT_REPRESENTATION = '22P02';
/** Postgres errors caused by the values sent (bad type/format, check/not-null/FK). */
const POSTGRES_CLIENT_VALUE_ERRORS = new Set(['22P02', '22007', '22008', '22003', '23502', '23503', '23514']);
/** PostgREST: `.single()` matched no row. */
const POSTGREST_NO_ROWS = 'PGRST116';

/** Why an update failed — routes map it to a status code. */
export type UpdateFailure = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'DATABASE_ERROR';

export class FoodLogService {
  /**
   * Create a new food log entry
   */
  static async createEntry(
    userId: string,
    data: CreateFoodLogEntryInput,
    supabase: SupabaseClient,
    opts: {
      /**
       * Client-generated entry id (UUID). Makes the create idempotent: a retry with
       * the same id returns the stored entry (`duplicate: true`) instead of a copy.
       */
      id?: string;
      /** Where the audit row and the circle meal post run; inline when omitted. */
      defer?: DeferFn;
    } = {}
  ): Promise<{
    data: FoodLogEntry | null;
    error: Error | null;
    /** The id was already stored for this user — `data` is that existing entry. */
    duplicate?: boolean;
    /** The id belongs to another user's entry. */
    conflict?: boolean;
  }> {
    try {
      // Validate entry type requirements
      this.validateEntryData(data);

      const { data: entry, error } = await supabase
        .from('food_log_entries')
        .insert({
          ...(opts.id ? { id: opts.id } : {}),
          user_id: userId,
          entry_type: data.entry_type,
          logged_at: data.logged_at || new Date().toISOString(),
          entry_date: data.entry_date || new Date().toISOString().split('T')[0],
          meal_type: data.meal_type,
          title: data.title,
          description: data.description,
          notes: data.notes,
          nutrition_data: data.nutrition_data,
          // Typed nutrition columns (migration 054) — what Plate Score / Fitzy / insights READ.
          // Derived from nutrition_data when not passed explicitly, so existing clients that only
          // send nutrition_data still populate them (fixes the empty Plate Score).
          ...this.nutritionColumns(data),
          water_ml: data.water_ml,
          supplement_name: data.supplement_name,
          supplement_dosage: data.supplement_dosage,
          // Sharing by default (product decision 2026-09-17): a meal is shared
          // with the user's circles unless they mark it private. `visibility`
          // is what the circle feed filters on, so derive it from is_private
          // whenever the client doesn't set it explicitly.
          is_private: data.is_private ?? false,
          visibility: data.visibility ?? ((data.is_private ?? false) ? 'private' : 'circle'),
          tags: data.tags || [],
        })
        .select()
        .single();

      if (error) {
        if (opts.id && error.code === POSTGRES_UNIQUE_VIOLATION) {
          return this.existingForRetry(opts.id, userId, supabase, error.message);
        }
        return { data: null, error: new Error(error.message) };
      }

      if (opts.defer) {
        opts.defer(() => this.auditLog(userId, entry.id, 'create', supabase));
        // Water / supplements never become meal cards — don't even schedule it.
        if (CircleMealPostService.isShareableMeal(entry as FoodLogEntry)) {
          opts.defer(() => CircleMealPostService.onMealLogged(entry as FoodLogEntry));
        }
      } else {
        // Audit log
        await this.auditLog(userId, entry.id, 'create', supabase);

        // Circle chat: shared meals become meal cards (fire-and-forget, never throws).
        void CircleMealPostService.onMealLogged(entry as FoodLogEntry);
      }

      return { data: entry, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /** A create retried with an id that's already stored: hand back that entry. */
  private static async existingForRetry(
    id: string,
    userId: string,
    supabase: SupabaseClient,
    insertError: string
  ): Promise<{ data: FoodLogEntry | null; error: Error | null; duplicate?: boolean; conflict?: boolean }> {
    const { data: existing } = await supabase
      .from('food_log_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return { data: null, error: new Error(insertError) };
    if (existing.user_id !== userId) {
      return { data: null, error: new Error('Entry id is already in use'), conflict: true };
    }
    return { data: existing as FoodLogEntry, error: null, duplicate: true };
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
   * Get all entries for one calendar day, ordered chronologically by
   * logged_at (the time the user actually ate). This is what the per-day
   * timeline UI consumes; the standard list endpoint stays DESC-by-time for
   * the multi-day feed.
   */
  static async getEntriesForDay(
    userId: string,
    entryDate: string,
    supabase: SupabaseClient
  ): Promise<{ data: FoodLogEntry[]; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('food_log_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('entry_date', entryDate)
        .is('deleted_at', null)
        .order('logged_at', { ascending: true });

      if (error) {
        return { data: [], error: new Error(error.message) };
      }
      return { data: data || [], error: null };
    } catch (error) {
      return {
        data: [],
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
  ): Promise<{ data: FoodLogEntry | null; error: Error | null; failure?: UpdateFailure }> {
    try {
      // Verify ownership. Missing / deleted → NOT_FOUND; someone else's → FORBIDDEN.
      const { data: existing, error: readError } = await supabase
        .from('food_log_entries')
        .select('user_id')
        .eq('id', entryId)
        .is('deleted_at', null)
        .maybeSingle();

      if (readError) {
        if (readError.code === POSTGRES_INVALID_TEXT_REPRESENTATION) {
          return { data: null, error: new Error('Entry not found'), failure: 'NOT_FOUND' };
        }
        return { data: null, error: new Error(readError.message), failure: 'DATABASE_ERROR' };
      }
      if (!existing) {
        return { data: null, error: new Error('Entry not found'), failure: 'NOT_FOUND' };
      }
      if (existing.user_id !== userId) {
        return { data: null, error: new Error('Not authorized to edit this entry'), failure: 'FORBIDDEN' };
      }

      // Build update payload — only include keys the caller actually provided
      // so we don't blow away unrelated fields. logged_at and entry_date now
      // flow through so the user can re-time a meal after the fact.
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      const passthroughKeys: (keyof UpdateFoodLogEntryInput)[] = [
        'logged_at',
        'entry_date',
        'meal_type',
        'title',
        'description',
        'notes',
        'nutrition_data',
        'water_ml',
        'supplement_name',
        'supplement_dosage',
        'is_private',
        'visibility',
        'tags',
      ];
      for (const key of passthroughKeys) {
        if (data[key] !== undefined) updatePayload[key] = data[key];
      }
      // Keep the typed nutrition columns (migration 054) in sync on edit — derived from
      // nutrition_data when not passed explicitly. These are what Plate Score / Fitzy / insights read.
      Object.assign(updatePayload, this.nutritionColumns(data));

      const { data: updated, error } = await supabase
        .from('food_log_entries')
        .update(updatePayload)
        .eq('id', entryId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        // Deleted between the ownership read and the update.
        if (error.code === POSTGREST_NO_ROWS) {
          return { data: null, error: new Error('Entry not found'), failure: 'NOT_FOUND' };
        }
        // A value Postgres rejected (bad format, check / not-null / FK) is the client's.
        if (error.code && POSTGRES_CLIENT_VALUE_ERRORS.has(error.code)) {
          return { data: null, error: new Error(error.message), failure: 'VALIDATION_ERROR' };
        }
        return { data: null, error: new Error(error.message), failure: 'DATABASE_ERROR' };
      }

      // Audit log
      await this.auditLog(userId, entryId, 'update', supabase, { changes: data });

      // Keep the circle chat meal cards in sync (or pull them if it went private).
      void CircleMealPostService.onMealUpdated(updated as FoodLogEntry);

      return { data: updated, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
        failure: 'DATABASE_ERROR',
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
        .select('entry_type, meal_type, water_ml, entry_date, nutrition_data')
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
        total_calories: entries
          .reduce((sum, e) => sum + (e.nutrition_data?.calories || 0), 0),
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
   * Soft delete food log entry (images handled separately). Idempotent for the
   * owner:
   *  - live entry            → soft-deleted, `deleted: true`
   *  - already deleted / missing id → `success: true, deleted: false` (no side effects re-run)
   *  - another user's entry  → `notFound: true` (callers answer 404; never touched)
   *  - database failure      → `error` + `dbError: true` (callers answer 500)
   */
  static async deleteEntry(
    entryId: string,
    userId: string,
    supabase: SupabaseClient,
    opts: { defer?: DeferFn } = {}
  ): Promise<{
    success: boolean;
    error: Error | null;
    /** A row was soft-deleted by this call. */
    deleted?: boolean;
    /** The id is someone else's entry. */
    notFound?: boolean;
    /** The failure is a database/server error, not a client one. */
    dbError?: boolean;
    entryType?: string | null;
  }> {
    try {
      // Verify ownership (and learn the entry type: deleting water returns the
      // new hydration total). Kept as a separate read rather than UPDATE…RETURNING
      // because the web list calls this with an RLS client whose SELECT policy
      // hides soft-deleted rows, so RETURNING would come back empty.
      const { data: entry, error: readError } = await supabase
        .from('food_log_entries')
        .select('user_id, entry_type, deleted_at')
        .eq('id', entryId)
        .maybeSingle();

      if (readError) {
        // A malformed id can't name a row: treat it as missing, not a server error.
        if (readError.code === POSTGRES_INVALID_TEXT_REPRESENTATION) {
          return { success: true, error: null, deleted: false, entryType: null };
        }
        return { success: false, error: new Error(readError.message), dbError: true };
      }

      // Missing (never synced, or hidden from an RLS client once deleted): nothing to do.
      if (!entry) return { success: true, error: null, deleted: false, entryType: null };

      if (entry.user_id !== userId) {
        return { success: false, error: new Error('Entry not found'), notFound: true };
      }

      // Already deleted: a retried delete / undo succeeds without re-running side effects.
      if (entry.deleted_at) {
        return { success: true, error: null, deleted: false, entryType: entry.entry_type ?? null };
      }

      const { error } = await supabase
        .from('food_log_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('user_id', userId)
        .is('deleted_at', null);

      if (error) {
        return { success: false, error: new Error(error.message), dbError: true };
      }

      const audit = () => this.auditLog(userId, entryId, 'delete', supabase);
      if (opts.defer) {
        opts.defer(audit);
        // A deleted meal disappears from every circle chat it was posted to.
        if (entry.entry_type !== 'water') opts.defer(() => CircleMealPostService.onMealDeleted(entryId));
      } else {
        await audit();
        // A deleted meal disappears from every circle chat it was posted to.
        void CircleMealPostService.onMealDeleted(entryId);
      }

      return { success: true, error: null, deleted: true, entryType: entry.entry_type ?? null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
        dbError: true,
      };
    }
  }

  // Private helper methods

  /**
   * Build the typed nutrition columns (migration 054) for an insert/update. Uses explicit fields
   * when present, else derives macros from `nutrition_data` — so clients that only send
   * nutrition_data still populate the columns Plate Score / Fitzy / insights / leaderboard READ.
   * Only includes keys that resolve to a value, so an update never nulls out untouched columns.
   */
  private static nutritionColumns(
    data: Partial<CreateFoodLogEntryInput & UpdateFoodLogEntryInput>
  ): Record<string, unknown> {
    const nd = data.nutrition_data;
    const cols: Record<string, unknown> = {};
    const cal = data.calories ?? nd?.calories;
    const p = data.protein_g ?? nd?.protein_g;
    const c = data.carbs_g ?? nd?.carbs_g;
    const f = data.fat_g ?? nd?.fat_g;
    if (cal !== undefined) cols.calories = cal;
    if (p !== undefined) cols.protein_g = p;
    if (c !== undefined) cols.carbs_g = c;
    if (f !== undefined) cols.fat_g = f;
    if (data.servings !== undefined) cols.servings = data.servings;
    if (data.food_id !== undefined) cols.food_id = data.food_id;
    if (data.input_method !== undefined) cols.input_method = data.input_method;
    if (data.nutrition_source !== undefined) cols.nutrition_source = data.nutrition_source;
    if (data.llm_confidence !== undefined) cols.llm_confidence = data.llm_confidence;
    return cols;
  }

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
