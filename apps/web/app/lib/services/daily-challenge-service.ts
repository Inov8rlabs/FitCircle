import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface DailyChallenge {
  id: string;
  challenge_date: string;
  template_id: string | null;
  custom_name: string | null;
  custom_description: string | null;
  custom_goal_amount: number | null;
  custom_unit: string | null;
  is_custom: boolean;
  participant_count: number;
  completion_count: number;
  created_at: string;
  // Joined from template when template_id is present
  name: string;
  description: string | null;
  goal_amount: number;
  unit: string;
  difficulty: string | null;
  icon_name: string | null;
  challenge_category: string | null;
}

export interface DailyChallengeParticipant {
  id: string;
  daily_challenge_id: string;
  user_id: string;
  progress: number;
  is_completed: boolean;
  completed_at: string | null;
  joined_at: string;
}

export interface DailyChallengeWithProgress extends DailyChallenge {
  user_progress: number | null;
  user_completed: boolean;
  user_joined: boolean;
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  progress: number;
  is_completed: boolean;
  completed_at: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Custom fallback challenges when no templates match
const FALLBACK_CHALLENGES = [
  { name: '10-Minute Move', description: 'Get moving for at least 10 minutes today!', goal_amount: 10, unit: 'minutes', challenge_category: 'cardio', difficulty: 'easy' },
  { name: 'Step It Up', description: 'Hit 5,000 steps today', goal_amount: 5000, unit: 'steps', challenge_category: 'cardio', difficulty: 'easy' },
  { name: 'Hydration Hero', description: 'Drink 8 glasses of water today', goal_amount: 8, unit: 'glasses', challenge_category: 'wellness', difficulty: 'easy' },
  { name: 'Stretch Session', description: 'Spend 15 minutes stretching', goal_amount: 15, unit: 'minutes', challenge_category: 'flexibility', difficulty: 'easy' },
  { name: 'Bodyweight Blast', description: 'Complete 50 bodyweight reps (mix of squats, push-ups, lunges)', goal_amount: 50, unit: 'reps', challenge_category: 'strength', difficulty: 'medium' },
];

// ============================================================================
// SERVICE
// ============================================================================

export class DailyChallengeService {
  // ============================================================================
  // GET TODAY'S CHALLENGE
  // ============================================================================

  /**
   * Get today's daily challenge, creating one if it doesn't exist.
   * Optionally includes the user's progress if userId is provided.
   */
  static async getCurrentChallenge(userId?: string): Promise<DailyChallengeWithProgress> {
    const today = this.formatDate(new Date());

    console.log(`[DailyChallengeService.getCurrentChallenge] Getting challenge for ${today}`);

    // Try to get today's challenge
    let challenge = await this.getChallengeByDate(today);

    // If no challenge exists, generate one
    if (!challenge) {
      console.log(`[DailyChallengeService.getCurrentChallenge] No challenge found, generating`);
      challenge = await this.generateChallengeForDate(today);
    }

    // Get user progress if userId provided
    let userProgress: number | null = null;
    let userCompleted = false;
    let userJoined = false;

    if (userId) {
      const participant = await this.getParticipant(challenge.id, userId);
      if (participant) {
        userProgress = participant.progress;
        userCompleted = participant.is_completed;
        userJoined = true;
      }
    }

    return {
      ...challenge,
      user_progress: userProgress,
      user_completed: userCompleted,
      user_joined: userJoined,
    };
  }

  // ============================================================================
  // CHALLENGE GENERATION
  // ============================================================================

  /**
   * Generate a daily challenge for a given date.
   * Algorithm:
   * - 40% from daily_micro category templates
   * - 30% seasonal/themed (weekend = longer, Monday = easier)
   * - 20% community-driven (popular templates by completions_count)
   * - 10% fallback custom challenges
   */
  static async generateChallengeForDate(date: string): Promise<DailyChallenge> {
    const supabaseAdmin = createAdminSupabase();
    const dayOfWeek = new Date(date).getDay();
    const dayName = DAY_NAMES[dayOfWeek];

    console.log(`[DailyChallengeService.generateChallengeForDate] Generating for ${date} (${dayName})`);

    // Roll the dice on which strategy to use
    const roll = Math.random();
    let template = null;

    if (roll < 0.4) {
      // 40%: Random daily_micro template
      template = await this.getRandomTemplate('daily_micro');
    } else if (roll < 0.7) {
      // 30%: Themed by day of week
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isMonday = dayOfWeek === 1;

      if (isMonday) {
        template = await this.getRandomTemplate('daily_micro', 'easy');
      } else if (isWeekend) {
        template = await this.getRandomTemplate('daily_micro', 'medium');
      } else {
        template = await this.getRandomTemplate('daily_micro');
      }
    } else if (roll < 0.9) {
      // 20%: Popular template (by completions_count)
      template = await this.getPopularTemplate();
    }
    // 10%: Falls through to fallback

    if (template) {
      // Create from template
      const { data, error } = await supabaseAdmin
        .from('daily_challenges')
        .insert({
          challenge_date: date,
          template_id: template.id,
          is_custom: false,
        })
        .select()
        .single();

      if (error) {
        // Handle unique constraint (race condition — another process created it)
        if (error.code === '23505') {
          const existing = await this.getChallengeByDate(date);
          if (existing) return existing;
        }
        throw error;
      }

      return this.enrichChallenge(data, template);
    }

    // Fallback: use a custom challenge
    const fallback = FALLBACK_CHALLENGES[Math.floor(Math.random() * FALLBACK_CHALLENGES.length)];

    const { data, error } = await supabaseAdmin
      .from('daily_challenges')
      .insert({
        challenge_date: date,
        is_custom: true,
        custom_name: fallback.name,
        custom_description: fallback.description,
        custom_goal_amount: fallback.goal_amount,
        custom_unit: fallback.unit,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.getChallengeByDate(date);
        if (existing) return existing;
      }
      throw error;
    }

    return this.enrichChallenge(data, null, fallback);
  }

  // ============================================================================
  // JOIN CHALLENGE
  // ============================================================================

  /**
   * Add user as a participant in today's challenge. Idempotent.
   */
  static async joinChallenge(userId: string, challengeId: string): Promise<DailyChallengeParticipant> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[DailyChallengeService.joinChallenge] User ${userId} joining ${challengeId}`);

    // Check if already joined
    const existing = await this.getParticipant(challengeId, userId);
    if (existing) {
      console.log(`[DailyChallengeService.joinChallenge] Already joined, returning existing`);
      return existing;
    }

    const { data, error } = await supabaseAdmin
      .from('daily_challenge_participants')
      .insert({
        daily_challenge_id: challengeId,
        user_id: userId,
        progress: 0,
        is_completed: false,
      })
      .select()
      .single();

    if (error) {
      // Handle race condition
      if (error.code === '23505') {
        const retried = await this.getParticipant(challengeId, userId);
        if (retried) return retried;
      }
      throw error;
    }

    // Increment participant count (fire and forget)
    this.updateParticipantCount(challengeId, 1).catch((err) =>
      console.error('[DailyChallengeService.joinChallenge] Count update error:', err)
    );

    return data as DailyChallengeParticipant;
  }

  // ============================================================================
  // UPDATE PROGRESS
  // ============================================================================

  /**
   * Update a user's progress toward the daily challenge goal.
   * Auto-completes if progress >= goal.
   */
  static async updateProgress(
    userId: string,
    challengeId: string,
    progress: number
  ): Promise<{ progress: number; is_completed: boolean; completed_at: string | null }> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[DailyChallengeService.updateProgress] User ${userId}, challenge ${challengeId}, progress: ${progress}`);

    // Get the challenge to check goal
    const challenge = await this.getChallengeById(challengeId);
    if (!challenge) throw new Error('Challenge not found');

    const goalAmount = challenge.goal_amount;

    // Check auto-completion
    const isCompleted = progress >= goalAmount;
    const completedAt = isCompleted ? new Date().toISOString() : null;

    const { data, error } = await supabaseAdmin
      .from('daily_challenge_participants')
      .update({
        progress,
        is_completed: isCompleted,
        completed_at: completedAt,
      })
      .eq('daily_challenge_id', challengeId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Not a participant');
      throw error;
    }

    // If just completed, increment completion count
    if (isCompleted && !data.completed_at) {
      this.updateCompletionCount(challengeId, 1).catch((err) =>
        console.error('[DailyChallengeService.updateProgress] Completion count error:', err)
      );
    }

    return {
      progress: data.progress,
      is_completed: data.is_completed,
      completed_at: data.completed_at,
    };
  }

  // ============================================================================
  // LEADERBOARD
  // ============================================================================

  /**
   * Get today's challenge participants ranked by progress.
   */
  static async getLeaderboard(challengeId: string, limit: number = 20): Promise<LeaderboardEntry[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_challenge_participants')
      .select(`
        user_id,
        progress,
        is_completed,
        completed_at,
        profiles!inner(display_name, avatar_url)
      `)
      .eq('daily_challenge_id', challengeId)
      .order('progress', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[DailyChallengeService.getLeaderboard] Error:`, error);
      throw error;
    }

    return (data || []).map((row: Record<string, unknown>) => {
      const profile = row.profiles as Record<string, unknown>;
      return {
        user_id: row.user_id as string,
        display_name: (profile?.display_name as string) || 'Anonymous',
        avatar_url: (profile?.avatar_url as string) || null,
        progress: row.progress as number,
        is_completed: row.is_completed as boolean,
        completed_at: row.completed_at as string | null,
      };
    });
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  private static async getChallengeByDate(date: string): Promise<DailyChallenge | null> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', date)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    // If it has a template, fetch template details
    if (data.template_id) {
      const { data: template } = await supabaseAdmin
        .from('challenge_templates')
        .select('*')
        .eq('id', data.template_id)
        .single();

      return this.enrichChallenge(data, template);
    }

    return this.enrichChallenge(data, null);
  }

  private static async getChallengeById(challengeId: string): Promise<DailyChallenge | null> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    if (data.template_id) {
      const { data: template } = await supabaseAdmin
        .from('challenge_templates')
        .select('*')
        .eq('id', data.template_id)
        .single();

      return this.enrichChallenge(data, template);
    }

    return this.enrichChallenge(data, null);
  }

  private static async getParticipant(
    challengeId: string,
    userId: string
  ): Promise<DailyChallengeParticipant | null> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_challenge_participants')
      .select('*')
      .eq('daily_challenge_id', challengeId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as DailyChallengeParticipant;
  }

  private static async getRandomTemplate(
    category: string,
    difficulty?: string
  ): Promise<Record<string, unknown> | null> {
    const supabaseAdmin = createAdminSupabase();

    let query = supabaseAdmin
      .from('challenge_templates')
      .select('*')
      .eq('category', category)
      .eq('is_active', true);

    if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) return null;

    // Random pick
    return data[Math.floor(Math.random() * data.length)];
  }

  private static async getPopularTemplate(): Promise<Record<string, unknown> | null> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('challenge_templates')
      .select('*')
      .eq('is_active', true)
      .eq('category', 'daily_micro')
      .order('completions_count', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) return null;

    // Pick randomly from top 10 most popular
    return data[Math.floor(Math.random() * data.length)];
  }

  /**
   * Merge challenge row with template or custom data to produce a unified DailyChallenge.
   */
  private static enrichChallenge(
    row: Record<string, unknown>,
    template: Record<string, unknown> | null,
    fallback?: { name: string; description: string; goal_amount: number; unit: string; challenge_category: string; difficulty: string }
  ): DailyChallenge {
    if (template) {
      return {
        id: row.id as string,
        challenge_date: row.challenge_date as string,
        template_id: row.template_id as string,
        custom_name: null,
        custom_description: null,
        custom_goal_amount: null,
        custom_unit: null,
        is_custom: false,
        participant_count: (row.participant_count as number) || 0,
        completion_count: (row.completion_count as number) || 0,
        created_at: row.created_at as string,
        name: template.name as string,
        description: (template.description as string) || null,
        goal_amount: template.goal_amount as number,
        unit: template.unit as string,
        difficulty: (template.difficulty as string) || null,
        icon_name: (template.icon_name as string) || null,
        challenge_category: (template.challenge_category as string) || null,
      };
    }

    // Custom challenge (from DB or fallback)
    return {
      id: row.id as string,
      challenge_date: row.challenge_date as string,
      template_id: null,
      custom_name: (row.custom_name as string) || null,
      custom_description: (row.custom_description as string) || null,
      custom_goal_amount: (row.custom_goal_amount as number) || null,
      custom_unit: (row.custom_unit as string) || null,
      is_custom: true,
      participant_count: (row.participant_count as number) || 0,
      completion_count: (row.completion_count as number) || 0,
      created_at: row.created_at as string,
      name: (row.custom_name as string) || fallback?.name || 'Daily Challenge',
      description: (row.custom_description as string) || fallback?.description || null,
      goal_amount: (row.custom_goal_amount as number) || fallback?.goal_amount || 0,
      unit: (row.custom_unit as string) || fallback?.unit || 'units',
      difficulty: fallback?.difficulty || null,
      icon_name: null,
      challenge_category: fallback?.challenge_category || null,
    };
  }

  private static async updateParticipantCount(challengeId: string, delta: number): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error: fetchError } = await supabaseAdmin
      .from('daily_challenges')
      .select('participant_count')
      .eq('id', challengeId)
      .single();

    if (fetchError || !data) return;

    const newCount = Math.max(0, (data.participant_count || 0) + delta);

    await supabaseAdmin
      .from('daily_challenges')
      .update({ participant_count: newCount })
      .eq('id', challengeId);
  }

  private static async updateCompletionCount(challengeId: string, delta: number): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error: fetchError } = await supabaseAdmin
      .from('daily_challenges')
      .select('completion_count')
      .eq('id', challengeId)
      .single();

    if (fetchError || !data) return;

    const newCount = Math.max(0, (data.completion_count || 0) + delta);

    await supabaseAdmin
      .from('daily_challenges')
      .update({ completion_count: newCount })
      .eq('id', challengeId);
  }

  private static formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
