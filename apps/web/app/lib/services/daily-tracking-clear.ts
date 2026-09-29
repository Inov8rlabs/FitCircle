/**
 * Clearing single metrics from a day of daily_tracking.
 *
 * PUT /api/mobile/tracking/daily/[date] treats an explicit JSON `null` for
 * weightKg / steps / moodScore / energyLevel / notes as "remove this value".
 * A clear is NOT a log: it never claims a streak, records no engagement activity
 * and never creates a row. It only nulls the requested columns — the same effect
 * the web app's PATCH /api/check-ins/[id] has always had.
 */
import { type SupabaseClient } from '@supabase/supabase-js';

export const CLEARABLE_TRACKING_FIELDS = {
  weightKg: 'weight_kg',
  steps: 'steps',
  moodScore: 'mood_score',
  energyLevel: 'energy_level',
  notes: 'notes',
} as const;

export type ClearableTrackingKey = keyof typeof CLEARABLE_TRACKING_FIELDS;
export type ClearableTrackingColumn = (typeof CLEARABLE_TRACKING_FIELDS)[ClearableTrackingKey];

/** Split a validated body into the keys to clear (explicit null) and the rest. */
export function splitTrackingClears<T extends Partial<Record<ClearableTrackingKey, unknown>>>(
  body: T
): { clears: ClearableTrackingKey[]; hasValues: boolean } {
  const keys = Object.keys(CLEARABLE_TRACKING_FIELDS) as ClearableTrackingKey[];
  const clears = keys.filter((key) => body[key] === null);
  const hasValues = keys.some((key) => body[key] !== null && body[key] !== undefined);
  return { clears, hasValues };
}

export class DailyTrackingClearService {
  /**
   * Null the given metrics on the user's row for `trackingDate`.
   * Returns the updated row, or null when the user has no row for that date.
   */
  static async clearMetrics(
    supabase: SupabaseClient,
    userId: string,
    trackingDate: string,
    keys: ClearableTrackingKey[]
  ): Promise<Record<string, unknown> | null> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of keys) update[CLEARABLE_TRACKING_FIELDS[key]] = null;

    const { data, error } = await supabase
      .from('daily_tracking')
      .update(update)
      .eq('user_id', userId)
      .eq('tracking_date', trackingDate)
      .select()
      .maybeSingle();

    if (error) throw error;
    return (data as Record<string, unknown> | null) ?? null;
  }
}
