import { createAdminSupabase } from '../supabase-admin';
import { addDays, localToday } from '../streaks/streak-calculator';
import {
  type MetricStreak,
  type MetricType,
  type MetricStreakResponse,
  type MetricTrendPoint,
  type AllMetricStreaksResponse,
  type MetricFrequencyConfig,
  METRIC_FREQUENCY_CONFIG,
  getMetricFrequency,
  StreakError,
  STREAK_ERROR_CODES,
} from '../types/streak';

/** Length of the per-metric trend series, in days (today included). */
export const METRIC_TREND_DAYS = 30;

/** daily_tracking column that holds each daily metric. */
const METRIC_COLUMNS = {
  weight: 'weight_kg',
  steps: 'steps',
  mood: 'mood_score',
} as const;

type TrackedMetric = keyof typeof METRIC_COLUMNS;
const TRACKED_METRICS = Object.keys(METRIC_COLUMNS) as TrackedMetric[];

interface MetricExtras {
  total_logs_count: number;
  trend: MetricTrendPoint[];
}

/**
 * MetricStreakService
 *
 * Manages Tier 2 metric-specific streaks for weight, steps, mood, measurements, photos.
 *
 * Business Logic:
 * - Weight: Daily logging, 1 grace day per week
 * - Steps: Daily logging, 1 rest day per week
 * - Mood: Daily logging, 2 grace days per week
 * - Measurements: Weekly logging (any day Mon-Sun)
 * - Photos: Weekly logging (Fri-Sun, 3-day window)
 */
export class MetricStreakService {
  // ============================================================================
  // CORE METRIC STREAK MANAGEMENT
  // ============================================================================

  /**
   * Update metric-specific streak when user logs data
   */
  static async updateMetricStreak(
    userId: string,
    metricType: MetricType,
    logDate?: string
  ): Promise<MetricStreakResponse> {
    const supabaseAdmin = createAdminSupabase();
    const date = logDate || new Date().toISOString().split('T')[0];

    console.log(`[MetricStreakService.updateMetricStreak] Updating ${metricType} streak for user ${userId}`);

    // Get metric frequency config
    const config = getMetricFrequency(metricType);

    // Get or create metric streak record
    const { data: initialStreakRecord, error: fetchError } = await supabaseAdmin
      .from('metric_streaks')
      .select('*')
      .eq('user_id', userId)
      .eq('metric_type', metricType)
      .single();
    let streakRecord = initialStreakRecord;

    if (fetchError && fetchError.code === 'PGRST116') {
      // No record exists, create one
      console.log(`[MetricStreakService.updateMetricStreak] Creating new ${metricType} streak record`);

      const { data: newRecord, error: createError } = await supabaseAdmin
        .from('metric_streaks')
        .insert({
          user_id: userId,
          metric_type: metricType,
          current_streak: 0,
          longest_streak: 0,
          grace_days_available: config.grace_days,
          last_log_date: null,
        })
        .select()
        .single();

      if (createError) throw createError;
      streakRecord = newRecord;
    } else if (fetchError) {
      throw fetchError;
    }

    if (!streakRecord) {
      throw new Error('Failed to get or create metric streak record');
    }

    // Calculate new streak based on metric frequency
    const calculation = await this.calculateMetricStreak(userId, metricType, config);

    console.log(`[MetricStreakService.updateMetricStreak] ${metricType} streak calculation:`, calculation);

    // Update streak record
    const { data: updatedStreak, error: updateError } = await supabaseAdmin
      .from('metric_streaks')
      .update({
        current_streak: calculation.currentStreak,
        longest_streak: Math.max(calculation.longestStreak, streakRecord.longest_streak, calculation.currentStreak),
        last_log_date: date,
      })
      .eq('user_id', userId)
      .eq('metric_type', metricType)
      .select()
      .single();

    if (updateError) throw updateError;
    if (!updatedStreak) throw new Error('Failed to update metric streak');

    console.log(`[MetricStreakService.updateMetricStreak] Updated ${metricType} streak: ${calculation.currentStreak} ${config.frequency === 'daily' ? 'days' : 'weeks'}`);

    return this.formatMetricStreakResponse(updatedStreak, config);
  }

  /**
   * Get all metric streaks for user.
   *
   * The response stays an object keyed by metric (null until that metric has
   * a streak record). Each non-null metric additionally carries
   * `total_logs_count` and a 30-day `trend`.
   */
  static async getMetricStreaks(
    userId: string,
    timezone?: string
  ): Promise<AllMetricStreaksResponse> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[MetricStreakService.getMetricStreaks] Fetching all metric streaks for user ${userId}`);

    const { data: streaks, error } = await supabaseAdmin
      .from('metric_streaks')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    // Convert to map by metric type
    const streakMap = new Map<MetricType, MetricStreak>();
    for (const streak of streaks || []) {
      streakMap.set(streak.metric_type as MetricType, streak);
    }

    // Additional fields are best-effort: the streaks themselves must still be
    // returned if the history cannot be read.
    let extras: Partial<Record<MetricType, MetricExtras>> = {};
    if (streakMap.size > 0) {
      try {
        extras = await this.getMetricExtras(userId, timezone);
      } catch (extrasError) {
        console.error('[MetricStreakService.getMetricStreaks] extras error (omitted):', extrasError);
      }
    }

    const format = (metricType: MetricType): MetricStreakResponse | null => {
      const record = streakMap.get(metricType);
      if (!record) return null;
      return {
        ...this.formatMetricStreakResponse(record, METRIC_FREQUENCY_CONFIG[metricType]),
        ...(extras[metricType] ?? {}),
      };
    };

    // Return all metrics (null if not tracked yet)
    return {
      weight: format('weight'),
      steps: format('steps'),
      mood: format('mood'),
      measurements: format('measurements'),
      photos: format('photos'),
    };
  }

  /**
   * `total_logs_count` and the 30-day `trend` for every metric.
   *
   * weight / steps / mood come from daily_tracking, using the same "a value is
   * present" rule as the streak calculation. measurements and photos have no
   * log table yet (see getMetricLogs), so they honestly report zero logs.
   */
  static async getMetricExtras(
    userId: string,
    timezone?: string
  ): Promise<Record<MetricType, MetricExtras>> {
    const supabaseAdmin = createAdminSupabase();
    const today = localToday(timezone);
    const start = addDays(today, -(METRIC_TREND_DAYS - 1));

    const [recent, ...counts] = await Promise.all([
      supabaseAdmin
        .from('daily_tracking')
        .select('tracking_date, weight_kg, steps, mood_score')
        .eq('user_id', userId)
        .gte('tracking_date', start)
        .lte('tracking_date', today),
      ...TRACKED_METRICS.map((metric) =>
        supabaseAdmin
          .from('daily_tracking')
          .select('tracking_date', { count: 'exact', head: true })
          .eq('user_id', userId)
          .not(METRIC_COLUMNS[metric], 'is', null)
      ),
    ]);

    if (recent.error) throw recent.error;

    const byDate = new Map<string, Record<string, unknown>>();
    for (const row of (recent.data || []) as Record<string, unknown>[]) {
      byDate.set(String(row.tracking_date), row);
    }

    const days: string[] = [];
    for (let offset = METRIC_TREND_DAYS - 1; offset >= 0; offset--) {
      days.push(addDays(today, -offset));
    }

    const trendFor = (metric: TrackedMetric | null): MetricTrendPoint[] =>
      days.map((date) => {
        const raw = metric ? byDate.get(date)?.[METRIC_COLUMNS[metric]] : null;
        if (raw === null || raw === undefined) return { date, logged: false, value: null };
        const value = Number(raw);
        return { date, logged: true, value: Number.isFinite(value) ? value : null };
      });

    const result = {
      measurements: { total_logs_count: 0, trend: trendFor(null) },
      photos: { total_logs_count: 0, trend: trendFor(null) },
    } as Record<MetricType, MetricExtras>;

    TRACKED_METRICS.forEach((metric, index) => {
      const countResult = counts[index];
      if (countResult.error) throw countResult.error;
      result[metric] = {
        total_logs_count: countResult.count ?? 0,
        trend: trendFor(metric),
      };
    });

    return result;
  }

  /**
   * Get specific metric streak for user
   */
  static async getMetricStreak(
    userId: string,
    metricType: MetricType
  ): Promise<MetricStreakResponse | null> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[MetricStreakService.getMetricStreak] Fetching ${metricType} streak for user ${userId}`);

    const { data: streakRecord, error } = await supabaseAdmin
      .from('metric_streaks')
      .select('*')
      .eq('user_id', userId)
      .eq('metric_type', metricType)
      .single();

    if (error && error.code === 'PGRST116') {
      // No record exists
      console.log(`[MetricStreakService.getMetricStreak] No ${metricType} streak record found`);
      return null;
    }

    if (error) throw error;
    if (!streakRecord) return null;

    const config = getMetricFrequency(metricType);
    return this.formatMetricStreakResponse(streakRecord, config);
  }

  // ============================================================================
  // STREAK CALCULATION LOGIC
  // ============================================================================

  /**
   * Calculate streak for a specific metric based on existing logs
   */
  private static async calculateMetricStreak(
    userId: string,
    metricType: MetricType,
    config: MetricFrequencyConfig
  ): Promise<{ currentStreak: number; longestStreak: number; graceDaysUsed: number }> {
    const supabaseAdmin = createAdminSupabase();

    // Get logs from appropriate table based on metric type
    const logs = await this.getMetricLogs(userId, metricType);

    if (config.frequency === 'daily') {
      return this.calculateDailyStreak(logs, config.grace_days);
    } else {
      // Weekly metrics
      return this.calculateWeeklyStreak(logs, metricType, config);
    }
  }

  /**
   * Calculate daily metric streak (weight, steps, mood)
   */
  private static calculateDailyStreak(
    logs: string[],
    graceDaysPerWeek: number
  ): { currentStreak: number; longestStreak: number; graceDaysUsed: number } {
    const logDates = new Set(logs);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    let longestStreak = 0;
    let graceDaysUsed = 0;
    let graceDaysAvailable = graceDaysPerWeek;
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of current week (Sunday)

    // Count backwards from today
    for (let i = 0; i < 90; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const checkDateStr = this.formatDate(checkDate);

      // Check if we've moved to a previous week (reset grace days)
      if (checkDate < weekStart) {
        weekStart.setDate(weekStart.getDate() - 7);
        graceDaysAvailable = graceDaysPerWeek;
      }

      const hasLog = logDates.has(checkDateStr);

      if (hasLog) {
        // Log found, increment streak
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else if (i === 0) {
        // Today with no log doesn't break streak
        continue;
      } else {
        // Missed a day - try to use grace
        if (graceDaysAvailable > 0) {
          // Use grace day to maintain streak
          graceDaysUsed++;
          graceDaysAvailable--;
          currentStreak++;
          longestStreak = Math.max(longestStreak, currentStreak);
          console.log(`[calculateDailyStreak] Used grace day for ${checkDateStr}, grace remaining this week: ${graceDaysAvailable}`);
        } else {
          // No grace available, streak broken
          console.log(`[calculateDailyStreak] Streak broken at ${checkDateStr}, no grace days available`);
          break;
        }
      }
    }

    return {
      currentStreak,
      longestStreak,
      graceDaysUsed,
    };
  }

  /**
   * Calculate weekly metric streak (measurements, photos)
   */
  private static calculateWeeklyStreak(
    logs: string[],
    metricType: MetricType,
    config: MetricFrequencyConfig
  ): { currentStreak: number; longestStreak: number; graceDaysUsed: number } {
    const logDates = new Set(logs);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    let longestStreak = 0;

    // For weekly metrics, we check if there's at least one log in each week
    // Photos: Must be Fri-Sun (window_start=5, window_end=0)
    // Measurements: Can be any day Mon-Sun (window_start=1, window_end=0)

    // Count backwards by weeks
    for (let weekOffset = 0; weekOffset < 52; weekOffset++) {
      const weekChecked = this.hasLogInWeekWindow(
        logDates,
        today,
        weekOffset,
        config.window_start || 0,
        config.window_end || 0,
        metricType
      );

      if (weekChecked) {
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else if (weekOffset === 0) {
        // Current week with no log doesn't break streak yet
        continue;
      } else {
        // Missed a week, streak broken
        console.log(`[calculateWeeklyStreak] Weekly streak broken at week offset ${weekOffset}`);
        break;
      }
    }

    return {
      currentStreak,
      longestStreak,
      graceDaysUsed: 0, // Weekly metrics don't use grace days
    };
  }

  /**
   * Check if there's a log in the specified week window
   */
  private static hasLogInWeekWindow(
    logDates: Set<string>,
    referenceDate: Date,
    weekOffset: number,
    windowStart: number,
    windowEnd: number,
    metricType: MetricType
  ): boolean {
    // Calculate the week we're checking
    const weekDate = new Date(referenceDate);
    weekDate.setDate(weekDate.getDate() - (weekOffset * 7));

    if (metricType === 'measurements') {
      // Measurements: Any day in the week (Mon-Sun)
      // Check Sunday of that week through Saturday
      const sunday = new Date(weekDate);
      sunday.setDate(sunday.getDate() - sunday.getDay());

      for (let i = 0; i < 7; i++) {
        const checkDate = new Date(sunday);
        checkDate.setDate(checkDate.getDate() + i);
        if (logDates.has(this.formatDate(checkDate))) {
          return true;
        }
      }
      return false;
    } else if (metricType === 'photos') {
      // Photos: Friday-Sunday (3-day window)
      const sunday = new Date(weekDate);
      sunday.setDate(sunday.getDate() - sunday.getDay());

      // Check Friday (day 5), Saturday (day 6), Sunday (day 0/7)
      for (const dayOffset of [5, 6, 7]) {
        const checkDate = new Date(sunday);
        checkDate.setDate(checkDate.getDate() + (dayOffset === 7 ? 0 : dayOffset));
        if (logDates.has(this.formatDate(checkDate))) {
          return true;
        }
      }
      return false;
    }

    return false;
  }

  // ============================================================================
  // DATA FETCHING HELPERS
  // ============================================================================

  /**
   * Get metric logs from appropriate source table
   */
  private static async getMetricLogs(
    userId: string,
    metricType: MetricType
  ): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();

    switch (metricType) {
      case 'weight':
        {
          const { data, error } = await supabaseAdmin
            .from('daily_tracking')
            .select('tracking_date')
            .eq('user_id', userId)
            .not('weight_kg', 'is', null)
            .gte('tracking_date', this.formatDate(this.getDaysAgo(365)))
            .order('tracking_date', { ascending: false });

          if (error) throw error;
          return (data || []).map(d => d.tracking_date);
        }

      case 'steps':
        {
          const { data, error } = await supabaseAdmin
            .from('daily_tracking')
            .select('tracking_date')
            .eq('user_id', userId)
            .not('steps', 'is', null)
            .gte('tracking_date', this.formatDate(this.getDaysAgo(365)))
            .order('tracking_date', { ascending: false });

          if (error) throw error;
          return (data || []).map(d => d.tracking_date);
        }

      case 'mood':
        {
          const { data, error } = await supabaseAdmin
            .from('daily_tracking')
            .select('tracking_date')
            .eq('user_id', userId)
            .not('mood_score', 'is', null)
            .gte('tracking_date', this.formatDate(this.getDaysAgo(365)))
            .order('tracking_date', { ascending: false });

          if (error) throw error;
          return (data || []).map(d => d.tracking_date);
        }

      case 'measurements':
      case 'photos':
        // These would come from separate tables (not yet implemented)
        // For now, return empty array
        console.log(`[getMetricLogs] ${metricType} tracking not yet implemented`);
        return [];

      default:
        throw new StreakError(
          `Unknown metric type: ${metricType}`,
          STREAK_ERROR_CODES.INVALID_METRIC_TYPE
        );
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Format date as YYYY-MM-DD
   */
  private static formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get date N days ago
   */
  private static getDaysAgo(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  /**
   * Format metric streak record for API response
   */
  private static formatMetricStreakResponse(
    record: MetricStreak,
    config: MetricFrequencyConfig
  ): MetricStreakResponse {
    return {
      metric_type: record.metric_type,
      current_streak: record.current_streak,
      longest_streak: record.longest_streak,
      last_log_date: record.last_log_date,
      grace_days_available: config.grace_days,
      grace_days_used: 0, // TODO: Track this in database if needed
    };
  }
}
