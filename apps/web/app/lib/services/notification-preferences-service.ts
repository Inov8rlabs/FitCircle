import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface NotificationPreferences {
  id: string;
  user_id: string;
  journey_enabled: boolean;
  momentum_enabled: boolean;
  circle_enabled: boolean;
  challenge_enabled: boolean;
  social_enabled: boolean;
  celebration_enabled: boolean;
  quiet_hours_start: string | null; // TIME format "HH:MM"
  quiet_hours_end: string | null;
  quiet_hours_timezone: string;
  updated_at: string;
}

export type NotificationCategory =
  | 'journey'
  | 'momentum'
  | 'circle'
  | 'challenge'
  | 'social'
  | 'celebration';

// Maps notification type prefix to category
const TYPE_CATEGORY_MAP: Record<string, NotificationCategory> = {
  // Journey (J1-J11)
  welcome_day0: 'journey',
  day1_first_workout: 'journey',
  day3_circle_invite: 'journey',
  day7_weekly_summary: 'journey',
  day14_challenge_nudge: 'journey',
  day21_momentum_check: 'journey',
  day30_monthly_recap: 'journey',
  dormant_7d: 'journey',
  dormant_14d: 'journey',
  dormant_30d: 'journey',
  win_back_60d: 'journey',

  // State - Momentum (S1-S4b)
  momentum_at_risk: 'momentum',
  near_milestone: 'momentum',
  grace_day_used: 'momentum',
  momentum_decay: 'momentum',
  momentum_reset: 'momentum',
  reset_encouragement: 'momentum',

  // State - Circle (S5/S6/S12)
  circle_boost_threshold: 'circle',
  perfect_day: 'circle',
  friend_joined_circle: 'circle',

  // State - Challenge (S7/S8/S9)
  challenge_halfway: 'challenge',
  challenge_ending_tomorrow: 'challenge',
  challenge_completed: 'challenge',

  // State - Summary (S10-S15)
  weekly_summary: 'social',
  daily_drop: 'social',
  milestone_achieved: 'celebration',
  points_earned: 'celebration',
  circle_invite_received: 'social',
};

// ============================================================================
// SERVICE
// ============================================================================

export class NotificationPreferencesService {
  /**
   * Get preferences for a user, creating defaults if none exist.
   */
  static async getPreferences(userId: string): Promise<NotificationPreferences> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No record found — create defaults
      return this.createDefaults(userId);
    }

    if (error) {
      console.error('[NotificationPreferencesService.getPreferences] Error:', error);
      throw error;
    }

    return data as NotificationPreferences;
  }

  /**
   * Partially update notification preferences.
   */
  static async updatePreferences(
    userId: string,
    updates: Partial<Omit<NotificationPreferences, 'id' | 'user_id' | 'updated_at'>>
  ): Promise<NotificationPreferences> {
    const supabaseAdmin = createAdminSupabase();

    // Ensure record exists
    await this.getPreferences(userId);

    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('[NotificationPreferencesService.updatePreferences] Error:', error);
      throw error;
    }

    console.log(`[NotificationPreferencesService] Updated preferences for user ${userId}`);
    return data as NotificationPreferences;
  }

  /**
   * Check if a specific notification type is enabled for a user.
   */
  static async isTypeEnabled(userId: string, notificationType: string): Promise<boolean> {
    const category = TYPE_CATEGORY_MAP[notificationType];
    if (!category) {
      // Unknown type — allow by default
      console.warn(`[NotificationPreferencesService] Unknown notification type: ${notificationType}`);
      return true;
    }

    const prefs = await this.getPreferences(userId);
    const enabledKey = `${category}_enabled` as keyof NotificationPreferences;
    return prefs[enabledKey] as boolean;
  }

  /**
   * Get the category for a notification type.
   */
  static getCategoryForType(notificationType: string): NotificationCategory | null {
    return TYPE_CATEGORY_MAP[notificationType] || null;
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private static async createDefaults(userId: string): Promise<NotificationPreferences> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .insert({
        user_id: userId,
        journey_enabled: true,
        momentum_enabled: true,
        circle_enabled: true,
        challenge_enabled: true,
        social_enabled: true,
        celebration_enabled: true,
        quiet_hours_timezone: 'America/New_York',
      })
      .select()
      .single();

    if (error) {
      console.error('[NotificationPreferencesService.createDefaults] Error:', error);
      throw error;
    }

    return data as NotificationPreferences;
  }
}
