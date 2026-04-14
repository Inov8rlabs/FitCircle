import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// Types
// ============================================================================

export interface CreateQuestInput {
  quest_name: string;
  quest_description?: string;
  quest_type: 'individual' | 'collaborative' | 'competitive';
  goal_amount: number;
  unit: string;
  collective_target?: number;
  starts_at: string;
  ends_at: string;
  template_id?: string;
  challenge_id?: string;
  metadata?: Record<string, unknown>;
}

export interface QuestWithProgress {
  id: string;
  fitcircle_id: string;
  challenge_id: string | null;
  template_id: string | null;
  quest_name: string;
  quest_description: string | null;
  quest_type: string;
  goal_amount: number;
  unit: string;
  collective_target: number | null;
  collective_progress: number;
  starts_at: string;
  ends_at: string;
  status: string;
  created_by: string;
  metadata: Record<string, unknown>;
  created_at: string;
  my_progress: number;
  my_completed: boolean;
  participant_count: number;
  days_remaining: number;
  completion_pct: number;
}

export interface QuestLeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  individual_progress: number;
  is_completed: boolean;
  completed_at: string | null;
  is_current_user: boolean;
}

// ============================================================================
// Circle Quest Service
// ============================================================================

export class CircleQuestService {
  // ============================================================================
  // CREATE QUEST
  // ============================================================================

  /**
   * Create a quest from custom data or from a template.
   * Validates that the creator is a circle member.
   */
  static async createQuest(
    fitcircleId: string,
    creatorId: string,
    input: CreateQuestInput
  ): Promise<Record<string, unknown>> {
    const supabaseAdmin = createAdminSupabase();

    // Verify creator is circle member
    await this.verifyCircleMembership(creatorId, fitcircleId);

    // Validate inputs
    const questName = input.quest_name.trim().slice(0, 100);
    if (questName.length < 3) {
      throw new Error('Quest name must be at least 3 characters');
    }

    if (input.goal_amount <= 0) {
      throw new Error('Goal amount must be greater than 0');
    }

    const startsAt = new Date(input.starts_at);
    const endsAt = new Date(input.ends_at);
    if (endsAt <= startsAt) {
      throw new Error('End date must be after start date');
    }

    // For collaborative quests, collective_target defaults to goal_amount
    const collectiveTarget =
      input.quest_type === 'collaborative'
        ? input.collective_target ?? input.goal_amount
        : null;

    // Determine initial status
    const now = new Date();
    const status = startsAt <= now ? 'active' : 'pending';

    const { data: quest, error } = await supabaseAdmin
      .from('circle_quests')
      .insert({
        fitcircle_id: fitcircleId,
        challenge_id: input.challenge_id || null,
        template_id: input.template_id || null,
        quest_name: questName,
        quest_description: input.quest_description?.trim().slice(0, 500) || null,
        quest_type: input.quest_type,
        goal_amount: input.goal_amount,
        unit: input.unit.trim().slice(0, 20),
        collective_target: collectiveTarget,
        collective_progress: 0,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        status,
        created_by: creatorId,
        metadata: input.metadata || {},
      })
      .select()
      .single();

    if (error) throw error;

    // Auto-enroll the creator
    await supabaseAdmin
      .from('circle_quest_progress')
      .insert({
        quest_id: quest.id,
        user_id: creatorId,
        individual_progress: 0,
        is_completed: false,
      });

    return quest;
  }

  // ============================================================================
  // GET ACTIVE QUESTS
  // ============================================================================

  /**
   * List active quests for a circle, enriched with user progress and participant count.
   */
  static async getActiveQuests(
    fitcircleId: string,
    userId: string
  ): Promise<QuestWithProgress[]> {
    const supabaseAdmin = createAdminSupabase();

    // Verify membership
    await this.verifyCircleMembership(userId, fitcircleId);

    const { data: quests, error } = await supabaseAdmin
      .from('circle_quests')
      .select('*')
      .eq('fitcircle_id', fitcircleId)
      .in('status', ['active', 'pending'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    return Promise.all(
      (quests || []).map((q) => this.enrichQuest(q, userId))
    );
  }

  // ============================================================================
  // GET QUEST DETAIL
  // ============================================================================

  /**
   * Get a single quest with the user's progress and the leaderboard.
   */
  static async getQuestDetail(
    questId: string,
    userId: string
  ): Promise<{ quest: QuestWithProgress; leaderboard: QuestLeaderboardEntry[] }> {
    const supabaseAdmin = createAdminSupabase();

    const { data: quest, error } = await supabaseAdmin
      .from('circle_quests')
      .select('*')
      .eq('id', questId)
      .single();

    if (error) throw error;

    // Verify membership
    await this.verifyCircleMembership(userId, quest.fitcircle_id);

    const [enriched, leaderboard] = await Promise.all([
      this.enrichQuest(quest, userId),
      this.getQuestLeaderboard(questId, userId),
    ]);

    return { quest: enriched, leaderboard };
  }

  // ============================================================================
  // UPDATE PROGRESS
  // ============================================================================

  /**
   * Update individual progress for a user on a quest.
   * Also updates collective_progress for collaborative quests.
   * Auto-completes if individual goal or collective target met.
   */
  static async updateProgress(
    questId: string,
    userId: string,
    progressAmount: number
  ): Promise<{
    individual_progress: number;
    collective_progress: number | null;
    is_completed: boolean;
    quest_completed: boolean;
  }> {
    const supabaseAdmin = createAdminSupabase();

    if (progressAmount <= 0) {
      throw new Error('Progress amount must be greater than 0');
    }

    // Get quest
    const { data: quest, error: questError } = await supabaseAdmin
      .from('circle_quests')
      .select('*')
      .eq('id', questId)
      .single();

    if (questError) throw questError;

    if (quest.status !== 'active') {
      throw new Error('Can only update progress on active quests');
    }

    if (new Date() > new Date(quest.ends_at)) {
      throw new Error('This quest has ended');
    }

    // Verify membership
    await this.verifyCircleMembership(userId, quest.fitcircle_id);

    // Upsert progress record (create if doesn't exist)
    const { data: existing } = await supabaseAdmin
      .from('circle_quest_progress')
      .select('*')
      .eq('quest_id', questId)
      .eq('user_id', userId)
      .maybeSingle();

    let newIndividualProgress: number;
    let isCompleted: boolean;

    if (existing) {
      if (existing.is_completed) {
        throw new Error('You have already completed this quest');
      }
      newIndividualProgress = (existing.individual_progress || 0) + progressAmount;
      isCompleted = newIndividualProgress >= quest.goal_amount;

      const { error: updateError } = await supabaseAdmin
        .from('circle_quest_progress')
        .update({
          individual_progress: newIndividualProgress,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) throw updateError;
    } else {
      newIndividualProgress = progressAmount;
      isCompleted = newIndividualProgress >= quest.goal_amount;

      const { error: insertError } = await supabaseAdmin
        .from('circle_quest_progress')
        .insert({
          quest_id: questId,
          user_id: userId,
          individual_progress: newIndividualProgress,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        });

      if (insertError) throw insertError;
    }

    // Update collective progress for collaborative quests
    let collectiveProgress: number | null = null;
    let questCompleted = false;

    if (quest.quest_type === 'collaborative') {
      // Sum all participants' individual progress
      const { data: allProgress } = await supabaseAdmin
        .from('circle_quest_progress')
        .select('individual_progress')
        .eq('quest_id', questId);

      collectiveProgress = (allProgress || []).reduce(
        (sum, p) => sum + (p.individual_progress || 0),
        0
      );

      const { error: collectiveError } = await supabaseAdmin
        .from('circle_quests')
        .update({ collective_progress: collectiveProgress })
        .eq('id', questId);

      if (collectiveError) {
        console.error('[CircleQuestService] Failed to update collective progress:', collectiveError);
      }

      // Auto-complete collaborative quest if collective target met
      if (quest.collective_target && collectiveProgress >= quest.collective_target) {
        questCompleted = true;
        await this.completeQuest(questId);
      }
    }

    // For individual/competitive quests, check if all participants completed
    if (quest.quest_type === 'individual' || quest.quest_type === 'competitive') {
      const { count: totalParticipants } = await supabaseAdmin
        .from('circle_quest_progress')
        .select('*', { count: 'exact', head: true })
        .eq('quest_id', questId);

      const { count: completedParticipants } = await supabaseAdmin
        .from('circle_quest_progress')
        .select('*', { count: 'exact', head: true })
        .eq('quest_id', questId)
        .eq('is_completed', true);

      if (totalParticipants && completedParticipants && completedParticipants >= totalParticipants) {
        questCompleted = true;
        await this.completeQuest(questId);
      }
    }

    return {
      individual_progress: newIndividualProgress,
      collective_progress: collectiveProgress,
      is_completed: isCompleted,
      quest_completed: questCompleted,
    };
  }

  // ============================================================================
  // QUEST LEADERBOARD
  // ============================================================================

  /**
   * Ranked participants by progress (descending).
   */
  static async getQuestLeaderboard(
    questId: string,
    userId: string
  ): Promise<QuestLeaderboardEntry[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data: progress, error } = await supabaseAdmin
      .from('circle_quest_progress')
      .select(`
        *,
        profiles!circle_quest_progress_user_id_fkey (display_name, avatar_url)
      `)
      .eq('quest_id', questId)
      .order('individual_progress', { ascending: false });

    if (error) throw error;

    return (progress || []).map((p, index) => {
      const profile = p.profiles;
      return {
        rank: index + 1,
        user_id: p.user_id,
        display_name: profile?.display_name || 'Anonymous',
        avatar_url: profile?.avatar_url || null,
        individual_progress: p.individual_progress || 0,
        is_completed: p.is_completed || false,
        completed_at: p.completed_at || null,
        is_current_user: p.user_id === userId,
      };
    });
  }

  // ============================================================================
  // CRON: CHECK EXPIRED QUESTS
  // ============================================================================

  /**
   * Mark expired quests and activate pending quests.
   * Should be called by a cron endpoint.
   */
  static async checkExpiredQuests(): Promise<{ expired: number; activated: number }> {
    const supabaseAdmin = createAdminSupabase();
    const now = new Date().toISOString();

    // Activate pending quests whose start time has passed
    const { data: toActivate } = await supabaseAdmin
      .from('circle_quests')
      .update({ status: 'active' })
      .eq('status', 'pending')
      .lte('starts_at', now)
      .select('id');

    // Expire active quests whose end time has passed
    const { data: toExpire } = await supabaseAdmin
      .from('circle_quests')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lte('ends_at', now)
      .select('id');

    return {
      expired: toExpire?.length || 0,
      activated: toActivate?.length || 0,
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private static async completeQuest(questId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('circle_quests')
      .update({ status: 'completed' })
      .eq('id', questId);

    if (error) {
      console.error('[CircleQuestService] Failed to complete quest:', error);
    }
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

  private static async enrichQuest(
    quest: any,
    userId: string
  ): Promise<QuestWithProgress> {
    const supabaseAdmin = createAdminSupabase();

    // Get user's own progress
    const { data: myProgress } = await supabaseAdmin
      .from('circle_quest_progress')
      .select('individual_progress, is_completed')
      .eq('quest_id', quest.id)
      .eq('user_id', userId)
      .maybeSingle();

    // Get participant count
    const { count: participantCount } = await supabaseAdmin
      .from('circle_quest_progress')
      .select('*', { count: 'exact', head: true })
      .eq('quest_id', quest.id);

    const now = new Date();
    const endsAt = new Date(quest.ends_at);
    const daysRemaining = Math.max(
      0,
      Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    // Calculate completion percentage based on quest type
    let completionPct: number;
    if (quest.quest_type === 'collaborative' && quest.collective_target) {
      completionPct = Math.min(
        ((quest.collective_progress || 0) / quest.collective_target) * 100,
        100
      );
    } else {
      const userProgress = myProgress?.individual_progress || 0;
      completionPct = Math.min((userProgress / quest.goal_amount) * 100, 100);
    }

    return {
      id: quest.id,
      fitcircle_id: quest.fitcircle_id,
      challenge_id: quest.challenge_id,
      template_id: quest.template_id,
      quest_name: quest.quest_name,
      quest_description: quest.quest_description,
      quest_type: quest.quest_type,
      goal_amount: quest.goal_amount,
      unit: quest.unit,
      collective_target: quest.collective_target,
      collective_progress: quest.collective_progress || 0,
      starts_at: quest.starts_at,
      ends_at: quest.ends_at,
      status: quest.status,
      created_by: quest.created_by,
      metadata: quest.metadata || {},
      created_at: quest.created_at,
      my_progress: myProgress?.individual_progress || 0,
      my_completed: myProgress?.is_completed || false,
      participant_count: participantCount || 0,
      days_remaining: daysRemaining,
      completion_pct: Math.round(completionPct * 100) / 100,
    };
  }
}
