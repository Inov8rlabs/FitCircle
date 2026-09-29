import { getTemplateById } from '../data/challenge-templates';
import { createAdminSupabase } from '../supabase-admin';
import {
  type CircleChallenge,
  type CircleChallengeParticipant,
  type CircleChallengeLog,
  type CircleChallengeWithDetails,
  type ChallengeLeaderboardEntry,
  type LogActivityResponse,
  type ChallengeListResponse,
  type CreateCircleChallengeInput,
  type LogActivityInput,
  MAX_LOGS_PER_DAY,
  MAX_LOG_AMOUNT,
  DUPLICATE_DETECTION_WINDOW_MS,
} from '../types/circle-challenge';

import {
  MIN_STORABLE_LOG_AMOUNT,
  computeProgress,
  normalizeLogAmount,
  normalizeLogNote,
  presentCategory,
  reconcileMilestones,
  toNumber,
  utcDay,
  type ProgressLogRow,
} from './circle-challenge-progress';

/**
 * A failure of the activity-log operations that the route can turn into a precise
 * HTTP status + `error.code`. (The older methods of this service still throw plain
 * `Error`s, which their routes answer with 400 `ERROR`.)
 */
export class ChallengeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ChallengeError';
  }
}

/** Columns a creator may change through PATCH; everything else is ignored. */
const UPDATABLE_CHALLENGE_FIELDS = [
  'name',
  'description',
  'is_open',
  'starts_at',
  'ends_at',
  'goal_amount',
] as const;

/**
 * uuids compare case-insensitively: Postgres returns them lowercase while the iOS
 * client puts them UPPERCASE in the URL.
 */
function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/** PostgREST caps a response at 1000 rows; logs are read in pages of this size. */
const LOG_PAGE_SIZE = 1000;
/** 20 logs/day x 90 days is 1800 rows; this bound only stops a runaway loop. */
const MAX_LOG_PAGES = 20;

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

    // Surface a friendly circle-chat announcement (fire-and-forget; never throws).
    const { ChatActivityHooks } = await import('./chat-activity-hooks');
    ChatActivityHooks.onNewChallenge(input.fitcircle_id, challenge.id, name).catch(() => {});

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

    // The body comes straight from the request: copy only the editable columns so a
    // creator cannot overwrite status, creator_id, winner_user_id, fitcircle_id ...
    const allowed: Record<string, unknown> = {};
    const source = (updates ?? {}) as Record<string, unknown>;
    for (const field of UPDATABLE_CHALLENGE_FIELDS) {
      if (source[field] !== undefined) allowed[field] = source[field];
    }

    const { data: updated, error } = await supabaseAdmin
      .from('challenges')
      .update({ ...allowed, updated_at: new Date().toISOString() })
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

  /**
   * Record activity toward a challenge and return the log plus the caller's new
   * standing. `circleId` is the circle from the URL; when given, the challenge must
   * belong to it.
   *
   * Only an active member of the circle who is an active participant of the
   * challenge may log. The server assigns the day (UTC) and the timestamp; the
   * client cannot backdate.
   */
  static async logActivity(
    challengeId: string,
    userId: string,
    input: LogActivityInput,
    circleId?: string
  ): Promise<LogActivityResponse> {
    const supabaseAdmin = createAdminSupabase();

    const challenge = await this.requireChallengeInCircle(challengeId, circleId);
    await this.requireCircleMember(userId, challenge.fitcircle_id);

    const amount = normalizeLogAmount(input?.amount);
    if (amount === null) {
      throw new ChallengeError(
        'VALIDATION_ERROR',
        `Amount must be between ${MIN_STORABLE_LOG_AMOUNT} and ${MAX_LOG_AMOUNT}`,
        400
      );
    }
    const note = normalizeLogNote(input?.note);

    const now = new Date();
    const today = utcDay(now);

    if (challenge.status === 'cancelled') {
      throw new ChallengeError('CHALLENGE_NOT_ACTIVE', 'This challenge was cancelled', 400);
    }
    if (challenge.status === 'completed' || now >= new Date(challenge.ends_at)) {
      throw new ChallengeError(
        'CHALLENGE_ENDED',
        'This challenge has ended. Final results are locked.',
        400
      );
    }
    if (challenge.status !== 'active') {
      if (now < new Date(challenge.starts_at)) {
        throw new ChallengeError(
          'CHALLENGE_NOT_STARTED',
          'Can only log activity for active challenges',
          400
        );
      }
      // The start time has passed but the daily cron has not flipped the status
      // yet: do the same transition now instead of refusing a valid log.
      const { error: activateError } = await supabaseAdmin
        .from('challenges')
        .update({ status: 'active', updated_at: now.toISOString() })
        .eq('id', challengeId)
        .eq('status', 'scheduled');
      if (activateError) throw activateError;
    }

    const { data: participant, error: pError } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (pError) throw pError;
    if (!participant) {
      throw new ChallengeError(
        'NOT_A_PARTICIPANT',
        'You are not an active participant in this challenge',
        403
      );
    }

    // Daily log limit
    const { count: todayLogCount, error: countError } = await supabaseAdmin
      .from('challenge_logs')
      .select('*', { count: 'exact', head: true })
      .eq('participant_id', participant.id)
      .eq('log_date', today);

    if (countError) throw countError;
    if ((todayLogCount || 0) >= MAX_LOGS_PER_DAY) {
      throw new ChallengeError(
        'DAILY_LIMIT_REACHED',
        `Maximum ${MAX_LOGS_PER_DAY} logs per day reached`,
        400
      );
    }

    // Duplicate detection: same amount + same note within the window
    const duplicateWindow = new Date(now.getTime() - DUPLICATE_DETECTION_WINDOW_MS).toISOString();
    const { data: recentLogs, error: recentError } = await supabaseAdmin
      .from('challenge_logs')
      .select('amount, note')
      .eq('participant_id', participant.id)
      .gte('logged_at', duplicateWindow);

    if (recentError) throw recentError;
    const isDuplicate = (recentLogs || []).some(
      (log: { amount: unknown; note: string | null }) =>
        toNumber(log.amount) === amount && (log.note ?? null) === note
    );
    if (isDuplicate) {
      throw new ChallengeError(
        'DUPLICATE_DETECTED',
        'Looks like a duplicate — try adding a note to distinguish it',
        409
      );
    }

    // Insert the log
    const { data: log, error: logError } = await supabaseAdmin
      .from('challenge_logs')
      .insert({
        challenge_id: challengeId,
        participant_id: participant.id,
        user_id: userId,
        fitcircle_id: challenge.fitcircle_id,
        amount,
        note,
        logged_at: now.toISOString(),
        log_date: today,
      })
      .select()
      .single();

    if (logError) throw logError;

    // Derive the participant's progress from ALL of their logs
    const logs = await this.getParticipantLogs(participant.id);
    const progress = computeProgress(logs, toNumber(challenge.goal_amount), today);
    const { milestones, reached } = reconcileMilestones(
      participant.milestones_achieved,
      toNumber(participant.goal_completion_pct),
      progress.goal_completion_pct
    );

    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
      .update({
        ...progress,
        today_date: today,
        milestones_achieved: milestones,
        updated_at: now.toISOString(),
      })
      .eq('id', participant.id);

    if (updateError) throw updateError;

    // Recalculate ranks for all participants
    const oldRank: number | null = participant.rank ?? null;
    const rankResults = await this.recalculateRanks(challengeId);
    const newRank = rankResults.find(r => r.user_id === userId)?.rank || 1;

    // Who the caller overtook with this log
    const passedUsers = rankResults
      .filter(r => {
        if (!oldRank) return false;
        const theirOldRank = r.old_rank;
        return theirOldRank !== undefined && theirOldRank < oldRank && r.rank > newRank;
      })
      .map(r => r.user_id);

    return {
      log: this.presentLog(log),
      updated_participant: {
        cumulative_total: progress.cumulative_total,
        today_total: progress.today_total,
        rank: newRank,
        goal_completion_pct: progress.goal_completion_pct,
        current_streak: progress.current_streak,
      },
      rank_changed: oldRank !== newRank,
      old_rank: oldRank,
      new_rank: newRank,
      milestone_reached: reached ? `${reached}%` : null,
      passed_users: passedUsers,
    };
  }

  /**
   * Delete one of the caller's own logs from today (UTC) and re-derive their
   * progress and everyone's rank. `scope` carries the ids from the URL; when given,
   * the log must belong to that challenge and circle.
   */
  static async deleteLog(
    logId: string,
    userId: string,
    scope: { circleId?: string; challengeId?: string } = {}
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const now = new Date();
    const today = utcDay(now);

    const { data: log, error: logError } = await supabaseAdmin
      .from('challenge_logs')
      .select('*')
      .eq('id', logId)
      .maybeSingle();

    // 22P02 = the id in the URL is not a uuid: that log does not exist.
    if (logError && logError.code !== '22P02') throw logError;
    if (
      !log ||
      (scope.challengeId && !sameId(log.challenge_id, scope.challengeId)) ||
      (scope.circleId && !sameId(log.fitcircle_id, scope.circleId))
    ) {
      throw new ChallengeError('NOT_FOUND', 'Log not found', 404);
    }
    if (!sameId(log.user_id, userId)) {
      throw new ChallengeError('FORBIDDEN', 'You can only delete your own logs', 403);
    }

    await this.requireCircleMember(userId, log.fitcircle_id);

    const challenge = await this.requireChallengeInCircle(log.challenge_id, scope.circleId);
    if (
      challenge.status === 'completed' ||
      challenge.status === 'cancelled' ||
      now >= new Date(challenge.ends_at)
    ) {
      throw new ChallengeError(
        'CHALLENGE_ENDED',
        'This challenge has ended. Final results are locked.',
        400
      );
    }

    if (log.log_date !== today) {
      throw new ChallengeError('LOG_LOCKED', "Can only delete today's logs", 400);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('challenge_logs')
      .delete()
      .eq('id', logId)
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    const { data: participant, error: pError } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('id', log.participant_id)
      .maybeSingle();

    if (pError) throw pError;
    if (!participant) return; // participant row is gone; nothing to re-derive

    const logs = await this.getParticipantLogs(log.participant_id);
    const progress = computeProgress(logs, toNumber(challenge.goal_amount), today);
    const { milestones } = reconcileMilestones(
      participant.milestones_achieved,
      toNumber(participant.goal_completion_pct),
      progress.goal_completion_pct
    );

    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
      .update({
        ...progress,
        today_date: today,
        milestones_achieved: milestones,
        updated_at: now.toISOString(),
      })
      .eq('id', log.participant_id);

    if (updateError) throw updateError;

    await this.recalculateRanks(log.challenge_id);
  }

  /**
   * The caller's own logs for a challenge, newest first. A circle member who has
   * not joined the challenge gets an empty list (the clients load this for every
   * challenge they open), a non-member is refused.
   */
  static async getMyLogs(
    challengeId: string,
    userId: string,
    limit = 50,
    offset = 0,
    circleId?: string
  ): Promise<CircleChallengeLog[]> {
    const supabaseAdmin = createAdminSupabase();

    const challenge = await this.requireChallengeInCircle(challengeId, circleId);
    await this.requireCircleMember(userId, challenge.fitcircle_id);

    const { data, error } = await supabaseAdmin
      .from('challenge_logs')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return (data || []).map((row: CircleChallengeLog) => this.presentLog(row));
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
      const profile = p.profiles;

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

    const { data: completed, error } = await supabaseAdmin
      .from('challenges')
      .update({
        status: 'completed',
        winner_user_id: winner?.user_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', challengeId)
      .select('fitcircle_id, name')
      .single();

    if (error) throw error;

    // Surface a friendly circle-chat update (fire-and-forget; never throws).
    const { ChatActivityHooks } = await import('./chat-activity-hooks');
    ChatActivityHooks.onChallengeResolved(
      completed.fitcircle_id,
      challengeId,
      completed.name
    ).catch(() => {});
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

  /**
   * The challenge, or NOT_FOUND when it does not exist or does not belong to the
   * circle named in the URL.
   */
  private static async requireChallengeInCircle(
    challengeId: string,
    circleId?: string
  ): Promise<CircleChallenge> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .maybeSingle();

    if (error) {
      // 22P02 = the id in the URL is not a uuid: that challenge does not exist.
      if (error.code === '22P02') throw new ChallengeError('NOT_FOUND', 'Challenge not found', 404);
      throw error;
    }
    if (!data || (circleId && !sameId(data.fitcircle_id, circleId))) {
      throw new ChallengeError('NOT_FOUND', 'Challenge not found', 404);
    }
    return data;
  }

  private static async requireCircleMember(userId: string, circleId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { count, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('*', { count: 'exact', head: true })
      .eq('fitcircle_id', circleId)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw error;
    if (!count || count === 0) {
      throw new ChallengeError('FORBIDDEN', 'You must be an active member of this circle', 403);
    }
  }

  /** Every log of one participant, read in pages (PostgREST caps a page at 1000). */
  private static async getParticipantLogs(participantId: string): Promise<ProgressLogRow[]> {
    const supabaseAdmin = createAdminSupabase();
    const rows: ProgressLogRow[] = [];

    for (let page = 0; page < MAX_LOG_PAGES; page++) {
      const from = page * LOG_PAGE_SIZE;
      const { data, error } = await supabaseAdmin
        .from('challenge_logs')
        .select('id, amount, log_date, logged_at')
        .eq('participant_id', participantId)
        .order('logged_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + LOG_PAGE_SIZE - 1);

      if (error) throw error;
      rows.push(...((data || []) as ProgressLogRow[]));
      if (!data || data.length < LOG_PAGE_SIZE) break;
    }

    return rows;
  }

  /**
   * The caller's participation as shown to them. `today_total` is only stored when
   * the participant logs, so on a later day it still holds the last active day's
   * sum; it is presented as 0 then, exactly like the leaderboard does.
   */
  private static presentParticipation(
    participation: CircleChallengeParticipant | null | undefined
  ): CircleChallengeParticipant | null {
    if (!participation) return null;
    if (participation.today_date === utcDay()) return participation;
    return { ...participation, today_total: 0 };
  }

  /** A log row as the clients decode it: `amount` is always a JSON number. */
  private static presentLog(row: CircleChallengeLog): CircleChallengeLog {
    return { ...row, amount: toNumber(row.amount) };
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
      // Old clients decode `category` with a strict enum (one unknown value fails
      // the whole list), so it is always one of the five known values; the stored
      // value is kept next to it.
      category: presentCategory(challenge.category),
      category_raw: (challenge.category as string | null) ?? null,
      creator_name: creator?.display_name || 'Unknown',
      creator_avatar: creator?.avatar_url || undefined,
      my_participation: this.presentParticipation(myParticipation),
      duration_days: durationDays,
      days_remaining: daysRemaining,
      template: template || null,
    };
  }
}
