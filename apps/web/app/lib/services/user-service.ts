import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface UserPrivacySettings {
  profile_visibility: 'public' | 'friends' | 'private';
  show_weight: boolean;
  show_progress: boolean;
}

export interface UserPublicProfile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  privacy: UserPrivacySettings;
  stats: {
    total_circles: number;
    circles_completed: number;
    current_streak: number;
  };
}

export interface UserProgressData {
  starting_weight: number | null;
  current_weight: number | null;
  target_weight: number | null;
  progress_percentage: number;
  weight_lost: number;
  weight_to_go: number;
  last_updated: string | null;
}

export interface UserHistoryEntry {
  id: string;
  date: string;
  weight: number | null;
  weight_change: number | null;
  is_public: boolean;
  note: string | null;
}

export interface UserHistoryResponse {
  entries: UserHistoryEntry[];
  total_count: number;
  has_more: boolean;
}

// ============================================================================
// USER SERVICE
// ============================================================================

export class UserService {
  /**
   * Get default privacy settings
   */
  private static getDefaultPrivacySettings(): UserPrivacySettings {
    return {
      profile_visibility: 'public',
      show_weight: true,
      show_progress: true,
    };
  }

  /**
   * Parse privacy settings from user preferences JSONB
   */
  private static parsePrivacySettings(preferences: any): UserPrivacySettings {
    if (!preferences) {
      return this.getDefaultPrivacySettings();
    }

    return {
      profile_visibility: preferences.profile_visibility || 'public',
      show_weight: preferences.show_weight !== false, // Default true
      show_progress: preferences.show_progress !== false, // Default true
    };
  }

  /**
   * Check if requester can view user's profile
   */
  private static async canViewProfile(
    userId: string,
    requesterId: string,
    privacy: UserPrivacySettings
  ): Promise<{ canView: boolean; reason?: string }> {
    // Users can always view their own profile
    if (userId === requesterId) {
      return { canView: true };
    }

    // Public profiles are viewable by anyone
    if (privacy.profile_visibility === 'public') {
      return { canView: true };
    }

    // Private profiles are only viewable by the owner
    if (privacy.profile_visibility === 'private') {
      return { canView: false, reason: 'This profile is private' };
    }

    // Friends-only profiles - check if they share a circle
    if (privacy.profile_visibility === 'friends') {
      const areFriends = await this.areInSameCircle(userId, requesterId);
      if (!areFriends) {
        return { canView: false, reason: 'This profile is only visible to circle members' };
      }
    }

    return { canView: true };
  }

  /**
   * Check if two users are in the same circle (i.e., "friends")
   */
  private static async areInSameCircle(userId1: string, userId2: string): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();

    // Get circles for user1
    const { data: user1Circles, error: error1 } = await supabaseAdmin
      .from('challenge_participants')
      .select('challenge_id')
      .eq('user_id', userId1)
      .eq('status', 'active');

    if (error1 || !user1Circles) return false;

    // Get circles for user2
    const { data: user2Circles, error: error2 } = await supabaseAdmin
      .from('challenge_participants')
      .select('challenge_id')
      .eq('user_id', userId2)
      .eq('status', 'active');

    if (error2 || !user2Circles) return false;

    // Check for intersection
    const user1CircleIds = new Set(user1Circles.map((c) => c.challenge_id));
    const hasSharedCircle = user2Circles.some((c) => user1CircleIds.has(c.challenge_id));

    return hasSharedCircle;
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Get public profile for a user
   * Respects privacy settings
   */
  static async getUserPublicProfile(
    userId: string,
    requesterId: string
  ): Promise<UserPublicProfile> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[UserService.getUserPublicProfile] Fetching profile for user ${userId} (requester: ${requesterId})`);

    // Get user profile
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url, preferences')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      console.error(`[UserService.getUserPublicProfile] User not found:`, error);
      throw new Error('User not found');
    }

    // Parse privacy settings
    const privacy = this.parsePrivacySettings(profile.preferences);

    console.log(`[UserService.getUserPublicProfile] Privacy settings:`, privacy);

    // Check if requester can view this profile
    const { canView, reason } = await this.canViewProfile(userId, requesterId, privacy);
    if (!canView) {
      console.log(`[UserService.getUserPublicProfile] Access denied: ${reason}`);
      throw new Error(reason || 'Access denied');
    }

    // Get circle statistics
    const { count: totalCircles } = await supabaseAdmin
      .from('challenge_participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');

    const { count: circlesCompleted } = await supabaseAdmin
      .from('challenge_participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');

    // Get current streak from daily_tracking
    const { data: trackingData } = await supabaseAdmin
      .from('daily_tracking')
      .select('tracking_date')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false })
      .limit(30);

    const currentStreak = this.calculateStreak(trackingData || []);

    console.log(`[UserService.getUserPublicProfile] Stats: ${totalCircles} circles, ${circlesCompleted} completed, ${currentStreak} streak`);

    return {
      user_id: userId,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      privacy,
      stats: {
        total_circles: totalCircles || 0,
        circles_completed: circlesCompleted || 0,
        current_streak: currentStreak,
      },
    };
  }

  /**
   * Get user progress data for a specific circle
   * Respects privacy settings
   */
  static async getUserProgress(
    userId: string,
    requesterId: string,
    circleId?: string
  ): Promise<UserProgressData> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[UserService.getUserProgress] Fetching progress for user ${userId} (requester: ${requesterId}, circle: ${circleId})`);

    // Get user profile with privacy settings
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error(`[UserService.getUserProgress] User not found:`, profileError);
      throw new Error('User not found');
    }

    const privacy = this.parsePrivacySettings(profile.preferences);

    // Check privacy settings
    if (!privacy.show_weight && userId !== requesterId) {
      console.log(`[UserService.getUserProgress] Weight data is private`);
      throw new Error('Weight data is private');
    }

    // If show_progress is false, return limited data
    if (!privacy.show_progress && userId !== requesterId) {
      console.log(`[UserService.getUserProgress] Progress data is limited`);
      // We'll still return percentage but not absolute values
    }

    // Get progress data
    let query = supabaseAdmin
      .from('challenge_participants')
      .select(`
        goal_start_value,
        current_value,
        goal_target_value,
        progress_percentage,
        updated_at
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false });

    if (circleId) {
      query = query.eq('challenge_id', circleId);
    }

    const { data: progressData, error: progressError } = await query.limit(1).single();

    if (progressError || !progressData) {
      console.log(`[UserService.getUserProgress] No progress data found`);
      // Return empty data
      return {
        starting_weight: null,
        current_weight: null,
        target_weight: null,
        progress_percentage: 0,
        weight_lost: 0,
        weight_to_go: 0,
        last_updated: null,
      };
    }

    // Get the most recent check-in to get current weight
    let currentWeightValue = progressData.current_value;

    // Try to get from circle_check_ins first
    if (circleId) {
      const { data: latestCheckIn } = await supabaseAdmin
        .from('circle_check_ins')
        .select('check_in_value, check_in_date')
        .eq('user_id', userId)
        .eq('circle_id', circleId)
        .order('check_in_date', { ascending: false })
        .limit(1)
        .single();

      if (latestCheckIn) {
        currentWeightValue = latestCheckIn.check_in_value;
        console.log(`[UserService.getUserProgress] Using latest circle check-in: ${currentWeightValue}kg`);
      }
    }

    // Fall back to daily_tracking if no circle check-in
    if (!currentWeightValue || currentWeightValue === progressData.current_value) {
      const { data: latestTracking } = await supabaseAdmin
        .from('daily_tracking')
        .select('weight_kg, tracking_date')
        .eq('user_id', userId)
        .not('weight_kg', 'is', null)
        .order('tracking_date', { ascending: false })
        .limit(1)
        .single();

      if (latestTracking && latestTracking.weight_kg) {
        currentWeightValue = latestTracking.weight_kg;
        console.log(`[UserService.getUserProgress] Using latest daily tracking: ${currentWeightValue}kg`);
      }
    }

    // If show_progress is false, return only percentage
    if (!privacy.show_progress && userId !== requesterId) {
      return {
        starting_weight: null,
        current_weight: null,
        target_weight: null,
        progress_percentage: progressData.progress_percentage || 0,
        weight_lost: 0,
        weight_to_go: 0,
        last_updated: progressData.updated_at,
      };
    }

    // Calculate derived values
    const startingWeight = progressData.goal_start_value || 0;
    const currentWeight = currentWeightValue || 0;
    const targetWeight = progressData.goal_target_value || 0;
    const weightLost = startingWeight - currentWeight;
    const weightToGo = currentWeight - targetWeight;

    console.log(`[UserService.getUserProgress] Progress: ${progressData.progress_percentage}%, ${weightLost}kg lost`);

    return {
      starting_weight: startingWeight,
      current_weight: currentWeight,
      target_weight: targetWeight,
      progress_percentage: progressData.progress_percentage || 0,
      weight_lost: Math.round(weightLost * 10) / 10,
      weight_to_go: Math.round(Math.max(0, weightToGo) * 10) / 10,
      last_updated: progressData.updated_at,
    };
  }

  /**
   * Get user check-in history
   * Respects privacy settings and is_public flag
   */
  static async getUserHistory(
    userId: string,
    requesterId: string,
    options: {
      circleId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<UserHistoryResponse> {
    const supabaseAdmin = createAdminSupabase();

    const { circleId, limit = 30, offset = 0 } = options;

    console.log(`[UserService.getUserHistory] Fetching history for user ${userId} (requester: ${requesterId}, limit: ${limit}, offset: ${offset})`);

    // Get user profile with privacy settings
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error(`[UserService.getUserHistory] User not found:`, profileError);
      throw new Error('User not found');
    }

    const privacy = this.parsePrivacySettings(profile.preferences);

    // Check privacy settings
    if (!privacy.show_progress && userId !== requesterId) {
      console.log(`[UserService.getUserHistory] Progress history is private`);
      return {
        entries: [],
        total_count: 0,
        has_more: false,
      };
    }

    // Build query for circle check-ins if circleId provided
    if (circleId) {
      let query = supabaseAdmin
        .from('circle_check_ins')
        .select('id, check_in_date, check_in_value, note, created_at', { count: 'exact' })
        .eq('user_id', userId)
        .eq('circle_id', circleId)
        .order('check_in_date', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: checkIns, error, count } = await query;

      if (error) {
        console.error(`[UserService.getUserHistory] Error fetching circle check-ins:`, error);
        throw error;
      }

      // If we have circle check-ins, return them
      if (checkIns && checkIns.length > 0) {
        // Calculate weight changes
        const entries: UserHistoryEntry[] = [];
        for (let i = 0; i < checkIns.length; i++) {
          const checkIn = checkIns[i];
          const prevCheckIn = i < checkIns.length - 1 ? checkIns[i + 1] : null;

          entries.push({
            id: checkIn.id,
            date: checkIn.check_in_date,
            weight: checkIn.check_in_value,
            weight_change: prevCheckIn
              ? Math.round((checkIn.check_in_value - prevCheckIn.check_in_value) * 100) / 100
              : null,
            is_public: true, // Circle check-ins are visible to circle members
            note: checkIn.note,
          });
        }

        console.log(`[UserService.getUserHistory] Returning ${entries.length} circle check-in entries`);

        return {
          entries,
          total_count: count || 0,
          has_more: (count || 0) > offset + limit,
        };
      }

      // No circle check-ins found, fall through to daily_tracking
      console.log(`[UserService.getUserHistory] No circle check-ins found, falling back to daily_tracking`);
    }

    // Build query for daily tracking (no circleId)
    let query = supabaseAdmin
      .from('daily_tracking')
      .select('id, tracking_date, weight_kg, notes, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: trackingData, error, count } = await query;

    if (error) {
      console.error(`[UserService.getUserHistory] Error fetching daily tracking:`, error);
      throw error;
    }

    // If not the user, filter by is_public flag
    let filteredData = trackingData || [];
    if (userId !== requesterId) {
      // For now, we don't have an is_public flag in daily_tracking
      // We'll assume all entries are visible to friends (people in same circles)
      const areFriends = await this.areInSameCircle(userId, requesterId);
      if (!areFriends && privacy.profile_visibility === 'friends') {
        console.log(`[UserService.getUserHistory] Not friends, returning empty history`);
        return {
          entries: [],
          total_count: 0,
          has_more: false,
        };
      }
    }

    // Calculate weight changes
    const entries: UserHistoryEntry[] = [];
    for (let i = 0; i < filteredData.length; i++) {
      const entry = filteredData[i];
      const prevEntry = i < filteredData.length - 1 ? filteredData[i + 1] : null;

      entries.push({
        id: entry.id,
        date: entry.tracking_date,
        weight: entry.weight_kg,
        weight_change: prevEntry && entry.weight_kg && prevEntry.weight_kg
          ? Math.round((entry.weight_kg - prevEntry.weight_kg) * 100) / 100
          : null,
        is_public: true, // For now, all entries are considered public to friends
        note: entry.notes,
      });
    }

    console.log(`[UserService.getUserHistory] Returning ${entries.length} daily tracking entries`);

    return {
      entries,
      total_count: count || 0,
      has_more: (count || 0) > offset + limit,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate check-in streak from tracking data
   */
  private static calculateStreak(trackingData: Array<{ tracking_date: string }>): number {
    if (!trackingData || trackingData.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 30; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      const hasEntry = trackingData.some((d) => d.tracking_date === targetDateStr);

      if (hasEntry) {
        streak++;
      } else if (i > 0) {
        break; // Streak broken
      }
    }

    return streak;
  }
}
