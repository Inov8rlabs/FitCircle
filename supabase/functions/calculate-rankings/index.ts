import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RankingRequest {
  challengeId: string;
  force?: boolean;
}

interface LeaderboardEntry {
  entity_id: string;
  entity_type: 'individual' | 'team';
  points: number;
  progress_percentage: number;
  weight_lost_kg?: number;
  weight_lost_percentage?: number;
  total_steps: number;
  total_minutes: number;
  check_ins_count: number;
  streak_days: number;
  last_check_in_at?: string;
  stats: Record<string, any>;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const { challengeId, force = false }: RankingRequest = await req.json();

    if (!challengeId) {
      throw new Error('challengeId is required');
    }

    // Check if challenge exists and is active
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('id, status, type, start_date, end_date')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      throw new Error(`Challenge not found: ${challengeId}`);
    }

    // Check if we need to recalculate (max once per minute unless forced)
    if (!force) {
      const { data: lastCalculation } = await supabase
        .from('leaderboard')
        .select('calculated_at')
        .eq('challenge_id', challengeId)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .single();

      if (lastCalculation?.calculated_at) {
        const lastCalcTime = new Date(lastCalculation.calculated_at);
        const timeSinceLastCalc = Date.now() - lastCalcTime.getTime();

        if (timeSinceLastCalc < 60000) { // Less than 1 minute
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Rankings recently updated',
              lastCalculatedAt: lastCalculation.calculated_at,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            }
          );
        }
      }
    }

    // Get current leaderboard for comparison
    const { data: currentLeaderboard } = await supabase
      .from('leaderboard')
      .select('entity_id, entity_type, rank, points')
      .eq('challenge_id', challengeId);

    const previousRankings = new Map(
      currentLeaderboard?.map((entry) => [
        `${entry.entity_type}-${entry.entity_id}`,
        { rank: entry.rank, points: entry.points },
      ]) || []
    );

    // Calculate individual rankings
    const { data: participants, error: participantsError } = await supabase
      .from('challenge_participants')
      .select(`
        id,
        user_id,
        team_id,
        total_points,
        progress_percentage,
        starting_weight_kg,
        current_weight_kg,
        goal_weight_kg,
        check_ins_count,
        streak_days,
        last_check_in_at,
        joined_at
      `)
      .eq('challenge_id', challengeId)
      .eq('status', 'active');

    if (participantsError) {
      throw new Error(`Error fetching participants: ${participantsError.message}`);
    }

    // Get aggregated check-in data for each participant
    const participantIds = participants?.map(p => p.id) || [];
    const { data: checkInStats } = await supabase
      .from('check_ins')
      .select('participant_id, steps, active_minutes, calories_burned')
      .in('participant_id', participantIds);

    // Aggregate check-in data by participant
    const checkInAggregates = new Map<string, {
      totalSteps: number;
      totalMinutes: number;
      totalCalories: number;
      avgSteps: number;
      avgMinutes: number;
    }>();

    checkInStats?.forEach((checkIn) => {
      const current = checkInAggregates.get(checkIn.participant_id) || {
        totalSteps: 0,
        totalMinutes: 0,
        totalCalories: 0,
        avgSteps: 0,
        avgMinutes: 0,
      };

      current.totalSteps += checkIn.steps || 0;
      current.totalMinutes += checkIn.active_minutes || 0;
      current.totalCalories += checkIn.calories_burned || 0;

      checkInAggregates.set(checkIn.participant_id, current);
    });

    // Calculate averages
    checkInAggregates.forEach((stats, participantId) => {
      const participant = participants?.find(p => p.id === participantId);
      if (participant && participant.check_ins_count > 0) {
        stats.avgSteps = Math.round(stats.totalSteps / participant.check_ins_count);
        stats.avgMinutes = Math.round(stats.totalMinutes / participant.check_ins_count);
      }
    });

    // Build individual leaderboard entries
    const individualEntries: LeaderboardEntry[] = participants?.map((participant) => {
      const stats = checkInAggregates.get(participant.id) || {
        totalSteps: 0,
        totalMinutes: 0,
        totalCalories: 0,
        avgSteps: 0,
        avgMinutes: 0,
      };

      const weightLostKg = participant.starting_weight_kg && participant.current_weight_kg
        ? participant.starting_weight_kg - participant.current_weight_kg
        : 0;

      const weightLostPercentage = participant.starting_weight_kg && weightLostKg
        ? (weightLostKg / participant.starting_weight_kg) * 100
        : 0;

      const daysSinceJoined = Math.max(
        1,
        Math.floor((Date.now() - new Date(participant.joined_at).getTime()) / (1000 * 60 * 60 * 24))
      );

      const completionRate = (participant.check_ins_count / daysSinceJoined) * 100;

      return {
        entity_id: participant.user_id,
        entity_type: 'individual' as const,
        points: participant.total_points || 0,
        progress_percentage: participant.progress_percentage || 0,
        weight_lost_kg: challenge.type === 'weight_loss' ? weightLostKg : undefined,
        weight_lost_percentage: challenge.type === 'weight_loss' ? weightLostPercentage : undefined,
        total_steps: stats.totalSteps,
        total_minutes: stats.totalMinutes,
        check_ins_count: participant.check_ins_count || 0,
        streak_days: participant.streak_days || 0,
        last_check_in_at: participant.last_check_in_at,
        stats: {
          avg_daily_steps: stats.avgSteps,
          avg_daily_minutes: stats.avgMinutes,
          total_calories: stats.totalCalories,
          completion_rate: Math.min(100, completionRate),
          days_active: daysSinceJoined,
        },
      };
    }) || [];

    // Sort and rank individuals
    individualEntries.sort((a, b) => {
      // Primary sort by points
      if (b.points !== a.points) return b.points - a.points;
      // Secondary sort by progress percentage
      if (b.progress_percentage !== a.progress_percentage) {
        return b.progress_percentage - a.progress_percentage;
      }
      // Tertiary sort by streak
      return b.streak_days - a.streak_days;
    });

    // Calculate team rankings if applicable
    const { data: teams } = await supabase
      .from('teams')
      .select(`
        id,
        challenge_id,
        total_points,
        member_count
      `)
      .eq('challenge_id', challengeId)
      .gt('member_count', 0);

    let teamEntries: LeaderboardEntry[] = [];

    if (teams && teams.length > 0) {
      // Get team statistics
      const teamIds = teams.map(t => t.id);

      const { data: teamMembers } = await supabase
        .from('team_members')
        .select(`
          team_id,
          user_id,
          points_contributed,
          check_ins_count,
          is_active
        `)
        .in('team_id', teamIds)
        .eq('is_active', true);

      const teamStats = new Map<string, {
        totalPoints: number;
        avgProgress: number;
        totalWeightLost: number;
        totalSteps: number;
        totalMinutes: number;
        totalCheckIns: number;
        avgStreak: number;
        memberCount: number;
      }>();

      // Initialize team stats
      teams.forEach(team => {
        teamStats.set(team.id, {
          totalPoints: team.total_points || 0,
          avgProgress: 0,
          totalWeightLost: 0,
          totalSteps: 0,
          totalMinutes: 0,
          totalCheckIns: 0,
          avgStreak: 0,
          memberCount: team.member_count || 0,
        });
      });

      // Aggregate member data for each team
      if (teamMembers) {
        const memberUserIds = teamMembers.map(m => m.user_id);

        // Get participant data for team members
        const { data: memberParticipants } = await supabase
          .from('challenge_participants')
          .select(`
            user_id,
            progress_percentage,
            starting_weight_kg,
            current_weight_kg,
            streak_days,
            check_ins_count
          `)
          .in('user_id', memberUserIds)
          .eq('challenge_id', challengeId);

        // Get check-in data for team members
        const { data: memberCheckIns } = await supabase
          .from('check_ins')
          .select('user_id, steps, active_minutes')
          .in('user_id', memberUserIds)
          .eq('challenge_id', challengeId);

        // Process member data by team
        teamMembers.forEach(member => {
          const stats = teamStats.get(member.team_id);
          if (!stats) return;

          const participant = memberParticipants?.find(p => p.user_id === member.user_id);
          if (participant) {
            stats.avgProgress += participant.progress_percentage || 0;
            stats.avgStreak += participant.streak_days || 0;
            stats.totalCheckIns += participant.check_ins_count || 0;

            if (participant.starting_weight_kg && participant.current_weight_kg) {
              stats.totalWeightLost += participant.starting_weight_kg - participant.current_weight_kg;
            }
          }

          const checkIns = memberCheckIns?.filter(c => c.user_id === member.user_id) || [];
          checkIns.forEach(checkIn => {
            stats.totalSteps += checkIn.steps || 0;
            stats.totalMinutes += checkIn.active_minutes || 0;
          });
        });

        // Calculate averages
        teamStats.forEach((stats, teamId) => {
          if (stats.memberCount > 0) {
            stats.avgProgress /= stats.memberCount;
            stats.avgStreak /= stats.memberCount;
          }
        });
      }

      // Build team leaderboard entries
      teamEntries = teams.map(team => {
        const stats = teamStats.get(team.id) || {
          totalPoints: 0,
          avgProgress: 0,
          totalWeightLost: 0,
          totalSteps: 0,
          totalMinutes: 0,
          totalCheckIns: 0,
          avgStreak: 0,
          memberCount: 0,
        };

        return {
          entity_id: team.id,
          entity_type: 'team' as const,
          points: stats.totalPoints,
          progress_percentage: stats.avgProgress,
          weight_lost_kg: challenge.type === 'weight_loss' ? stats.totalWeightLost : undefined,
          total_steps: stats.totalSteps,
          total_minutes: stats.totalMinutes,
          check_ins_count: stats.totalCheckIns,
          streak_days: Math.round(stats.avgStreak),
          stats: {
            member_count: stats.memberCount,
            avg_points_per_member: stats.memberCount > 0
              ? Math.round(stats.totalPoints / stats.memberCount)
              : 0,
            total_weight_lost: stats.totalWeightLost,
          },
        };
      });

      // Sort and rank teams
      teamEntries.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return b.progress_percentage - a.progress_percentage;
      });
    }

    // Clear existing leaderboard entries
    await supabase
      .from('leaderboard')
      .delete()
      .eq('challenge_id', challengeId);

    // Insert new rankings
    const allEntries = [
      ...individualEntries.map((entry, index) => ({
        challenge_id: challengeId,
        ...entry,
        rank: index + 1,
        previous_rank: previousRankings.get(`individual-${entry.entity_id}`)?.rank,
        trend: determineTrend(
          index + 1,
          previousRankings.get(`individual-${entry.entity_id}`)?.rank
        ),
        calculated_at: new Date().toISOString(),
      })),
      ...teamEntries.map((entry, index) => ({
        challenge_id: challengeId,
        ...entry,
        rank: index + 1,
        previous_rank: previousRankings.get(`team-${entry.entity_id}`)?.rank,
        trend: determineTrend(
          index + 1,
          previousRankings.get(`team-${entry.entity_id}`)?.rank
        ),
        calculated_at: new Date().toISOString(),
      })),
    ];

    if (allEntries.length > 0) {
      const { error: insertError } = await supabase
        .from('leaderboard')
        .insert(allEntries);

      if (insertError) {
        throw new Error(`Error inserting leaderboard entries: ${insertError.message}`);
      }

      // Update ranks in participants and teams tables
      const updatePromises = [
        ...individualEntries.map((entry, index) =>
          supabase
            .from('challenge_participants')
            .update({ rank: index + 1 })
            .eq('user_id', entry.entity_id)
            .eq('challenge_id', challengeId)
        ),
        ...teamEntries.map((entry, index) =>
          supabase
            .from('teams')
            .update({ rank: index + 1 })
            .eq('id', entry.entity_id)
        ),
      ];

      await Promise.all(updatePromises);
    }

    // Send notifications for significant rank changes
    const significantChanges = allEntries.filter(entry => {
      const prevRank = previousRankings.get(`${entry.entity_type}-${entry.entity_id}`)?.rank;
      if (!prevRank) return false;

      const rankChange = Math.abs(entry.rank - prevRank);
      return rankChange >= 3 || (entry.rank <= 3 && prevRank > 3) || (entry.rank > 3 && prevRank <= 3);
    });

    if (significantChanges.length > 0) {
      const notifications = significantChanges.map(async (entry) => {
        const prevRank = previousRankings.get(`${entry.entity_type}-${entry.entity_id}`)?.rank || 0;
        const improved = entry.rank < prevRank;

        if (entry.entity_type === 'individual') {
          return supabase
            .from('notifications')
            .insert({
              user_id: entry.entity_id,
              type: 'leaderboard_update',
              title: improved ? 'Climbing the ranks!' : 'Rank update',
              body: improved
                ? `You moved up from #${prevRank} to #${entry.rank}! Keep it up!`
                : `Your rank changed from #${prevRank} to #${entry.rank}. Time to push harder!`,
              related_challenge_id: challengeId,
              priority: entry.rank <= 3 ? 'high' : 'normal',
            });
        }
        return null;
      });

      await Promise.all(notifications.filter(Boolean));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Rankings calculated successfully',
        stats: {
          individuals: individualEntries.length,
          teams: teamEntries.length,
          significantChanges: significantChanges.length,
        },
        calculatedAt: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error calculating rankings:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

function determineTrend(currentRank: number, previousRank?: number): 'up' | 'down' | 'stable' {
  if (!previousRank) return 'stable';
  if (currentRank < previousRank) return 'up';
  if (currentRank > previousRank) return 'down';
  return 'stable';
}