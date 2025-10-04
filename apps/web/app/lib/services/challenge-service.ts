import { createAdminSupabase } from '@/lib/supabase';

/**
 * Challenge Service - Handles all challenge-related business logic
 * Replaces stored procedures with backend logic
 */

export class ChallengeService {
  /**
   * Update participant count when someone joins/leaves a challenge
   */
  static async updateParticipantCount(challengeId: string, increment: boolean) {
    const supabaseAdmin = createAdminSupabase();

    const { data: challenge, error: fetchError } = await supabaseAdmin
      .from('challenges')
      .select('participant_count')
      .eq('id', challengeId)
      .single();

    if (fetchError) throw fetchError;

    const newCount = increment
      ? (challenge.participant_count || 0) + 1
      : Math.max((challenge.participant_count || 0) - 1, 0);

    const { error } = await supabaseAdmin
      .from('challenges')
      .update({
        participant_count: newCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', challengeId);

    if (error) throw error;
  }

  /**
   * Update team member count
   */
  static async updateTeamMemberCount(teamId: string, increment: boolean) {
    const supabaseAdmin = createAdminSupabase();

    const { data: team, error: fetchError } = await supabaseAdmin
      .from('teams')
      .select('member_count')
      .eq('id', teamId)
      .single();

    if (fetchError) throw fetchError;

    const newCount = increment
      ? (team.member_count || 0) + 1
      : Math.max((team.member_count || 0) - 1, 0);

    const { error } = await supabaseAdmin
      .from('teams')
      .update({
        member_count: newCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', teamId);

    if (error) throw error;
  }

  /**
   * Update participant stats after check-in
   */
  static async updateParticipantStats(participantId: string, checkInDate: Date) {
    const supabaseAdmin = createAdminSupabase();

    // Get participant details
    const { data: participant, error: participantError } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('id', participantId)
      .single();

    if (participantError) throw participantError;

    // Calculate new streak
    const lastCheckIn = participant.last_check_in_at
      ? new Date(participant.last_check_in_at)
      : null;

    let newStreak = 1;
    if (lastCheckIn) {
      const daysDiff = Math.floor(
        (checkInDate.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        newStreak = (participant.streak_days || 0) + 1;
      } else if (daysDiff > 1) {
        newStreak = 1;
      } else {
        newStreak = participant.streak_days || 1;
      }
    }

    // Get latest weight
    const { data: latestCheckIn } = await supabaseAdmin
      .from('check_ins')
      .select('weight_kg')
      .eq('participant_id', participantId)
      .order('check_in_date', { ascending: false })
      .limit(1)
      .single();

    const currentWeight = latestCheckIn?.weight_kg || participant.current_weight_kg;

    // Calculate progress
    let progress = participant.progress_percentage || 0;
    if (participant.starting_weight_kg && participant.goal_weight_kg && currentWeight) {
      if (participant.starting_weight_kg > participant.goal_weight_kg) {
        // Weight loss
        progress = ((participant.starting_weight_kg - currentWeight) /
                   (participant.starting_weight_kg - participant.goal_weight_kg)) * 100;
      } else {
        // Weight gain
        progress = ((currentWeight - participant.starting_weight_kg) /
                   (participant.goal_weight_kg - participant.starting_weight_kg)) * 100;
      }
      progress = Math.min(Math.max(progress, 0), 100);
    }

    // Update participant
    await supabaseAdmin
      .from('challenge_participants')
      .update({
        check_ins_count: (participant.check_ins_count || 0) + 1,
        streak_days: newStreak,
        last_check_in_at: checkInDate.toISOString(),
        current_weight_kg: currentWeight,
        progress_percentage: progress,
        updated_at: new Date().toISOString(),
      })
      .eq('id', participantId);

    // Update challenge total check-ins
    const { data: challengeData } = await supabaseAdmin
      .from('challenges')
      .select('total_check_ins')
      .eq('id', participant.challenge_id)
      .single();

    await supabaseAdmin
      .from('challenges')
      .update({
        total_check_ins: (challengeData?.total_check_ins || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', participant.challenge_id);

    // Update user profile streak
    await supabaseAdmin
      .from('profiles')
      .update({
        current_streak: newStreak,
        longest_streak: Math.max(participant.longest_streak || 0, newStreak),
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', participant.user_id);

    return { streak: newStreak, progress };
  }

  /**
   * Calculate and update leaderboard for a challenge
   */
  static async updateLeaderboard(challengeId: string) {
    const supabaseAdmin = createAdminSupabase();

    // Delete existing leaderboard entries
    await supabaseAdmin
      .from('leaderboard')
      .delete()
      .eq('challenge_id', challengeId);

    // Get all active participants
    const { data: participants } = await supabaseAdmin
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('status', 'active')
      .order('total_points', { ascending: false });

    if (!participants || participants.length === 0) return;

    // Calculate ranks and insert individual leaderboard
    const leaderboardEntries = participants.map((p, index) => ({
      challenge_id: challengeId,
      entity_id: p.user_id,
      entity_type: 'individual',
      rank: index + 1,
      points: p.total_points || 0,
      progress_percentage: p.progress_percentage || 0,
      check_ins_count: p.check_ins_count || 0,
      streak_days: p.streak_days || 0,
      last_check_in_at: p.last_check_in_at,
      calculated_at: new Date().toISOString(),
    }));

    await supabaseAdmin
      .from('leaderboard')
      .insert(leaderboardEntries);

    // Update participant ranks
    for (const entry of leaderboardEntries) {
      await supabaseAdmin
        .from('challenge_participants')
        .update({ rank: entry.rank })
        .eq('user_id', entry.entity_id)
        .eq('challenge_id', challengeId);
    }

    // Handle team leaderboard if applicable
    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id, total_points')
      .eq('challenge_id', challengeId)
      .order('total_points', { ascending: false });

    if (teams && teams.length > 0) {
      const teamLeaderboard = teams.map((team, index) => ({
        challenge_id: challengeId,
        entity_id: team.id,
        entity_type: 'team',
        rank: index + 1,
        points: team.total_points || 0,
        calculated_at: new Date().toISOString(),
      }));

      await supabaseAdmin
        .from('leaderboard')
        .insert(teamLeaderboard);

      // Update team ranks
      for (const entry of teamLeaderboard) {
        await supabaseAdmin
          .from('teams')
          .update({ rank: entry.rank })
          .eq('id', entry.entity_id);
      }
    }
  }

  /**
   * Process challenge status updates (should be run daily via cron)
   */
  static async processChallengeStatusUpdates() {
    const supabaseAdmin = createAdminSupabase();
    const now = new Date().toISOString();

    // Update challenges from 'upcoming' to 'active'
    await supabaseAdmin
      .from('challenges')
      .update({
        status: 'active',
        updated_at: now,
      })
      .eq('status', 'upcoming')
      .lte('start_date', now);

    // Update challenges from 'active' to 'completed'
    await supabaseAdmin
      .from('challenges')
      .update({
        status: 'completed',
        updated_at: now,
      })
      .eq('status', 'active')
      .lt('end_date', now);

    // Calculate completion rates for newly completed challenges
    const { data: completedChallenges } = await supabaseAdmin
      .from('challenges')
      .select('id')
      .eq('status', 'completed')
      .is('completion_rate', null);

    if (completedChallenges) {
      for (const challenge of completedChallenges) {
        const { data: participants } = await supabaseAdmin
          .from('challenge_participants')
          .select('status, progress_percentage')
          .eq('challenge_id', challenge.id);

        if (participants && participants.length > 0) {
          const completedCount = participants.filter(p => p.status === 'completed').length;
          const completionRate = (completedCount / participants.length) * 100;
          const avgProgress = participants.reduce((sum, p) => sum + (p.progress_percentage || 0), 0) / participants.length;

          await supabaseAdmin
            .from('challenges')
            .update({
              completion_rate: completionRate,
              avg_progress: avgProgress,
              updated_at: now,
            })
            .eq('id', challenge.id);
        }
      }
    }
  }

  /**
   * Award achievement to a user
   */
  static async awardAchievement(
    userId: string,
    challengeId: string,
    type: string,
    name: string,
    description: string,
    points: number = 0
  ) {
    const supabaseAdmin = createAdminSupabase();

    // Check if achievement already exists
    const { data: existing } = await supabaseAdmin
      .from('achievements')
      .select('id')
      .eq('user_id', userId)
      .eq('challenge_id', challengeId)
      .eq('type', type)
      .eq('name', name)
      .maybeSingle();

    if (existing) return existing.id;

    // Create new achievement
    const { data: achievement, error } = await supabaseAdmin
      .from('achievements')
      .insert({
        user_id: userId,
        challenge_id: challengeId,
        type,
        name,
        description,
        points,
        unlocked_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Update user points
    const { data: profileData } = await supabaseAdmin
      .from('profiles')
      .select('total_points')
      .eq('id', userId)
      .single();

    await supabaseAdmin
      .from('profiles')
      .update({
        total_points: (profileData?.total_points || 0) + points,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    // Create notification
    await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: userId,
        type: 'achievement',
        channel: 'in_app',
        title: 'Achievement Unlocked!',
        body: `You earned: ${name}`,
        related_challenge_id: challengeId,
        priority: 'high',
      });

    return achievement.id;
  }

  /**
   * Process streak achievements (should be run daily via cron)
   */
  static async processStreakAchievements() {
    const supabaseAdmin = createAdminSupabase();

    // Find participants with 7-day streaks
    const { data: sevenDayStreaks } = await supabaseAdmin
      .from('challenge_participants')
      .select('user_id, challenge_id')
      .eq('streak_days', 7);

    if (sevenDayStreaks) {
      for (const participant of sevenDayStreaks) {
        // Check if they already have this achievement
        const { data: existing } = await supabaseAdmin
          .from('achievements')
          .select('id')
          .eq('user_id', participant.user_id)
          .eq('challenge_id', participant.challenge_id)
          .eq('name', '7-Day Streak')
          .maybeSingle();

        if (!existing) {
          await this.awardAchievement(
            participant.user_id,
            participant.challenge_id,
            'streak',
            '7-Day Streak',
            'Completed check-ins for 7 consecutive days',
            50
          );
        }
      }
    }

    // Find participants with 30-day streaks
    const { data: thirtyDayStreaks } = await supabaseAdmin
      .from('challenge_participants')
      .select('user_id, challenge_id')
      .eq('streak_days', 30);

    if (thirtyDayStreaks) {
      for (const participant of thirtyDayStreaks) {
        const { data: existing } = await supabaseAdmin
          .from('achievements')
          .select('id')
          .eq('user_id', participant.user_id)
          .eq('challenge_id', participant.challenge_id)
          .eq('name', '30-Day Streak')
          .maybeSingle();

        if (!existing) {
          await this.awardAchievement(
            participant.user_id,
            participant.challenge_id,
            'streak',
            '30-Day Streak',
            'Completed check-ins for 30 consecutive days',
            200
          );
        }
      }
    }
  }
}
