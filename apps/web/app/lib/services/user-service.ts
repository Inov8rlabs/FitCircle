import { logIgnoredQueryError } from '@/lib/api/route-errors';

import { PRIVACY_DEFAULTS } from '../privacy/defaults';
import { createAdminSupabase } from '../supabase-admin';

import { LeaderboardService } from './leaderboard-service';

/** A weight only counts when it is a real positive number; 0 / null / '' mean "not set". */
function positiveOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number | null | undefined);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

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
  /** Same as `note`; the key the iOS app decodes. */
  notes: string | null;
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
      profile_visibility: PRIVACY_DEFAULTS.profileVisibility,
      show_weight: PRIVACY_DEFAULTS.showWeight,
      show_progress: PRIVACY_DEFAULTS.showProgress,
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
      profile_visibility: preferences.profile_visibility || PRIVACY_DEFAULTS.profileVisibility,
      show_weight: typeof preferences.show_weight === 'boolean' ? preferences.show_weight : PRIVACY_DEFAULTS.showWeight,
      show_progress: typeof preferences.show_progress === 'boolean' ? preferences.show_progress : PRIVACY_DEFAULTS.showProgress,
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
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId1)
      .eq('status', 'active');

    if (error1 || !user1Circles) return false;

    // Get circles for user2
    const { data: user2Circles, error: error2 } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId2)
      .eq('status', 'active');

    if (error2 || !user2Circles) return false;

    // Check for intersection
    const user1CircleIds = new Set(user1Circles.map((c) => c.fitcircle_id));
    const hasSharedCircle = user2Circles.some((c) => user1CircleIds.has(c.fitcircle_id));

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
    const { count: totalCircles, error: totalCirclesError } = await supabaseAdmin
      .from('fitcircle_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    logIgnoredQueryError('UserService.getUserPublicProfile', totalCirclesError);

    const { count: circlesCompleted, error: circlesCompletedError } = await supabaseAdmin
      .from('fitcircle_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');
    logIgnoredQueryError('UserService.getUserPublicProfile', circlesCompletedError);

    // Get current streak from daily_tracking
    const { data: trackingData, error: trackingDataError } = await supabaseAdmin
      .from('daily_tracking')
      .select('tracking_date')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false })
      .limit(30);
    logIgnoredQueryError('UserService.getUserPublicProfile', trackingDataError);

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
   * What `requesterId` may see of `userId`'s weight card and check-in history.
   * The owner always sees both. For anyone else the owner's `show_weight` /
   * `show_progress` preferences decide, the same two switches getUserProgress
   * and getUserHistory apply.
   *
   * getUserHistory answers a private history with an EMPTY list, which a caller
   * cannot tell apart from "no check-ins yet"; this is how a route finds out.
   */
  static async getSectionVisibility(
    userId: string,
    requesterId: string
  ): Promise<{ can_view_weight: boolean; can_view_history: boolean }> {
    if (userId === requesterId) {
      return { can_view_weight: true, can_view_history: true };
    }

    const supabaseAdmin = createAdminSupabase();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new Error('User not found');
    }

    const privacy = this.parsePrivacySettings(profile.preferences);
    return {
      can_view_weight: privacy.show_weight,
      can_view_history: privacy.show_progress,
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
      .select('preferences, goals')
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

    // Circle goal values (kg). A member row exists for every active member,
    // but goal_start/goal_target are only filled for weight-based challenges —
    // a circle without one used to fall through as 0 / 0 and the client then
    // showed "Lost -91.7 kg, To Go 91.7 kg".
    let query = supabaseAdmin
      .from('fitcircle_members')
      .select('goal_start_value, current_value, goal_target_value, progress_percentage, updated_at, joined_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false });

    if (circleId) {
      query = query.eq('fitcircle_id', circleId);
    }

    const { data: progressData } = await query.limit(1).maybeSingle();
    const memberStart = positiveOrNull(progressData?.goal_start_value);
    const memberTarget = positiveOrNull(progressData?.goal_target_value);

    // Current weight: latest circle check-in, else latest daily_tracking
    // weigh-in, else the member row's cached value.
    let currentKg: number | null = null;
    if (circleId) {
      const { data: latestCheckIn, error: latestCheckInError } = await supabaseAdmin
        .from('circle_check_ins')
        .select('check_in_value, check_in_date')
        .eq('user_id', userId)
        .eq('circle_id', circleId)
        .order('check_in_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      logIgnoredQueryError('UserService.getUserProgress', latestCheckInError);
      currentKg = positiveOrNull(latestCheckIn?.check_in_value);
    }
    if (currentKg == null) {
      const { data: latestTracking, error: latestTrackingError } = await supabaseAdmin
        .from('daily_tracking')
        .select('weight_kg, tracking_date')
        .eq('user_id', userId)
        .not('weight_kg', 'is', null)
        .order('tracking_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      logIgnoredQueryError('UserService.getUserProgress', latestTrackingError);
      currentKg = positiveOrNull(latestTracking?.weight_kg);
    }
    if (currentKg == null) currentKg = positiveOrNull(progressData?.current_value);

    // Fallback goal: the member's own weight goal (profiles.goals[type=weight],
    // the same source the dashboard vitals card reads), so a circle without a
    // weight challenge still shows real progress instead of zeros.
    const goals = (profile as { goals?: unknown }).goals;
    const weightGoal = Array.isArray(goals)
      ? (goals as Array<Record<string, unknown>>).find((g) => g?.type === 'weight')
      : undefined;
    const targetKg = memberTarget ?? positiveOrNull(weightGoal?.target_weight_kg);
    let startKg = memberStart ?? positiveOrNull(weightGoal?.starting_weight_kg);
    if (startKg == null && targetKg != null) {
      // Earliest weigh-in since joining the circle (or ever, if no join date).
      let earliest = supabaseAdmin
        .from('daily_tracking')
        .select('weight_kg, tracking_date')
        .eq('user_id', userId)
        .gt('weight_kg', 0)
        .order('tracking_date', { ascending: true });
      if (progressData?.joined_at) {
        earliest = earliest.gte('tracking_date', String(progressData.joined_at).slice(0, 10));
      }
      const { data: rows } = await earliest.limit(1);
      startKg = positiveOrNull(rows?.[0]?.weight_kg);
    }

    const derived = this.deriveWeightProgress({ startKg, currentKg, targetKg });
    const lastUpdated = (progressData?.updated_at as string | null | undefined) ?? null;
    console.log(
      `[UserService.getUserProgress] start=${derived.starting_weight} current=${derived.current_weight} target=${derived.target_weight} → ${derived.progress_percentage}% (${derived.weight_lost}kg lost)`
    );

    // If show_progress is false, return only percentage
    if (!privacy.show_progress && userId !== requesterId) {
      return {
        starting_weight: null,
        current_weight: null,
        target_weight: null,
        progress_percentage: derived.progress_percentage,
        weight_lost: 0,
        weight_to_go: 0,
        last_updated: lastUpdated,
      };
    }

    return { ...derived, last_updated: lastUpdated };
  }

  /**
   * Pure derivation of the weight-progress card numbers. Unknown inputs stay
   * null (clients render a dash) and the derived numbers are only computed
   * from inputs that exist — never from a 0 stand-in. `weight_lost` is
   * start − current (negative = gained); `weight_to_go` is the distance left
   * in the goal's direction, floored at 0 once the target is reached.
   */
  static deriveWeightProgress(inputs: {
    startKg: number | null | undefined;
    currentKg: number | null | undefined;
    targetKg: number | null | undefined;
  }): Omit<UserProgressData, 'last_updated'> {
    const start = positiveOrNull(inputs.startKg);
    const current = positiveOrNull(inputs.currentKg);
    const target = positiveOrNull(inputs.targetKg);

    const lost = start != null && current != null ? round1(start - current) : 0;

    let toGo = 0;
    if (current != null && target != null) {
      const losing = start != null ? target < start : target < current;
      toGo = round1(Math.max(0, losing ? current - target : target - current));
    }

    const progress =
      start != null && current != null && target != null
        ? Math.round(LeaderboardService.calculateProgress(start, current, target, 'weight_loss') * 10) / 10
        : 0;

    return {
      starting_weight: start,
      current_weight: current,
      target_weight: target,
      progress_percentage: progress,
      weight_lost: lost,
      weight_to_go: toGo,
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

    // Every entry here is a WEIGHT (kg): clients render `weight` as one. It used
    // to carry a steps circle's step totals (10,109 steps → "22,286.5 lbs").
    if (!privacy.show_weight && userId !== requesterId) {
      console.log(`[UserService.getUserHistory] Weight is private`);
      return { entries: [], total_count: 0, has_more: false };
    }

    // In a circle: the circle's own metric decides; only a weight circle has
    // weight entries (docs/MEMBER_PROGRESS_CONTRACT.md).
    if (circleId) {
      const { MemberProgressService } = await import('./member-progress-service');
      const { toLegacyWeightEntries } = await import('@/lib/circles/member-progress');
      const progress = await MemberProgressService.getMemberCircleProgress(userId, requesterId, circleId);
      const all = progress.can_view && progress.metric === 'weight' ? toLegacyWeightEntries(progress.entries) : [];
      return {
        entries: all.slice(offset, offset + limit),
        total_count: all.length,
        has_more: all.length > offset + limit,
      };
    }

    if (userId !== requesterId && privacy.profile_visibility === 'friends') {
      const areFriends = await this.areInSameCircle(userId, requesterId);
      if (!areFriends) {
        console.log(`[UserService.getUserHistory] Not friends, returning empty history`);
        return { entries: [], total_count: 0, has_more: false };
      }
    }

    // Real weigh-ins only (> 0); rows the member marked private only for them.
    let query = supabaseAdmin
      .from('daily_tracking')
      .select('id, tracking_date, weight_kg, notes, is_public, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .gt('weight_kg', 0)
      .order('tracking_date', { ascending: false })
      .range(offset, offset + limit - 1);
    if (userId !== requesterId) query = query.eq('is_public', true);

    const { data: trackingData, error, count } = await query;

    if (error) {
      console.error(`[UserService.getUserHistory] Error fetching daily tracking:`, error);
      throw error;
    }

    const rows = (trackingData || []) as Array<{
      id: string;
      tracking_date: string;
      weight_kg: number | string;
      notes: string | null;
      is_public: boolean | null;
    }>;

    // Newest first; change = this weigh-in − the older one (negative = lost).
    const entries: UserHistoryEntry[] = rows.map((entry, i) => {
      const current = Number(entry.weight_kg);
      const older = i < rows.length - 1 ? Number(rows[i + 1].weight_kg) : null;
      return {
        id: entry.id,
        date: entry.tracking_date,
        weight: current,
        weight_change: older != null ? Math.round((current - older) * 100) / 100 : null,
        is_public: entry.is_public !== false,
        note: entry.notes,
        notes: entry.notes, // the key iOS CheckInEntry reads
      };
    });

    console.log(`[UserService.getUserHistory] Returning ${entries.length} weight entries`);

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
