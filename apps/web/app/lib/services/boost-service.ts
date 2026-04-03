import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface BoostStatus {
  fitcircle_id: string;
  boost_date: string;
  total_members: number;
  checked_in_members: number;
  boost_multiplier: number;
  is_perfect_day: boolean;
  member_statuses: MemberCheckInStatus[];
}

export interface MemberCheckInStatus {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  checked_in: boolean;
}

export interface BoostHistoryEntry {
  boost_date: string;
  total_members: number;
  checked_in_members: number;
  boost_multiplier: number;
  is_perfect_day: boolean;
}

// ============================================================================
// SERVICE
// ============================================================================

export class BoostService {
  /**
   * Recalculate the boost for a circle on a given date.
   * Counts checked-in members and computes the multiplier.
   */
  static async recalculateBoost(fitcircleId: string, date?: string): Promise<BoostStatus> {
    const supabaseAdmin = createAdminSupabase();
    const boostDate = date || new Date().toISOString().split('T')[0];

    console.log(`[BoostService.recalculateBoost] Circle ${fitcircleId} for ${boostDate}`);

    // Get total active members
    const { count: totalMembers, error: countError } = await supabaseAdmin
      .from('fitcircle_members')
      .select('*', { count: 'exact', head: true })
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');

    if (countError) throw countError;
    const total = totalMembers || 0;

    if (total === 0) {
      console.log(`[BoostService.recalculateBoost] No active members, returning default`);
      return {
        fitcircle_id: fitcircleId,
        boost_date: boostDate,
        total_members: 0,
        checked_in_members: 0,
        boost_multiplier: 1.0,
        is_perfect_day: false,
        member_statuses: [],
      };
    }

    // Get all active member IDs
    const { data: members, error: membersError } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');

    if (membersError) throw membersError;
    const memberIds = (members || []).map(m => m.user_id);

    // Count how many members checked in today via circle_check_ins
    const { data: checkIns, error: checkInError } = await supabaseAdmin
      .from('circle_check_ins')
      .select('user_id')
      .eq('circle_id', fitcircleId)
      .eq('check_in_date', boostDate)
      .in('user_id', memberIds);

    if (checkInError) throw checkInError;

    // Also count members who logged a workout that counts_as_checkin today
    const { data: workoutCheckIns, error: workoutError } = await supabaseAdmin
      .from('exercise_logs')
      .select('user_id')
      .in('user_id', memberIds)
      .eq('exercise_date', boostDate)
      .eq('counts_as_checkin', true)
      .eq('is_deleted', false);

    if (workoutError) throw workoutError;

    // Union of users who checked in via either method
    const checkedInUserIds = new Set<string>();
    for (const ci of checkIns || []) checkedInUserIds.add(ci.user_id);
    for (const wc of workoutCheckIns || []) checkedInUserIds.add(wc.user_id);

    const checkedInCount = checkedInUserIds.size;
    const percentage = total > 0 ? checkedInCount / total : 0;
    const isPerfectDay = checkedInCount === total && total > 0;
    const multiplier = this.calculateMultiplier(total, percentage, isPerfectDay);

    // Upsert the boost record
    const { error: upsertError } = await supabaseAdmin
      .from('circle_daily_boosts')
      .upsert(
        {
          fitcircle_id: fitcircleId,
          boost_date: boostDate,
          total_members: total,
          checked_in_members: checkedInCount,
          boost_multiplier: multiplier,
          is_perfect_day: isPerfectDay,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'fitcircle_id,boost_date' }
      );

    if (upsertError) {
      console.error(`[BoostService.recalculateBoost] Upsert error:`, upsertError);
      throw upsertError;
    }

    // Build member status list
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', memberIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    const memberStatuses: MemberCheckInStatus[] = memberIds.map(uid => {
      const profile = profileMap.get(uid);
      return {
        user_id: uid,
        display_name: profile?.display_name || 'Unknown',
        avatar_url: profile?.avatar_url || null,
        checked_in: checkedInUserIds.has(uid),
      };
    });

    console.log(`[BoostService.recalculateBoost] ${checkedInCount}/${total} checked in, multiplier=${multiplier}, perfect=${isPerfectDay}`);

    return {
      fitcircle_id: fitcircleId,
      boost_date: boostDate,
      total_members: total,
      checked_in_members: checkedInCount,
      boost_multiplier: multiplier,
      is_perfect_day: isPerfectDay,
      member_statuses: memberStatuses,
    };
  }

  /**
   * Get today's boost status for a circle.
   */
  static async getBoostStatus(fitcircleId: string): Promise<BoostStatus> {
    return this.recalculateBoost(fitcircleId);
  }

  /**
   * Get boost history for past N days.
   */
  static async getBoostHistory(fitcircleId: string, days: number = 7): Promise<BoostHistoryEntry[]> {
    const supabaseAdmin = createAdminSupabase();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('circle_daily_boosts')
      .select('boost_date, total_members, checked_in_members, boost_multiplier, is_perfect_day')
      .eq('fitcircle_id', fitcircleId)
      .gte('boost_date', startDateStr)
      .order('boost_date', { ascending: false });

    if (error) throw error;

    return (data || []).map(row => ({
      boost_date: row.boost_date,
      total_members: row.total_members,
      checked_in_members: row.checked_in_members,
      boost_multiplier: Number(row.boost_multiplier),
      is_perfect_day: row.is_perfect_day,
    }));
  }

  /**
   * Recalculate boost for ALL circles a user belongs to.
   * Called after a user checks in / logs a workout.
   */
  static async recalculateAllCirclesForUser(userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[BoostService.recalculateAllCirclesForUser] User ${userId}`);

    // Get all active circles this user belongs to
    const { data: memberships, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      console.error(`[BoostService.recalculateAllCirclesForUser] Error:`, error);
      throw error;
    }

    const circleIds = (memberships || []).map(m => m.fitcircle_id);

    if (circleIds.length === 0) {
      console.log(`[BoostService.recalculateAllCirclesForUser] No active circles`);
      return;
    }

    // Recalculate boost for each circle (non-blocking failures)
    for (const circleId of circleIds) {
      try {
        await this.recalculateBoost(circleId);
      } catch (err) {
        console.error(`[BoostService.recalculateAllCirclesForUser] Failed for circle ${circleId}:`, err);
      }
    }

    console.log(`[BoostService.recalculateAllCirclesForUser] Recalculated ${circleIds.length} circles`);
  }

  /**
   * Calculate boost multiplier based on circle size and check-in percentage.
   *
   * Small circles (2-3 members):
   *   50%+ → 1.5x, 100% → 2.0x (no 3x)
   *
   * Regular circles (4+ members):
   *   <50% → 1.0x, >=50% → 1.5x, >=80% → 2.0x, 100% → 3.0x
   */
  private static calculateMultiplier(
    totalMembers: number,
    percentage: number,
    isPerfectDay: boolean
  ): number {
    if (totalMembers <= 3) {
      // Small circle thresholds (no 3x)
      if (isPerfectDay) return 2.0;
      if (percentage >= 0.5) return 1.5;
      return 1.0;
    }

    // Regular circle thresholds (4+)
    if (isPerfectDay) return 3.0;
    if (percentage >= 0.8) return 2.0;
    if (percentage >= 0.5) return 1.5;
    return 1.0;
  }
}
