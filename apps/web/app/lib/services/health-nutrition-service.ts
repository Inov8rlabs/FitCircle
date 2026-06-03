import { createAdminSupabase } from '../supabase-admin';
import {
  type HealthNutritionSyncState,
  type HealthPlatform,
  type ImportNutritionRequest,
  type ImportNutritionResult,
} from '../types/health-nutrition';

/**
 * HealthNutritionService — server side of HealthKit / Health Connect nutrition sync (PRD §6.2).
 *
 * Write-BACK (FitCircle log → platform) is done natively on-device by each client. The server owns:
 *  - per-(user,platform) sync state (enabled + cursor + last_sync_at)
 *  - idempotent IMPORT of platform nutrition into food_log_entries, deduped by
 *    (user_id, nutrition_source, source_external_id) so re-syncing a window never double-inserts.
 *
 * Imported entries are marked input_method='imported', nutrition_source=<platform>, so the social
 * surfaces can tell platform imports from FitCircle-native logs.
 */
const ALL_PLATFORMS: HealthPlatform[] = ['healthkit', 'healthconnect', 'mfp'];

export class HealthNutritionService {
  static async getState(userId: string): Promise<HealthNutritionSyncState[]> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('health_nutrition_sync')
      .select('platform, enabled, last_sync_at, last_cursor')
      .eq('user_id', userId);
    const byPlatform = new Map((data ?? []).map((r) => [r.platform as HealthPlatform, r]));
    // Return a row for every platform (default disabled/unsynced when no row yet).
    return ALL_PLATFORMS.map((platform) => {
      const r = byPlatform.get(platform);
      return {
        platform,
        enabled: r?.enabled ?? false,
        lastSyncAt: r?.last_sync_at ?? null,
        lastCursor: r?.last_cursor ?? null,
      };
    });
  }

  static async setEnabled(userId: string, platform: HealthPlatform, enabled: boolean): Promise<HealthNutritionSyncState> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('health_nutrition_sync')
      .upsert({ user_id: userId, platform, enabled }, { onConflict: 'user_id,platform' })
      .select('platform, enabled, last_sync_at, last_cursor')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'set_enabled_failed');
    return {
      platform: data.platform as HealthPlatform,
      enabled: data.enabled,
      lastSyncAt: data.last_sync_at,
      lastCursor: data.last_cursor,
    };
  }

  /**
   * Idempotent batch import. Inserts only items whose externalId hasn't been imported before
   * (by user+platform), skips the rest, advances cursor + last_sync_at.
   */
  static async importBatch(userId: string, req: ImportNutritionRequest): Promise<ImportNutritionResult> {
    const supabase = createAdminSupabase();
    const nowISO = new Date().toISOString();

    if (req.items.length === 0) {
      await this.touchSync(userId, req.platform, req.cursor ?? null, nowISO);
      return { received: 0, imported: 0, skipped: 0, lastSyncAt: nowISO };
    }

    // Which externalIds are already imported for this (user, platform)?
    const externalIds = req.items.map((i) => i.externalId);
    const { data: existing } = await supabase
      .from('food_log_entries')
      .select('source_external_id')
      .eq('user_id', userId)
      .eq('nutrition_source', req.platform)
      .in('source_external_id', externalIds);
    const seen = new Set((existing ?? []).map((r) => r.source_external_id as string));

    const fresh = req.items.filter((i) => !seen.has(i.externalId));

    if (fresh.length > 0) {
      const rows = fresh.map((i) => ({
        user_id: userId,
        entry_type: 'food',
        title: i.name,
        logged_at: i.loggedAt,
        entry_date: i.loggedAt.slice(0, 10),
        meal_type: i.mealType ?? 'other',
        calories: i.calories ?? null,
        protein_g: i.proteinG ?? null,
        carbs_g: i.carbsG ?? null,
        fat_g: i.fatG ?? null,
        input_method: 'imported',
        nutrition_source: req.platform,
        source_external_id: i.externalId,
        // Imported data is private by default; the user opts into sharing via privacy tiers (§6.4).
        visibility: 'private',
        source: 'import',
      }));
      // Idempotent against the partial unique index — ignore dupes from a concurrent sync.
      const { error } = await supabase
        .from('food_log_entries')
        .upsert(rows, { onConflict: 'user_id,nutrition_source,source_external_id', ignoreDuplicates: true });
      if (error) throw new Error(`import failed: ${error.message}`);
    }

    await this.touchSync(userId, req.platform, req.cursor ?? null, nowISO);

    return {
      received: req.items.length,
      imported: fresh.length,
      skipped: req.items.length - fresh.length,
      lastSyncAt: nowISO,
    };
  }

  private static async touchSync(userId: string, platform: HealthPlatform, cursor: string | null, nowISO: string): Promise<void> {
    const supabase = createAdminSupabase();
    await supabase
      .from('health_nutrition_sync')
      .upsert(
        { user_id: userId, platform, last_sync_at: nowISO, last_cursor: cursor, enabled: true },
        { onConflict: 'user_id,platform' }
      );
  }
}
