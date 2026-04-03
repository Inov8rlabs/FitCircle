import { createAdminSupabase } from '../supabase-admin';
import {
  CircleChallenge,
  CircleChallengeParticipant,
  CircleChallengeLog,
  CircleChallengeWithDetails,
  ChallengeLeaderboardEntry,
  LogActivityResponse,
  ChallengeListResponse,
  CreateCircleChallengeInput,
  LogActivityInput,
  MAX_LOGS_PER_DAY,
  MAX_LOG_AMOUNT,
  MIN_LOG_AMOUNT,
  DUPLICATE_DETECTION_WINDOW_MS,
  STREAK_GRACE_HOURS,
  MILESTONES,
  MilestoneThreshold,
} from '../types/circle-challenge';
import { getTemplateById } from '../data/challenge-templates';

export class ChallengeService {
  // ============================================================================
  // CHALLENGE CRUD
  // ============================================================================

  static async createChallenge(
    userId: string,
    input: CreateCircleChallengeInput
  ): Promise<CircleChallengeWithDetails> {
    const supabaseAdmin = createAdminSupabase();

    // Verify user is a member of the circle
    await this.verifyCircleMembership(userId, input.fitcircle_id);

    // Sanitize inputs
    const name = input.name.trim().slice(0, 50);
    const description = input.description?.trim().slice(0, 200) || null;

    if (name.length < 3) {
      throw new Error('Challenge name must be at least 3 characters');
    }

    // Create the challenge
    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .insert({
        fitcircle_id: input.fitcircle_id,
        creator_id: userId,
        template_id: input.template_id || null,
        name,
        description,
        category: input.category,
        goal_amount: input.goal_amount,
        unit: input.unit.trim().slice(0, 20),
        logging_prompt: input.logging_prompt?.trim().slice(0, 60) || null,
        is_open: input.is_open ?? true,
        status: new Date(input.starts_at) <= new Date() ? 'active' : 'scheduled',
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        participant_count: 1,
      })
      .select()
      .single();

    if (error) throw error;

    // Add creator as first participant
    await this.addParticipant(challenge.id, userId, input.fitcircle_id, userId);

    // Send invites to specified users
    if (input.invite_user_ids && input.invite_user_ids.length > 0) {
      await this.inviteUsers(challenge.id, userId, input.invite_user_ids);
    }

    return this.enrichChallenge(challenge, userId);
  }

  static async getChallenge(
    challengeId: string,
    userId: string
  ): Promise<CircleChallengeWithDetails> {
    const supabaseAdmin = createAdminSupabase();

    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    if (error) throw error;

    return this.enrichChallenge(challenge, userId);
  }

  static async getCircleChallenges(
    circleId: string,
    userId: string
  ): Promise<ChallengeListResponse> {
    const supabaseAdmin = createAdminSupabase();

    // Verify membership
    await this.verifyCircleMembership(userId, circleId);

    const { data: challenges, error } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .eq('fitcircle_id', circleId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = await Promise.all(
      (challenges || []).map(c => this.enrichChallenge(c, userId))
    );

    return {
      active: enriched.filter(c => c.status === 'active'),
      scheduled: enriched.filter(c => c.status === 'scheduled'),
      completed: enriched.filter(c => c.status === 'completed'),
    };
  }

  static async updateChallenge(
    challengeId: string,
    userId: string,
    updates: Partial<Pick<CircleChallenge, 'name' | 'description' | 'is_open' | 'starts_at' | 'ends_at' | 'goal_amount'>>
  ): Promise<CircleChallengeWithDetails> {
    const supabaseAdmin = createAdminSupabase();

    // Verify creator and pre-start status
    const challenge = await this.getRawChallenge(challengeId);
    if (challenge.creator_id !== userId) {
      throw new Error('Only the creator can update this challenge');
    }
    if (challenge.status !== 'scheduled') {
      throw new Error('Can only update challenges that have not started');
    }

    const { data: updated, error } = await supabaseAdmin
      .from('challenges')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', challengeId)
      .select()
      .single();

    if (error) throw error;

    return this.enrichChallenge(updated, userId);
  }

  static async cancelChallenge(challengeId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const challenge = await this.getRawChallenge(challengeId);
    if (challenge.creator_id !== userId) {
      throw new Error('Only the creator can cancel this challenge');
    }
    if (challenge.status === 'completed') {
      throw new Error('Cannot cancel a completed challenge');
    }

    const { error } = await supabaseAdmin
      .from('challenges')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', challengeId);

    if (error) throw error;
  }

  // ============================================================================
  // PARTICIPANT MANAGEMENT
  // ============================================================================

  static async joinChallenge(
    challengeId: string,
    userId: string
  ): Promise<CircleChallengeParticipant> {
    const challenge = await this.getRawChallenge(challengeId);

    // Verify user is a circle member
    await this.verifyCircleMembership(userId, challenge.fitcircle_id);

    // Check challenge is joinable
    if (challenge.status === 'completed' || challenge.status === 'cancelled') {
      throw new Error('This challenge is no longer accepting participants');
    }

    if (!challenge.is_open) {
      // Check if user was invited
      const supabaseAdmin = createAdminSupabase();
      const { data: invite } = await supabaseAdmin
        .from('challenge_invites')
        .select('id')
        .eq('challenge_id', challengeId)
        .eq('invitee_id', userId)
        .eq('status', 'pending')
        .single();

      if (!invite) {
        throw new Error('This challenge is invite-only');
      }

      // Accept the invite
      await supabaseAdmin
        .from('challenge_invites')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('challenge_id', challengeId)
        .eq('invitee_id', userId);
    }

    return this.addParticipant(challengeId, userId, challenge.fitcircle_id);
  }

  static async withdrawFromChallenge(
    challengeId: string,
    userId: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('challenge_participants')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw error;

    // Update participant count
    await this.updateParticipantCount(challengeId);

    // Recalculate ranks
    await this.recalculateRanks(challengeId);
  }

  static async inviteUsers(
    challengeId: string,
    inviterId: string,
    inviteeIds: string[]
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const invites = inviteeIds
      .filter(id => id !== inviterId)
      .map(inviteeId => ({
        challenge_id: challengeId,
        inviter_id: inviterId,
        invitee_id: inviteeId,
        status: 'pending',
      }));

    if (invites.length === 0) return;

    const { error } = await supabaseAdmin
      .from('challenge_invites')
      .upsert(invites, { onConflict: 'challenge_id,invitee_id' });

    if (error) throw error;
  }

  static async getMyInvites(
    userId: string,
    circleId?: string
  ): Promise<any[]> {
    const supabaseAdmin = createAdminSupabase();

    let query = supabaseAdmin
      .from('challenge_invites')
      .select(`
        *,
        challenges!inner (
          id, name, category, goal_amount, unit, starts_at, ends_at, status, fitcircle_id
        ),
        profiles!challenge_invites_inviter_id_fkey (display_name, avatar_url)
      `)
      .eq('invitee_id', userId)
      .eq('status', 'pending');

    if (circleId) {
      query = query.eq('challenges.fitcircle_id', circleId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // ============================================================================
  // ACTIVITY LOGGING
  // ============================================================================

  static async logActivity(
    challengeId: string,
    userId: string,
    input: LogActivityInput
  ): Promise<LogActivityResponse> {
    const supabaseAdmin = createAdminSupabase();

    // Get challenge
    const challenge = await this.getRawChallenge(challengeId);

    // Validate challenge is active
    if (challenge.status !== 'active') {
      throw new Error('Can only log activity for active challenges');
    }

    // Check if challenge has ended
    if (new Date() > new Date(challenge.ends_at)) {
      throw new Error('This challenge has ended. Final results are locked.');
    }

    // Validate amount
    if (input.amount <= 0 || input.amount > MAX_LOG_AMOUNT) {
      throw new Error(`Amount must be between ${MIN_LOG_AMOUNT} and ${MAX_LOG_AMOUNT}`);
    }

    // Get participant record
    const { data: participant, error: pError } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (pError || !participant) {
      throw new Error('You are not an active participant in this challenge');
    }

    const today = new Date().toISOString().split('T')[0];

    // Check daily log limit
    const { count: todayLogCount } = await supabaseAdmin
      .from('challenge_logs')
      .select('*', { count: 'exact', head: true })
      .eq('participant_id', participant.id)
      .eq('log_date', today);

    if ((todayLogCount || 0) >= MAX_LOGS_PER_DAY) {
      throw new Error(`Maximum ${MAX_LOGS_PER_DAY} logs per day reached`);
    }

    // Duplicate detection
    const duplicateWindow = new Date(Date.now() - DUPLICATE_DETECTION_WINDOW_MS).toISOString();
    const { data: recentLogs } = await supabaseAdmin
      .from('challenge_logs')
      .select('amount, note')
      .eq('participant_id', participant.id)
      .gte('logged_at', duplicateWindow);

    const isDuplicate = (recentLogs || []).some(
      log => log.amount === input.amount && log.note === (input.note || null)
    );

    if (isDuplicate) {
      throw new Error('DUPLICATE_DETECTED');
    }

    // Insert the log
    const { data: log, error: logError } = await supabaseAdmin
      .from('challenge_logs')
      .insert({
        challenge_id: challengeId,
        participant_id: participant.id,
        user_id: userId,
        fitcircle_id: challenge.fitcircle_id,
        amount: input.amount,
        note: input.note?.trim().slice(0, 80) || null,
        log_date: today,
      })
      .select()
      .single();

    if (logError) throw logError;

    // Update participant totals
    const oldRank = participant.rank;

    // Reset today_total if it's a new day
    const isNewDay = participant.today_date !== today;
    const newTodayTotal = isNewDay ? input.amount : (participant.today_total || 0) + input.amount;
    const newCumulativeTotal = (participant.cumulative_total || 0) + input.amount;
    const newLogCount = (participant.log_count || 0) + 1;
    const goalCompletionPct = Math.min(
      (newCumulativeTotal / challenge.goal_amount) * 100,
      100
    );

    // Calculate streak
    const { current_streak, longest_streak } = this.calculateStreak(
      participant,
      today,
      isNewDay
    );

    // Check milestones
    const oldPct = participant.goal_completion_pct || 0;
    const milestoneReached = this.detectMilestone(
      oldPct,
      goalCompletionPct,
      participant.milestones_achieved || {}
    );

    // Update milestones_achieved
    const updatedMilestones = { ...(participant.milestones_achieved || {}) };
    if (milestoneReached) {
      updatedMilestones[`milestone_${milestoneReached}`] = true;
    }

    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
      .update({
        cumulative_total: newCumulativeTotal,
        today_total: newTodayTotal,
        today_date: today,
        current_streak,
        longest_streak,
        last_logged_at: new Date().toISOString(),
        log_count: newLogCount,
        goal_completion_pct: Math.round(goalCompletionPct * 100) / 100,
        milestones_achieved: updatedMilestones,
        updated_at: new Date().toISOString(),
      })
      .eq('id', participant.id);

    if (updateError) throw updateError;

    // Recalculate ranks for all participants
    const rankResults = await this.recalculateRanks(challengeId);
    const newRank = rankResults.find(r => r.user_id === userId)?.rank || 1;

    // Determine who was passed
    const passedUsers = rankResults
      .filter(r => {
        if (!oldRank) return false;
        const theirOldRank = r.old_rank;
        return theirOldRank !== undefined && theirOldRank < oldRank && r.rank > newRank;
      })
      .map(r => r.user_id);

    return {
      log,
      updated_participant: {
        cumulative_total: newCumulativeTotal,
        today_total: newTodayTotal,
        rank: newRank,
        goal_completion_pct: Math.round(goalCompletionPct * 100) / 100,
        current_streak,
      },
      rank_changed: oldRank !== newRank,
      old_rank: oldRank,
      new_rank: newRank,
      milestone_reached: milestoneReached ? `${milestoneReached}%` : null,
      passed_users: passedUsers,
    };
  }

  static async deleteLog(
    logId: string,
    userId: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const today = new Date().toISOString().split('T')[0];

    // Get the log to verify ownership and date
    const { data: log, error: logError } = await supabaseAdmin
      .from('challenge_logs')
      .select('*')
      .eq('id', logId)
      .eq('user_id', userId)
      .single();

    if (logError || !log) {
      throw new Error('Log not found or you do not have permission to delete it');
    }

    if (log.log_date !== today) {
      throw new Error('Can only delete today\'s logs');
    }

    // Delete the log
    const { error: deleteError } = await supabaseAdmin
      .from('challenge_logs')
      .delete()
      .eq('id', logId);

    if (deleteError) throw deleteError;

    // Recalculate participant totals
    const { data: allLogs } = await supabaseAdmin
      .from('challenge_logs')
      .select('amount, log_date')
      .eq('participant_id', log.participant_id);

    const newCumulative = (allLogs || []).reduce((sum, l) => sum + l.amount, 0);
    const newToday = (allLogs || [])
      .filter(l => l.log_date === today)
      .reduce((sum, l) => sum + l.amount, 0);

    // Get challenge for goal_amount
    const challenge = await this.getRawChallenge(log.challenge_id);

    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
      .update({
        cumulative_total: newCumulative,
        today_total: newToday,
        log_count: (allLogs || []).length,
        goal_completion_pct: Math.min((newCumulative / challenge.goal_amount) * 100, 100),
        updated_at: new Date().toISOString(),
      })
      .eq('id', log.participant_id);

    if (updateError) throw updateError;

    await this.recalculateRanks(log.challenge_id);
  }

  static async getMyLogs(
    challengeId: string,
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<CircleChallengeLog[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('challenge_logs')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  // ============================================================================
  // LEADERBOARD
  // ============================================================================

  static async getLeaderboard(
    challengeId: string,
    userId: string
  ): Promise<ChallengeLeaderboardEntry[]> {
    const supabaseAdmin = createAdminSupabase();

    const today = new Date().toISOString().split('T')[0];

    // Get all active participants with profile data
    const { data: participants, error } = await supabaseAdmin
      .from('challenge_participants')
      .select(`
        *,
        profiles!challenge_participants_user_id_fkey (display_name, avatar_url)
      `)
      .eq('challenge_id', challengeId)
      .eq('status', 'active')
      .order('cumulative_total', { ascending: false });

    if (error) throw error;

    // Build leaderboard entries
    const entries: ChallengeLeaderboardEntry[] = (participants || []).map((p, index) => {
      const profile = p.profiles as any;

      // Reset today_total display if date doesn't match
      const displayTodayTotal = p.today_date === today ? (p.today_total || 0) : 0;

      return {
        rank: p.rank || index + 1,
        user_id: p.user_id,
        display_name: profile?.display_name || 'Anonymous',
        avatar_url: profile?.avatar_url || null,
        cumulative_total: p.cumulative_total || 0,
        today_total: displayTodayTotal,
        current_streak: p.current_streak || 0,
        goal_completion_pct: p.goal_completion_pct || 0,
        last_logged_at: p.last_logged_at,
        gap_to_next: null,
        is_current_user: p.user_id === userId,
      };
    });

    // Calculate gap to next rank
    for (let i = 1; i < entries.length; i++) {
      entries[i].gap_to_next = entries[i - 1].cumulative_total - entries[i].cumulative_total;
    }

    return entries;
  }

  // ============================================================================
  // CRON: STATUS TRANSITIONS
  // ============================================================================

  static async processScheduledChallenges(): Promise<{ activated: number; completed: number }> {
    const supabaseAdmin = createAdminSupabase();
    const now = new Date().toISOString();

    // Activate scheduled challenges whose start time has passed
    const { data: toActivate, error: activateError } = await supabaseAdmin
      .from('challenges')
      .update({ status: 'active', updated_at: now })
      .eq('status', 'scheduled')
      .lte('starts_at', now)
      .select('id');

    if (activateError) {
      console.error('[CircleChallengeService] Error activating challenges:', activateError);
    }

    // Complete active challenges whose end time has passed
    const { data: toComplete, error: completeQueryError } = await supabaseAdmin
      .from('challenges')
      .select('id')
      .eq('status', 'active')
      .lte('ends_at', now);

    if (completeQueryError) {
      console.error('[CircleChallengeService] Error querying completable challenges:', completeQueryError);
    }

    let completedCount = 0;
    for (const challenge of toComplete || []) {
      await this.completeChallenge(challenge.id);
      completedCount++;
    }

    return {
      activated: toActivate?.length || 0,
      completed: completedCount,
    };
  }

  static async completeChallenge(challengeId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Get the rank-1 participant
    const { data: winner } = await supabaseAdmin
      .from('challenge_participants')
      .select('user_id')
      .eq('challenge_id', challengeId)
      .eq('status', 'active')
      .order('cumulative_total', { ascending: false })
      .limit(1)
      .single();

    const { error } = await supabaseAdmin
      .from('challenges')
      .update({
        status: 'completed',
        winner_user_id: winner?.user_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', challengeId);

    if (error) throw error;
  }

  // ============================================================================
  // HIGH-FIVES
  // ============================================================================

  static async sendHighFive(
    challengeId: string,
    fromUserId: string,
    toUserId: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const challenge = await this.getRawChallenge(challengeId);

    // Both users must be active participants
    const { count } = await supabaseAdmin
      .from('challenge_participants')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', challengeId)
      .in('user_id', [fromUserId, toUserId])
      .eq('status', 'active');

    if ((count || 0) < 2) {
      throw new Error('Both users must be active participants');
    }

    // Use circle_encouragements table for high-fives
    const { error } = await supabaseAdmin
      .from('circle_encouragements')
      .insert({
        fitcircle_id: challenge.fitcircle_id,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        type: 'high_five',
        content: `High five in challenge: ${challenge.name}`,
      });

    if (error) throw error;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private static async getRawChallenge(challengeId: string): Promise<CircleChallenge> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    if (error) throw error;
    return data;
  }

  private static async verifyCircleMembership(
    userId: string,
    circleId: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { count, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('*', { count: 'exact', head: true })
      .eq('fitcircle_id', circleId)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw error;
    if (!count || count === 0) {
      throw new Error('You must be an active member of this circle');
    }
  }

  private static async addParticipant(
    challengeId: string,
    userId: string,
    circleId: string,
    invitedBy?: string
  ): Promise<CircleChallengeParticipant> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('challenge_participants')
      .insert({
        challenge_id: challengeId,
        user_id: userId,
        fitcircle_id: circleId,
        invited_by: invitedBy || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('You have already joined this challenge');
      }
      throw error;
    }

    await this.updateParticipantCount(challengeId);
    await this.recalculateRanks(challengeId);

    return data;
  }

  private static async updateParticipantCount(challengeId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { count } = await supabaseAdmin
      .from('challenge_participants')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', challengeId)
      .eq('status', 'active');

    await supabaseAdmin
      .from('challenges')
      .update({ participant_count: count || 0, updated_at: new Date().toISOString() })
      .eq('id', challengeId);
  }

  private static async recalculateRanks(
    challengeId: string
  ): Promise<Array<{ user_id: string; rank: number; old_rank?: number }>> {
    const supabaseAdmin = createAdminSupabase();

    const today = new Date().toISOString().split('T')[0];

    // Get all active participants sorted by ranking criteria
    const { data: participants, error } = await supabaseAdmin
      .from('challenge_participants')
      .select('id, user_id, cumulative_total, today_total, today_date, current_streak, joined_at, rank')
      .eq('challenge_id', challengeId)
      .eq('status', 'active')
      .order('cumulative_total', { ascending: false });

    if (error) throw error;

    // Sort with full tiebreaker chain
    const sorted = (participants || []).sort((a, b) => {
      // Primary: cumulative total DESC
      if ((b.cumulative_total || 0) !== (a.cumulative_total || 0)) {
        return (b.cumulative_total || 0) - (a.cumulative_total || 0);
      }
      // Tiebreaker 1: today's total DESC (only if same day)
      const aTodayTotal = a.today_date === today ? (a.today_total || 0) : 0;
      const bTodayTotal = b.today_date === today ? (b.today_total || 0) : 0;
      if (bTodayTotal !== aTodayTotal) {
        return bTodayTotal - aTodayTotal;
      }
      // Tiebreaker 2: streak DESC
      if ((b.current_streak || 0) !== (a.current_streak || 0)) {
        return (b.current_streak || 0) - (a.current_streak || 0);
      }
      // Tiebreaker 3: earliest join ASC
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });

    const results: Array<{ user_id: string; rank: number; old_rank?: number }> = [];

    // Update ranks
    for (let i = 0; i < sorted.length; i++) {
      const newRank = i + 1;
      const p = sorted[i];
      results.push({ user_id: p.user_id, rank: newRank, old_rank: p.rank || undefined });

      if (p.rank !== newRank) {
        await supabaseAdmin
          .from('challenge_participants')
          .update({ rank: newRank, updated_at: new Date().toISOString() })
          .eq('id', p.id);
      }
    }

    return results;
  }

  private static calculateStreak(
    participant: CircleChallengeParticipant,
    today: string,
    isNewDay: boolean
  ): { current_streak: number; longest_streak: number } {
    let currentStreak = participant.current_streak || 0;
    let longestStreak = participant.longest_streak || 0;

    if (!participant.last_logged_at) {
      // First log ever
      currentStreak = 1;
    } else if (isNewDay) {
      const lastLoggedDate = new Date(participant.last_logged_at);
      const now = new Date();
      const hoursSinceLastLog = (now.getTime() - lastLoggedDate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastLog <= STREAK_GRACE_HOURS) {
        currentStreak += 1;
      } else {
        currentStreak = 1; // streak broken, restart
      }
    }
    // If same day and already logged, streak doesn't change

    longestStreak = Math.max(longestStreak, currentStreak);

    return { current_streak: currentStreak, longest_streak: longestStreak };
  }

  private static detectMilestone(
    oldPct: number,
    newPct: number,
    achieved: Record<string, boolean>
  ): MilestoneThreshold | null {
    for (const milestone of MILESTONES) {
      const key = `milestone_${milestone}`;
      if (!achieved[key] && oldPct < milestone && newPct >= milestone) {
        return milestone;
      }
    }
    return null;
  }

  private static async enrichChallenge(
    challenge: CircleChallenge,
    userId: string
  ): Promise<CircleChallengeWithDetails> {
    const supabaseAdmin = createAdminSupabase();

    // Get creator profile
    const { data: creator } = await supabaseAdmin
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', challenge.creator_id)
      .single();

    // Get user's participation
    const { data: myParticipation } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challenge.id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    const startsAt = new Date(challenge.starts_at);
    const endsAt = new Date(challenge.ends_at);
    const now = new Date();
    const durationDays = Math.ceil((endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    const template = challenge.template_id ? getTemplateById(challenge.template_id) : null;

    return {
      ...challenge,
      creator_name: creator?.display_name || 'Unknown',
      creator_avatar: creator?.avatar_url || undefined,
      my_participation: myParticipation || null,
      duration_days: durationDays,
      days_remaining: daysRemaining,
      template: template || null,
    };
  }
}
