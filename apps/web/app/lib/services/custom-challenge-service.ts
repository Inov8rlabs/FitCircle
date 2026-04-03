import { createAdminSupabase } from '../supabase-admin';
import { UNITS_BY_CATEGORY } from './template-service';

// ============================================================================
// Types
// ============================================================================

export interface CustomChallengeInput {
  name: string;
  description?: string;
  category: 'strength' | 'cardio' | 'flexibility' | 'wellness' | 'mixed';
  goal_amount: number;
  unit: string;
  duration_days: number;
  fitcircle_id?: string;
  quest_type?: 'individual' | 'collaborative' | 'competitive';
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  difficulty: string | null;
}

// All valid units across all categories
const ALL_VALID_UNITS = [
  'reps', 'minutes', 'km', 'miles', 'steps', 'workouts',
  'days', 'glasses', 'liters', 'songs', 'games', 'ft',
  'sets', 'calories', 'sessions', 'servings', 'nights',
];

// Difficulty thresholds per unit (goal_amount / duration_days)
const DIFFICULTY_THRESHOLDS: Record<string, { easy: number; medium: number; hard: number }> = {
  steps:    { easy: 5000, medium: 10000, hard: 15000 },
  minutes:  { easy: 15,   medium: 30,    hard: 60 },
  km:       { easy: 2,    medium: 5,     hard: 10 },
  miles:    { easy: 1,    medium: 3,     hard: 6 },
  reps:     { easy: 20,   medium: 50,    hard: 100 },
  workouts: { easy: 0.5,  medium: 1,     hard: 1.5 },
  glasses:  { easy: 6,    medium: 8,     hard: 12 },
  liters:   { easy: 1.5,  medium: 2.5,   hard: 3.5 },
  days:     { easy: 0.5,  medium: 0.7,   hard: 0.9 },
  sets:     { easy: 5,    medium: 10,    hard: 20 },
  calories: { easy: 200,  medium: 400,   hard: 600 },
  sessions: { easy: 0.5,  medium: 1,     hard: 1.5 },
};

// ============================================================================
// Custom Challenge Service
// ============================================================================

export class CustomChallengeService {
  // ============================================================================
  // VALIDATE
  // ============================================================================

  /**
   * Validate custom challenge data and return errors + difficulty estimate.
   */
  static validateChallenge(data: CustomChallengeInput): ValidationResult {
    const errors: string[] = [];

    // Name validation
    const name = data.name?.trim() || '';
    if (name.length < 3) {
      errors.push('Name must be at least 3 characters');
    }
    if (name.length > 100) {
      errors.push('Name must be at most 100 characters');
    }

    // Description validation
    if (data.description && data.description.length > 500) {
      errors.push('Description must be at most 500 characters');
    }

    // Category validation
    const validCategories = ['strength', 'cardio', 'flexibility', 'wellness', 'mixed'];
    if (!validCategories.includes(data.category)) {
      errors.push(`Category must be one of: ${validCategories.join(', ')}`);
    }

    // Goal validation
    if (!data.goal_amount || data.goal_amount <= 0) {
      errors.push('Goal amount must be greater than 0');
    }

    // Unit validation
    if (!ALL_VALID_UNITS.includes(data.unit)) {
      errors.push(`Unit must be one of: ${ALL_VALID_UNITS.join(', ')}`);
    }

    // Duration validation
    if (!data.duration_days || data.duration_days < 1) {
      errors.push('Duration must be at least 1 day');
    }
    if (data.duration_days > 365) {
      errors.push('Duration must be at most 365 days');
    }

    // Quest type validation
    if (data.quest_type && !['individual', 'collaborative', 'competitive'].includes(data.quest_type)) {
      errors.push('Quest type must be individual, collaborative, or competitive');
    }

    // Estimate difficulty if valid enough
    let difficulty: string | null = null;
    if (data.goal_amount > 0 && data.duration_days >= 1 && ALL_VALID_UNITS.includes(data.unit)) {
      difficulty = this.estimateDifficulty(data.goal_amount, data.unit, data.duration_days);
    }

    return {
      valid: errors.length === 0,
      errors,
      difficulty,
    };
  }

  // ============================================================================
  // ESTIMATE DIFFICULTY
  // ============================================================================

  /**
   * Estimate difficulty based on daily rate (goal / duration) compared to thresholds.
   */
  static estimateDifficulty(
    goalAmount: number,
    unit: string,
    durationDays: number
  ): string {
    const dailyRate = goalAmount / durationDays;
    const thresholds = DIFFICULTY_THRESHOLDS[unit];

    if (!thresholds) {
      // For units without thresholds, use a heuristic based on daily rate
      if (dailyRate <= 5) return 'easy';
      if (dailyRate <= 15) return 'medium';
      if (dailyRate <= 30) return 'hard';
      return 'extreme';
    }

    if (dailyRate <= thresholds.easy) return 'easy';
    if (dailyRate <= thresholds.medium) return 'medium';
    if (dailyRate <= thresholds.hard) return 'hard';
    return 'extreme';
  }

  // ============================================================================
  // GET UNITS
  // ============================================================================

  /**
   * Return all valid units with display names, optionally filtered by category.
   */
  static getUnits(category?: string): Record<string, string[]> | string[] {
    if (category && UNITS_BY_CATEGORY[category]) {
      return UNITS_BY_CATEGORY[category];
    }
    return UNITS_BY_CATEGORY;
  }

  // ============================================================================
  // CREATE CUSTOM CHALLENGE
  // ============================================================================

  /**
   * Create a fully custom challenge with validation.
   * If fitcircle_id is provided, creates a circle challenge and auto-joins creator.
   * If not, creates a solo challenge (fitcircle_id = null).
   */
  static async createCustomChallenge(
    userId: string,
    data: CustomChallengeInput
  ): Promise<Record<string, unknown>> {
    const supabaseAdmin = createAdminSupabase();

    // Validate
    const validation = this.validateChallenge(data);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
    }

    // If circle challenge, verify membership
    if (data.fitcircle_id) {
      const { count, error: memberError } = await supabaseAdmin
        .from('fitcircle_members')
        .select('*', { count: 'exact', head: true })
        .eq('fitcircle_id', data.fitcircle_id)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (memberError) throw memberError;
      if (!count || count === 0) {
        throw new Error('You must be an active member of this circle');
      }
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + data.duration_days);

    const questType = data.quest_type || 'competitive';
    const collectiveTarget = questType === 'collaborative' ? data.goal_amount : null;

    // Create the challenge
    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .insert({
        fitcircle_id: data.fitcircle_id || null,
        creator_id: userId,
        template_id: null,
        name: data.name.trim().slice(0, 100),
        description: data.description?.trim().slice(0, 500) || null,
        category: data.category,
        goal_amount: data.goal_amount,
        unit: data.unit.trim().slice(0, 20),
        logging_prompt: null,
        is_open: true,
        status: 'active',
        starts_at: now.toISOString(),
        ends_at: endsAt.toISOString(),
        participant_count: 1,
        quest_type: questType,
        collective_target: collectiveTarget,
        collective_progress: 0,
      })
      .select()
      .single();

    if (error) throw error;

    // Add creator as first participant
    const { error: participantError } = await supabaseAdmin
      .from('challenge_participants')
      .insert({
        challenge_id: challenge.id,
        user_id: userId,
        fitcircle_id: data.fitcircle_id || null,
        invited_by: userId,
        status: 'active',
        cumulative_total: 0,
        today_total: 0,
        today_date: now.toISOString().split('T')[0],
        current_streak: 0,
        longest_streak: 0,
        log_count: 0,
        goal_completion_pct: 0,
        milestones_achieved: {},
      });

    if (participantError) {
      console.error('[CustomChallengeService] Failed to add creator as participant:', participantError);
    }

    return {
      ...challenge,
      difficulty: validation.difficulty,
    };
  }
}
