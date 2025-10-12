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
        creator_id: userId,
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

    console.log(`[CircleService.getCircle] Fetching circle: ${circleId}`);

    // Get circle data
    const { data: circle, error } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .eq('id', circleId)
      .single();

    if (error) throw error;
    console.log(`[CircleService.getCircle] Circle found: ${circle.name}, stored participant_count: ${circle.participant_count}`);

    // Get actual member count from challenge_participants table (the actual table used)
    console.log(`[CircleService.getCircle] Querying challenge_participants for challenge_id: ${circleId}`);
    const { count: memberCount, error: countError } = await supabaseAdmin
      .from('challenge_participants')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', circleId)
      .eq('status', 'active');

    if (countError) {
      console.error(`[CircleService.getCircle] Error counting members:`, countError);
      throw countError;
    }

    console.log(`[CircleService.getCircle] Member count query result: ${memberCount} active members`);

    // Also query without status filter to see total
    const { count: totalMembers } = await supabaseAdmin
      .from('challenge_participants')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', circleId);

    console.log(`[CircleService.getCircle] Total members (all statuses): ${totalMembers}`);

    const daysRemaining = this.calculateDaysRemaining(circle.end_date);

    return {
      ...circle,
      participant_count: memberCount || 0, // Update the stored count field
      member_count: memberCount || 0,
      days_remaining: daysRemaining,
    };
  }

  /**
   * Get all circles for a user
   */
  static async getUserCircles(userId: string): Promise<MyCirclesResponse> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[CircleService.getUserCircles] Fetching circles for user: ${userId}`);

    // Get all circles where user is a participant (using challenge_participants table)
    const { data: memberships, error } = await supabaseAdmin
      .from('challenge_participants')
      .select(`
        challenge_id,
        progress_percentage,
        challenges!inner (
          id,
          name,
          description,
          start_date,
          end_date,
          status,
          participant_count,
          invite_code,
          creator_id
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      console.error(`[CircleService.getUserCircles] Error querying challenge_participants:`, error);
      throw error;
    }

    console.log(`[CircleService.getUserCircles] Found ${memberships?.length || 0} memberships`);

    const now = new Date();
    const active: CircleWithDetails[] = [];
    const upcoming: CircleWithDetails[] = [];
    const completed: CircleWithDetails[] = [];

    for (const membership of memberships || []) {
      const circle = membership.challenges as any;
      const status = this.getCircleStatus(circle.start_date, circle.end_date);

      console.log(`[CircleService.getUserCircles] Processing circle: ${circle.name} (${circle.id})`);

      // Get actual member count for this circle from challenge_participants
      const { count: actualMemberCount, error: countError } = await supabaseAdmin
        .from('challenge_participants')
        .select('*', { count: 'exact', head: true })
        .eq('challenge_id', circle.id)
        .eq('status', 'active');

      if (countError) {
        console.error(`[CircleService.getUserCircles] Error counting members for circle ${circle.id}:`, countError);
      }

      console.log(`[CircleService.getUserCircles] Circle ${circle.name} has ${actualMemberCount} active participants`);

      const circleWithDetails: CircleWithDetails = {
        ...circle,
        status,
        participant_count: actualMemberCount || 0,
        member_count: actualMemberCount || 0,
        days_remaining: this.calculateDaysRemaining(circle.end_date),
        is_member: true,
        user_progress: membership.progress_percentage,
      };

      if (status === 'active') active.push(circleWithDetails);
      else if (status === 'upcoming') upcoming.push(circleWithDetails);
      else if (status === 'completed') completed.push(circleWithDetails);
    }

    console.log(`[CircleService.getUserCircles] Returning: ${active.length} active, ${upcoming.length} upcoming, ${completed.length} completed`);

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
        creator_id,
        profiles!challenges_creator_id_fkey (display_name)
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
      .select('id, creator_id')
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

    console.log(`[CircleService.joinCircle] User ${userId} attempting to join circle ${circleId}`);

    // Verify invite code matches circle
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('invite_code, creator_id, start_date')
      .eq('id', circleId)
      .single();

    if (circleError) {
      console.error(`[CircleService.joinCircle] Error fetching circle:`, circleError);
      throw circleError;
    }

    if (circle.invite_code !== inviteCode.toUpperCase().trim()) {
      console.error(`[CircleService.joinCircle] Invalid invite code`);
      throw new Error('Invalid invite code for this circle');
    }

    // Check if already a member (using challenge_participants table)
    const { data: existing } = await supabaseAdmin
      .from('challenge_participants')
      .select('id')
      .eq('challenge_id', circleId)
      .eq('user_id', userId)
      .single();

    if (existing) {
      console.log(`[CircleService.joinCircle] User is already a member`);
      throw new Error('You are already a member of this circle');
    }

    // Validate goal
    this.validateGoal(goal, circle.start_date);

    // Accept the invite
    await this.acceptInvite(inviteCode, userId);

    // Add member with goal
    await this.addMemberToCircle(userId, circleId, circle.creator_id, goal);

    // Update participant count
    await supabaseAdmin.rpc('increment', {
      table_name: 'challenges',
      column_name: 'participant_count',
      row_id: circleId,
    });

    console.log(`[CircleService.joinCircle] Successfully added user to circle`);
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

    console.log(`[CircleService.setPersonalGoal] Setting goal for user ${userId} in circle ${circleId}`);

    // Get member record (using challenge_participants table)
    const { data: member, error: memberError } = await supabaseAdmin
      .from('challenge_participants')
      .select('id, goal_locked_at')
      .eq('challenge_id', circleId)
      .eq('user_id', userId)
      .single();

    if (memberError) {
      console.error(`[CircleService.setPersonalGoal] Error fetching participant:`, memberError);
      throw memberError;
    }

    // Check if goal is locked
    if (member.goal_locked_at) {
      console.log(`[CircleService.setPersonalGoal] Goal is locked for this participant`);
      throw new Error('Goal is locked and cannot be changed after circle starts');
    }

    // Get circle start date
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('start_date')
      .eq('id', circleId)
      .single();

    if (circleError) {
      console.error(`[CircleService.setPersonalGoal] Error fetching circle:`, circleError);
      throw circleError;
    }

    // Validate goal
    this.validateGoal(goal, circle.start_date);

    // Update goal in challenge_participants table
    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
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

    if (updateError) {
      console.error(`[CircleService.setPersonalGoal] Error updating goal:`, updateError);
      throw updateError;
    }

    console.log(`[CircleService.setPersonalGoal] Successfully updated goal`);
  }

  /**
   * Get circle members
   */
  static async getCircleMembers(circleId: string): Promise<CircleMember[]> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[CircleService.getCircleMembers] Fetching members for circle: ${circleId}`);

    const { data: members, error } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', circleId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });

    if (error) {
      console.error(`[CircleService.getCircleMembers] Error querying challenge_participants:`, error);
      throw error;
    }

    console.log(`[CircleService.getCircleMembers] Found ${members?.length || 0} active members`);

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

    console.log(`[CircleService.submitCheckIn] User ${userId} checking in for circle ${circleId}`);

    // Get member record (using challenge_participants table)
    const { data: member, error: memberError } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', circleId)
      .eq('user_id', userId)
      .single();

    if (memberError) {
      console.error(`[CircleService.submitCheckIn] Error fetching participant:`, memberError);
      throw memberError;
    }

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

    // Update member stats in challenge_participants table
    const newStreak = await this.calculateStreak(member.id);
    console.log(`[CircleService.submitCheckIn] Updating participant stats: progress=${newProgress}%, streak=${newStreak}`);

    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
      .update({
        current_value: input.value,
        progress_percentage: newProgress,
        check_ins_count: member.check_ins_count + 1,
        streak_days: newStreak,
        longest_streak: Math.max(newStreak, member.longest_streak),
        last_check_in_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', member.id);

    if (updateError) {
      console.error(`[CircleService.submitCheckIn] Error updating participant:`, updateError);
      throw updateError;
    }

    console.log(`[CircleService.submitCheckIn] Successfully updated participant stats`);

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

    console.log(`[CircleService.updateMemberProgress] Updating progress for user ${userId} in circle ${circleId}`);

    // Get member with latest check-in (using challenge_participants table)
    const { data: member, error: memberError } = await supabaseAdmin
      .from('challenge_participants')
      .select(`
        *,
        circle_check_ins (
          check_in_value,
          check_in_date
        )
      `)
      .eq('challenge_id', circleId)
      .eq('user_id', userId)
      .order('circle_check_ins.check_in_date', { ascending: false })
      .limit(1)
      .single();

    if (memberError) {
      console.error(`[CircleService.updateMemberProgress] Error fetching participant:`, memberError);
      throw memberError;
    }

    if (member.circle_check_ins && member.circle_check_ins.length > 0) {
      const latestValue = member.circle_check_ins[0].check_in_value;
      const newProgress = this.calculateProgress(member, latestValue);

      console.log(`[CircleService.updateMemberProgress] Calculated progress: ${newProgress}%`);

      await supabaseAdmin
        .from('challenge_participants')
        .update({
          current_value: latestValue,
          progress_percentage: newProgress,
          updated_at: new Date().toISOString(),
        })
        .eq('id', member.id);

      console.log(`[CircleService.updateMemberProgress] Successfully updated participant progress`);
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

    console.log(`[CircleService.getLeaderboard] Fetching leaderboard for circle: ${circleId}`);

    // Get all active members with their profiles (using challenge_participants table)
    const { data: members, error} = await supabaseAdmin
      .from('challenge_participants')
      .select(`
        user_id,
        progress_percentage,
        streak_days,
        last_check_in_at,
        check_ins_count,
        joined_at,
        current_value,
        goal_start_value,
        goal_target_value,
        goal_type,
        goal_unit,
        profiles!challenge_participants_user_id_fkey (
          display_name,
          avatar_url
        )
      `)
      .eq('challenge_id', circleId)
      .eq('status', 'active');

    if (error) {
      console.error(`[CircleService.getLeaderboard] Error querying challenge_participants:`, error);
      throw error;
    }

    console.log(`[CircleService.getLeaderboard] Found ${members?.length || 0} active participants`);

    // Sort by progress, then by consistency, then by total check-ins, then by join date
    const sorted = (members || []).sort((a, b) => {
      // Primary: Progress percentage
      if (a.progress_percentage !== b.progress_percentage) {
        return b.progress_percentage - a.progress_percentage;
      }

      // Secondary: Total check-ins (consistency)
      if (a.check_ins_count !== b.check_ins_count) {
        return b.check_ins_count - a.check_ins_count;
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
      streak_days: member.streak_days,
      last_check_in_at: member.last_check_in_at,
      checked_in_today: member.last_check_in_at
        ? new Date(member.last_check_in_at).toISOString().split('T')[0] === today
        : false,
      high_fives_received: 0, // TODO: Calculate from circle_encouragements table
      current_value: member.current_value,
      starting_value: member.goal_start_value,
      target_value: member.goal_target_value,
      goal_type: member.goal_type,
      goal_unit: member.goal_unit,
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

    console.log(`[CircleService.sendEncouragement] User ${fromUserId} sending encouragement in circle ${circleId}`);

    // Check if sender is a member (using challenge_participants table)
    const { data: sender } = await supabaseAdmin
      .from('challenge_participants')
      .select('id')
      .eq('challenge_id', circleId)
      .eq('user_id', fromUserId)
      .single();

    if (!sender) {
      console.log(`[CircleService.sendEncouragement] User is not a member of this circle`);
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
        console.log(`[CircleService.sendEncouragement] Incrementing high-fives for user ${input.to_user_id}`);
        await supabaseAdmin.rpc('increment', {
          table_name: 'challenge_participants',
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

    console.log(`[CircleService.addMemberToCircle] Adding user ${userId} to circle ${circleId}`);

    const { error } = await supabaseAdmin
      .from('challenge_participants')
      .insert({
        challenge_id: circleId,
        user_id: userId,
        invited_by: invitedBy,
        goal_type: goal?.goal_type,
        goal_start_value: goal?.goal_start_value,
        goal_target_value: goal?.goal_target_value,
        goal_unit: goal?.goal_unit,
        goal_description: goal?.goal_description,
        current_value: goal?.goal_start_value,
        progress_percentage: 0,
        status: 'active',
      });

    if (error) {
      console.error(`[CircleService.addMemberToCircle] Error inserting into challenge_participants:`, error);
      throw error;
    }

    console.log(`[CircleService.addMemberToCircle] Successfully added user to challenge_participants`);
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
        check_ins_count: 0,
        completion_rate: 0,
        average_streak: 0,
      };
    }

    const totalProgress = members.reduce((sum, m) => sum + m.progress_percentage, 0);
    const totalCheckIns = members.reduce((sum, m) => sum + m.check_ins_count, 0);
    const completedMembers = members.filter(m => m.progress_percentage >= 100).length;
    const totalStreak = members.reduce((sum, m) => sum + m.streak_days, 0);

    const mostConsistent = members.sort((a, b) => b.check_ins_count - a.check_ins_count)[0];

    return {
      average_progress: Math.round((totalProgress / members.length) * 10) / 10,
      check_ins_count: totalCheckIns,
      completion_rate: Math.round((completedMembers / members.length) * 100) / 100,
      average_streak: Math.round((totalStreak / members.length) * 10) / 10,
      most_consistent_member_id: mostConsistent?.user_id,
    };
  }
}