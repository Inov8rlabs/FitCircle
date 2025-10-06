import { createAdminSupabase } from '../supabase-admin';
import {
  Circle,
  CircleInvite,
  CircleMember,
  CircleCheckIn,
  CircleEncouragement,
  CreateCircleInput,
  GoalInput,
  CheckInInput,
  SendEncouragementInput,
  InviteDetails,
  CheckInResponse,
  LeaderboardEntry,
  CircleStats,
  CircleWithDetails,
  MyCirclesResponse,
  EncouragementWithUser,
  GoalType,
  MilestoneType,
  MAX_HIGH_FIVES_PER_DAY,
  MAX_WEIGHT_LOSS_PER_WEEK_LBS,
  MAX_DAILY_STEPS,
  MAX_WEEKLY_WORKOUTS,
} from '../types/circle';

export class CircleService {
  // ============================================================================
  // CIRCLE MANAGEMENT
  // ============================================================================

  /**
   * Create a new FitCircle
   */
  static async createCircle(userId: string, data: CreateCircleInput): Promise<Circle> {
    const supabaseAdmin = createAdminSupabase();

    // Generate unique invite code
    const inviteCode = await this.generateInviteCode();

    // Create the circle (challenge)
    const { data: circle, error } = await supabaseAdmin
      .from('challenges')
      .insert({
        name: data.name,
        description: data.description,
        created_by: userId,
        start_date: data.start_date,
        end_date: data.end_date,
        invite_code: inviteCode,
        privacy_mode: true,
        auto_accept_invites: true,
        allow_late_join: data.allow_late_join ?? true,
        late_join_deadline: data.late_join_deadline ?? 3,
        participant_count: 1,
        status: this.getCircleStatus(data.start_date, data.end_date),
      })
      .select()
      .single();

    if (error) throw error;

    // Add creator as first member
    await this.addMemberToCircle(userId, circle.id, userId);

    return circle;
  }

  /**
   * Get circle details
   */
  static async getCircle(circleId: string): Promise<CircleWithDetails> {
    const supabaseAdmin = createAdminSupabase();

    const { data: circle, error } = await supabaseAdmin
      .from('challenges')
      .select('*, circle_members(count)')
      .eq('id', circleId)
      .single();

    if (error) throw error;

    const memberCount = circle.circle_members[0]?.count || 0;
    const daysRemaining = this.calculateDaysRemaining(circle.end_date);

    return {
      ...circle,
      member_count: memberCount,
      days_remaining: daysRemaining,
    };
  }

  /**
   * Get all circles for a user
   */
  static async getUserCircles(userId: string): Promise<MyCirclesResponse> {
    const supabaseAdmin = createAdminSupabase();

    // Get all circles where user is a member
    const { data: memberships, error } = await supabaseAdmin
      .from('circle_members')
      .select(`
        circle_id,
        progress_percentage,
        challenges!inner (
          id,
          name,
          description,
          start_date,
          end_date,
          status,
          participant_count,
          invite_code
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw error;

    const now = new Date();
    const active: CircleWithDetails[] = [];
    const upcoming: CircleWithDetails[] = [];
    const completed: CircleWithDetails[] = [];

    for (const membership of memberships || []) {
      const circle = membership.challenges as any;
      const status = this.getCircleStatus(circle.start_date, circle.end_date);

      const circleWithDetails: CircleWithDetails = {
        ...circle,
        status,
        member_count: circle.participant_count || 0,
        days_remaining: this.calculateDaysRemaining(circle.end_date),
        is_member: true,
        user_progress: membership.progress_percentage,
      };

      if (status === 'active') active.push(circleWithDetails);
      else if (status === 'upcoming') upcoming.push(circleWithDetails);
      else if (status === 'completed') completed.push(circleWithDetails);
    }

    return { active, upcoming, completed };
  }

  // ============================================================================
  // INVITE SYSTEM
  // ============================================================================

  /**
   * Generate a unique 9-character invite code
   */
  static async generateInviteCode(): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous characters

    let attempts = 0;
    while (attempts < 10) {
      let code = '';

      // Generate ABC123XYZ format (3 letters, 3 numbers, 3 letters)
      for (let i = 0; i < 3; i++) {
        code += chars[Math.floor(Math.random() * 24)]; // Letters only (first 24 chars)
      }
      for (let i = 0; i < 3; i++) {
        code += chars[24 + Math.floor(Math.random() * 9)]; // Numbers only (last 9 chars)
      }
      for (let i = 0; i < 3; i++) {
        code += chars[Math.floor(Math.random() * 24)]; // Letters only
      }

      // Check uniqueness
      const { data: existing } = await supabaseAdmin
        .from('challenges')
        .select('id')
        .eq('invite_code', code)
        .single();

      if (!existing) {
        return code;
      }

      attempts++;
    }

    throw new Error('Failed to generate unique invite code');
  }

  /**
   * Create an invite for a circle
   */
  static async createInvite(
    circleId: string,
    inviterId: string,
    email?: string
  ): Promise<CircleInvite> {
    const supabaseAdmin = createAdminSupabase();

    // Get circle's invite code
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('invite_code')
      .eq('id', circleId)
      .single();

    if (circleError) throw circleError;

    // Create invite record
    const { data: invite, error } = await supabaseAdmin
      .from('circle_invites')
      .insert({
        circle_id: circleId,
        inviter_id: inviterId,
        invite_code: circle.invite_code,
        email: email || null,
        status: 'pending',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      })
      .select()
      .single();

    if (error) throw error;

    return invite;
  }

  /**
   * Get invite details by code
   */
  static async getInviteByCode(code: string): Promise<InviteDetails> {
    const supabaseAdmin = createAdminSupabase();

    // Normalize code (uppercase, trim)
    const normalizedCode = code.toUpperCase().trim();

    // Find circle with this invite code
    const { data: circle, error } = await supabaseAdmin
      .from('challenges')
      .select(`
        id,
        name,
        description,
        start_date,
        end_date,
        status,
        participant_count,
        allow_late_join,
        late_join_deadline,
        created_by,
        profiles!challenges_created_by_fkey (display_name)
      `)
      .eq('invite_code', normalizedCode)
      .single();

    if (error || !circle) {
      return {
        valid: false,
        error_reason: 'Invalid invite code',
      };
    }

    // Check if circle is still accepting members
    const status = this.getCircleStatus(circle.start_date, circle.end_date);

    if (status === 'completed') {
      return {
        valid: false,
        error_reason: 'This circle has already ended',
      };
    }

    if (status === 'active' && !circle.allow_late_join) {
      return {
        valid: false,
        error_reason: 'This circle has already started and is not accepting new members',
      };
    }

    if (status === 'active' && circle.allow_late_join) {
      const daysSinceStart = this.calculateDaysSince(circle.start_date);
      if (daysSinceStart > circle.late_join_deadline) {
        return {
          valid: false,
          error_reason: `The late join period has ended (was ${circle.late_join_deadline} days)`,
        };
      }
    }

    const startsInDays = status === 'upcoming'
      ? this.calculateDaysUntil(circle.start_date)
      : 0;

    return {
      valid: true,
      circle_name: circle.name,
      circle_description: circle.description,
      starts_in_days: startsInDays,
      member_count: circle.participant_count || 0,
      inviter_name: (circle.profiles as any)?.display_name,
    };
  }

  /**
   * Accept an invite and join the circle
   */
  static async acceptInvite(inviteCode: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Get invite details
    const inviteDetails = await this.getInviteByCode(inviteCode);

    if (!inviteDetails.valid) {
      throw new Error(inviteDetails.error_reason || 'Invalid invite');
    }

    // Find the circle
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('id, created_by')
      .eq('invite_code', inviteCode.toUpperCase().trim())
      .single();

    if (circleError) throw circleError;

    // Update any pending invites for this user
    await supabaseAdmin
      .from('circle_invites')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq('invite_code', inviteCode.toUpperCase().trim())
      .eq('status', 'pending');
  }

  // ============================================================================
  // MEMBER MANAGEMENT
  // ============================================================================

  /**
   * Join a circle with a personal goal
   */
  static async joinCircle(
    userId: string,
    circleId: string,
    inviteCode: string,
    goal: GoalInput
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Verify invite code matches circle
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('invite_code, created_by, start_date')
      .eq('id', circleId)
      .single();

    if (circleError) throw circleError;

    if (circle.invite_code !== inviteCode.toUpperCase().trim()) {
      throw new Error('Invalid invite code for this circle');
    }

    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('circle_members')
      .select('id')
      .eq('circle_id', circleId)
      .eq('user_id', userId)
      .single();

    if (existing) {
      throw new Error('You are already a member of this circle');
    }

    // Validate goal
    this.validateGoal(goal, circle.start_date);

    // Accept the invite
    await this.acceptInvite(inviteCode, userId);

    // Add member with goal
    await this.addMemberToCircle(userId, circleId, circle.created_by, goal);

    // Update participant count
    await supabaseAdmin.rpc('increment', {
      table_name: 'challenges',
      column_name: 'participant_count',
      row_id: circleId,
    });
  }

  /**
   * Set or update personal goal
   */
  static async setPersonalGoal(
    userId: string,
    circleId: string,
    goal: GoalInput
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Get member record
    const { data: member, error: memberError } = await supabaseAdmin
      .from('circle_members')
      .select('id, goal_locked_at')
      .eq('circle_id', circleId)
      .eq('user_id', userId)
      .single();

    if (memberError) throw memberError;

    // Check if goal is locked
    if (member.goal_locked_at) {
      throw new Error('Goal is locked and cannot be changed after circle starts');
    }

    // Get circle start date
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('start_date')
      .eq('id', circleId)
      .single();

    if (circleError) throw circleError;

    // Validate goal
    this.validateGoal(goal, circle.start_date);

    // Update goal
    const { error: updateError } = await supabaseAdmin
      .from('circle_members')
      .update({
        goal_type: goal.goal_type,
        goal_start_value: goal.goal_start_value,
        goal_target_value: goal.goal_target_value,
        goal_unit: goal.goal_unit,
        goal_description: goal.goal_description,
        current_value: goal.goal_start_value,
        updated_at: new Date().toISOString(),
      })
      .eq('id', member.id);

    if (updateError) throw updateError;
  }

  /**
   * Get circle members
   */
  static async getCircleMembers(circleId: string): Promise<CircleMember[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data: members, error } = await supabaseAdmin
      .from('circle_members')
      .select('*')
      .eq('circle_id', circleId)
      .eq('is_active', true)
      .order('joined_at', { ascending: true });

    if (error) throw error;

    return members || [];
  }

  // ============================================================================
  // PROGRESS TRACKING
  // ============================================================================

  /**
   * Submit a daily check-in
   */
  static async submitCheckIn(
    userId: string,
    circleId: string,
    input: CheckInInput
  ): Promise<CheckInResponse> {
    const supabaseAdmin = createAdminSupabase();

    // Get member record
    const { data: member, error: memberError } = await supabaseAdmin
      .from('circle_members')
      .select('*')
      .eq('circle_id', circleId)
      .eq('user_id', userId)
      .single();

    if (memberError) throw memberError;

    // Check if already checked in today
    const today = new Date().toISOString().split('T')[0];
    const { data: existingCheckIn } = await supabaseAdmin
      .from('circle_check_ins')
      .select('id')
      .eq('member_id', member.id)
      .eq('check_in_date', today)
      .single();

    if (existingCheckIn) {
      throw new Error('You have already checked in today');
    }

    // Calculate new progress
    const newProgress = this.calculateProgress(member, input.value);

    // Get previous rank
    const previousRank = await this.getUserRank(userId, circleId);

    // Create check-in
    const { error: checkInError } = await supabaseAdmin
      .from('circle_check_ins')
      .insert({
        member_id: member.id,
        circle_id: circleId,
        user_id: userId,
        check_in_date: today,
        check_in_value: input.value,
        progress_percentage: newProgress,
        mood_score: input.mood_score,
        energy_level: input.energy_level,
        note: input.note,
      });

    if (checkInError) throw checkInError;

    // Update member stats
    const newStreak = await this.calculateStreak(member.id);
    const { error: updateError } = await supabaseAdmin
      .from('circle_members')
      .update({
        current_value: input.value,
        progress_percentage: newProgress,
        total_check_ins: member.total_check_ins + 1,
        streak_days: newStreak,
        longest_streak: Math.max(newStreak, member.longest_streak),
        last_check_in_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', member.id);

    if (updateError) throw updateError;

    // Get new rank
    const newRank = await this.getUserRank(userId, circleId);
    const rankChange = previousRank - newRank;

    // Check for milestones
    const milestone = this.checkMilestone(newProgress, member.progress_percentage, newStreak, member.streak_days);

    // Create milestone encouragement if reached
    if (milestone) {
      await this.createMilestoneEncouragement(circleId, userId, milestone);
    }

    return {
      progress_percentage: newProgress,
      rank_change: rankChange,
      streak_days: newStreak,
      milestone_reached: milestone,
      new_rank: newRank,
    };
  }

  /**
   * Calculate progress percentage
   */
  static calculateProgress(member: CircleMember, currentValue: number): number {
    if (!member.goal_type || !member.goal_target_value) {
      return 0;
    }

    let progress = 0;

    if (member.goal_type === 'weight_loss') {
      // For decreasing metrics
      const startValue = member.goal_start_value || 0;
      const targetValue = member.goal_target_value;

      if (startValue === targetValue) {
        progress = 100;
      } else {
        progress = ((startValue - currentValue) / (startValue - targetValue)) * 100;
      }
    } else {
      // For increasing metrics
      if (member.goal_target_value === 0) {
        progress = 0;
      } else {
        progress = (currentValue / member.goal_target_value) * 100;
      }
    }

    // Cap at 0-100 range
    return Math.min(100, Math.max(0, Math.round(progress * 10) / 10));
  }

  /**
   * Update member progress
   */
  static async updateMemberProgress(userId: string, circleId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Get member with latest check-in
    const { data: member, error: memberError } = await supabaseAdmin
      .from('circle_members')
      .select(`
        *,
        circle_check_ins (
          check_in_value,
          check_in_date
        )
      `)
      .eq('circle_id', circleId)
      .eq('user_id', userId)
      .order('circle_check_ins.check_in_date', { ascending: false })
      .limit(1)
      .single();

    if (memberError) throw memberError;

    if (member.circle_check_ins && member.circle_check_ins.length > 0) {
      const latestValue = member.circle_check_ins[0].check_in_value;
      const newProgress = this.calculateProgress(member, latestValue);

      await supabaseAdmin
        .from('circle_members')
        .update({
          current_value: latestValue,
          progress_percentage: newProgress,
          updated_at: new Date().toISOString(),
        })
        .eq('id', member.id);
    }
  }

  // ============================================================================
  // LEADERBOARD
  // ============================================================================

  /**
   * Get privacy-safe leaderboard
   */
  static async getLeaderboard(circleId: string): Promise<LeaderboardEntry[]> {
    const supabaseAdmin = createAdminSupabase();

    // Get all active members with their profiles
    const { data: members, error } = await supabaseAdmin
      .from('circle_members')
      .select(`
        user_id,
        progress_percentage,
        streak_days,
        last_check_in_at,
        total_check_ins,
        total_high_fives_received,
        privacy_settings,
        joined_at,
        profiles!inner (
          display_name,
          avatar_url
        )
      `)
      .eq('circle_id', circleId)
      .eq('is_active', true);

    if (error) throw error;

    // Filter out members who chose to hide from leaderboard
    const visibleMembers = (members || []).filter(
      m => !m.privacy_settings?.hide_from_leaderboard
    );

    // Sort by progress, then by consistency, then by total check-ins, then by join date
    const sorted = visibleMembers.sort((a, b) => {
      // Primary: Progress percentage
      if (a.progress_percentage !== b.progress_percentage) {
        return b.progress_percentage - a.progress_percentage;
      }

      // Secondary: Total check-ins (consistency)
      if (a.total_check_ins !== b.total_check_ins) {
        return b.total_check_ins - a.total_check_ins;
      }

      // Tertiary: Streak days
      if (a.streak_days !== b.streak_days) {
        return b.streak_days - a.streak_days;
      }

      // Quaternary: Join date (earlier is better)
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });

    // Check if checked in today
    const today = new Date().toISOString().split('T')[0];

    return sorted.map((member, index) => ({
      rank: index + 1,
      user_id: member.user_id,
      display_name: (member.profiles as any).display_name,
      avatar_url: (member.profiles as any).avatar_url,
      progress_percentage: member.progress_percentage,
      streak_days: member.privacy_settings?.hide_streak ? 0 : member.streak_days,
      last_check_in_at: member.last_check_in_at,
      checked_in_today: member.last_check_in_at
        ? new Date(member.last_check_in_at).toISOString().split('T')[0] === today
        : false,
      high_fives_received: member.total_high_fives_received,
    }));
  }

  /**
   * Get user's rank in a circle
   */
  static async getMyRank(userId: string, circleId: string): Promise<number> {
    const leaderboard = await this.getLeaderboard(circleId);
    const entry = leaderboard.find(e => e.user_id === userId);
    return entry?.rank || 0;
  }

  /**
   * Internal helper to get user rank
   */
  private static async getUserRank(userId: string, circleId: string): Promise<number> {
    return this.getMyRank(userId, circleId);
  }

  // ============================================================================
  // SOCIAL FEATURES
  // ============================================================================

  /**
   * Send encouragement (high-five, message, cheer)
   */
  static async sendEncouragement(
    fromUserId: string,
    circleId: string,
    input: SendEncouragementInput
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Check if sender is a member
    const { data: sender } = await supabaseAdmin
      .from('circle_members')
      .select('id')
      .eq('circle_id', circleId)
      .eq('user_id', fromUserId)
      .single();

    if (!sender) {
      throw new Error('You must be a member of this circle to send encouragement');
    }

    // Check high-five daily limit
    if (input.type === 'high_five') {
      const today = new Date().toISOString().split('T')[0];

      // Get or create daily limit record
      const { data: limit, error: limitError } = await supabaseAdmin
        .from('daily_high_five_limits')
        .select('count')
        .eq('user_id', fromUserId)
        .eq('circle_id', circleId)
        .eq('date', today)
        .single();

      if (limitError && limitError.code !== 'PGRST116') throw limitError; // PGRST116 = not found

      const currentCount = limit?.count || 0;

      if (currentCount >= MAX_HIGH_FIVES_PER_DAY) {
        throw new Error(`You've reached your daily limit of ${MAX_HIGH_FIVES_PER_DAY} high-fives`);
      }

      // Update or insert limit record
      if (limit) {
        await supabaseAdmin
          .from('daily_high_five_limits')
          .update({ count: currentCount + 1 })
          .eq('user_id', fromUserId)
          .eq('circle_id', circleId)
          .eq('date', today);
      } else {
        await supabaseAdmin
          .from('daily_high_five_limits')
          .insert({
            user_id: fromUserId,
            circle_id: circleId,
            date: today,
            count: 1,
          });
      }

      // Update recipient's high-five count if specified
      if (input.to_user_id) {
        await supabaseAdmin.rpc('increment', {
          table_name: 'circle_members',
          column_name: 'total_high_fives_received',
          row_id: input.to_user_id,
        });
      }
    }

    // Create encouragement
    const { error } = await supabaseAdmin
      .from('circle_encouragements')
      .insert({
        circle_id: circleId,
        from_user_id: fromUserId,
        to_user_id: input.to_user_id,
        type: input.type,
        content: input.content,
        milestone_type: input.milestone_type,
      });

    if (error) throw error;
  }

  /**
   * Get encouragements for a circle
   */
  static async getEncouragements(
    circleId: string,
    userId?: string
  ): Promise<EncouragementWithUser[]> {
    const supabaseAdmin = createAdminSupabase();

    let query = supabaseAdmin
      .from('circle_encouragements')
      .select(`
        *,
        from_user:profiles!circle_encouragements_from_user_id_fkey (
          id,
          display_name,
          avatar_url
        ),
        to_user:profiles!circle_encouragements_to_user_id_fkey (
          id,
          display_name,
          avatar_url
        )
      `)
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (userId) {
      query = query.or(`to_user_id.eq.${userId},to_user_id.is.null`);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Add a member to a circle
   */
  private static async addMemberToCircle(
    userId: string,
    circleId: string,
    invitedBy: string,
    goal?: GoalInput
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_members')
      .insert({
        circle_id: circleId,
        user_id: userId,
        invited_by: invitedBy,
        goal_type: goal?.goal_type,
        goal_start_value: goal?.goal_start_value,
        goal_target_value: goal?.goal_target_value,
        goal_unit: goal?.goal_unit,
        goal_description: goal?.goal_description,
        current_value: goal?.goal_start_value,
        progress_percentage: 0,
      });

    if (error) throw error;
  }

  /**
   * Calculate streak days
   */
  private static async calculateStreak(memberId: string): Promise<number> {
    const supabaseAdmin = createAdminSupabase();

    // Get last 30 check-ins
    const { data: checkIns, error } = await supabaseAdmin
      .from('circle_check_ins')
      .select('check_in_date')
      .eq('member_id', memberId)
      .order('check_in_date', { ascending: false })
      .limit(30);

    if (error || !checkIns || checkIns.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 30; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      const hasCheckIn = checkIns.some(c => c.check_in_date === targetDateStr);

      if (hasCheckIn) {
        streak++;
      } else if (i > 0) {
        break; // Streak broken
      }
    }

    return streak;
  }

  /**
   * Check for milestone achievements
   */
  private static checkMilestone(
    newProgress: number,
    oldProgress: number,
    newStreak: number,
    oldStreak: number
  ): MilestoneType | undefined {
    // Check progress milestones
    if (oldProgress < 100 && newProgress >= 100) return 'progress_100';
    if (oldProgress < 75 && newProgress >= 75) return 'progress_75';
    if (oldProgress < 50 && newProgress >= 50) return 'progress_50';
    if (oldProgress < 25 && newProgress >= 25) return 'progress_25';

    // Check streak milestones
    if (oldStreak < 30 && newStreak >= 30) return 'streak_30';
    if (oldStreak < 14 && newStreak >= 14) return 'streak_14';
    if (oldStreak < 7 && newStreak >= 7) return 'streak_7';

    return undefined;
  }

  /**
   * Create milestone encouragement
   */
  private static async createMilestoneEncouragement(
    circleId: string,
    userId: string,
    milestone: MilestoneType
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    await supabaseAdmin
      .from('circle_encouragements')
      .insert({
        circle_id: circleId,
        from_user_id: userId,
        to_user_id: null, // Circle-wide celebration
        type: 'milestone',
        milestone_type: milestone,
      });
  }

  /**
   * Validate goal input
   */
  private static validateGoal(goal: GoalInput, startDate: string): void {
    if (!goal.goal_type || !goal.goal_target_value) {
      throw new Error('Goal type and target value are required');
    }

    // Calculate challenge duration in weeks
    const start = new Date(startDate);
    const now = new Date();
    const endEstimate = new Date(start);
    endEstimate.setDate(endEstimate.getDate() + 30); // Assume 30-day challenge
    const weeks = Math.ceil((endEstimate.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));

    if (goal.goal_type === 'weight_loss') {
      if (goal.goal_start_value && goal.goal_target_value) {
        const totalLoss = goal.goal_start_value - goal.goal_target_value;
        const weeklyLoss = totalLoss / weeks;

        if (weeklyLoss > MAX_WEIGHT_LOSS_PER_WEEK_LBS) {
          throw new Error(`For healthy weight loss, aim for maximum ${MAX_WEIGHT_LOSS_PER_WEEK_LBS} lbs per week`);
        }
      }
    }

    if (goal.goal_type === 'step_count') {
      if (goal.goal_target_value > MAX_DAILY_STEPS) {
        throw new Error(`Daily step goal cannot exceed ${MAX_DAILY_STEPS} steps`);
      }
    }

    if (goal.goal_type === 'workout_frequency') {
      if (goal.goal_target_value > MAX_WEEKLY_WORKOUTS) {
        throw new Error(`Weekly workout goal cannot exceed ${MAX_WEEKLY_WORKOUTS} sessions`);
      }
    }
  }

  /**
   * Get circle status based on dates
   */
  private static getCircleStatus(startDate: string, endDate: string): 'upcoming' | 'active' | 'completed' {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (now < start) return 'upcoming';
    if (now > end) return 'completed';
    return 'active';
  }

  /**
   * Calculate days remaining
   */
  private static calculateDaysRemaining(endDate: string): number {
    const now = new Date();
    const end = new Date(endDate);
    const diff = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  }

  /**
   * Calculate days until start
   */
  private static calculateDaysUntil(startDate: string): number {
    const now = new Date();
    const start = new Date(startDate);
    const diff = start.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  }

  /**
   * Calculate days since start
   */
  private static calculateDaysSince(startDate: string): number {
    const now = new Date();
    const start = new Date(startDate);
    const diff = now.getTime() - start.getTime();
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
  }

  /**
   * Get circle statistics
   */
  static async getCircleStats(circleId: string): Promise<CircleStats> {
    const members = await this.getCircleMembers(circleId);

    if (members.length === 0) {
      return {
        average_progress: 0,
        total_check_ins: 0,
        completion_rate: 0,
        average_streak: 0,
      };
    }

    const totalProgress = members.reduce((sum, m) => sum + m.progress_percentage, 0);
    const totalCheckIns = members.reduce((sum, m) => sum + m.total_check_ins, 0);
    const completedMembers = members.filter(m => m.progress_percentage >= 100).length;
    const totalStreak = members.reduce((sum, m) => sum + m.streak_days, 0);

    const mostConsistent = members.sort((a, b) => b.total_check_ins - a.total_check_ins)[0];

    return {
      average_progress: Math.round((totalProgress / members.length) * 10) / 10,
      total_check_ins: totalCheckIns,
      completion_rate: Math.round((completedMembers / members.length) * 100) / 100,
      average_streak: Math.round((totalStreak / members.length) * 10) / 10,
      most_consistent_member_id: mostConsistent?.user_id,
    };
  }
}