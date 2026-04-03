import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// Types
// ============================================================================

export interface ChallengeTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  challenge_category: string;
  goal_amount: number;
  unit: string;
  duration_days: number;
  logging_prompt: string | null;
  difficulty: string | null;
  icon_name: string | null;
  sort_order: number;
  is_active: boolean;
  completions_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TemplateFilters {
  category?: string;
  difficulty?: string;
  is_active?: boolean;
}

// Valid units grouped by challenge category
export const UNITS_BY_CATEGORY: Record<string, string[]> = {
  strength: ['reps', 'minutes', 'sets', 'days'],
  cardio: ['steps', 'km', 'miles', 'minutes', 'calories', 'reps', 'songs', 'games', 'days', 'ft'],
  flexibility: ['minutes', 'sessions', 'days'],
  wellness: ['glasses', 'liters', 'minutes', 'servings', 'nights', 'days'],
  mixed: ['workouts', 'minutes', 'days'],
};

// ============================================================================
// Template Service
// ============================================================================

export class TemplateService {
  // ============================================================================
  // LIST & GET
  // ============================================================================

  /**
   * List templates with optional filters, sorted by sort_order
   */
  static async listTemplates(filters: TemplateFilters = {}): Promise<ChallengeTemplateRow[]> {
    const supabaseAdmin = createAdminSupabase();

    let query = supabaseAdmin
      .from('challenge_templates')
      .select('*')
      .order('sort_order', { ascending: true });

    // Default to active-only unless explicitly set to false
    const isActive = filters.is_active ?? true;
    query = query.eq('is_active', isActive);

    if (filters.category) {
      query = query.eq('category', filters.category);
    }

    if (filters.difficulty) {
      query = query.eq('difficulty', filters.difficulty);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Get a single template by ID
   */
  static async getTemplate(templateId: string): Promise<ChallengeTemplateRow> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('challenge_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (error) throw error;
    if (!data) throw new Error('Template not found');

    return data;
  }

  // ============================================================================
  // CREATE FROM TEMPLATE
  // ============================================================================

  /**
   * Create a challenge record from a template, copying all values.
   * The created challenge is independent — no ongoing reference to the template.
   */
  static async createFromTemplate(
    templateId: string,
    fitcircleId: string,
    userId: string
  ): Promise<Record<string, unknown>> {
    const supabaseAdmin = createAdminSupabase();

    // Get template
    const template = await this.getTemplate(templateId);

    // Verify user is a member of the circle
    const { data: membership, error: memberError } = await supabaseAdmin
      .from('fitcircle_members')
      .select('id')
      .eq('fitcircle_id', fitcircleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (memberError || !membership) {
      throw new Error('You must be a member of this circle');
    }

    // Calculate start/end dates
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + template.duration_days);

    // Determine quest_type based on template category
    const questType = ['collaborative', 'epic'].includes(template.category)
      ? 'collaborative'
      : 'competitive';

    // Create the challenge — values are copied, not referenced
    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .insert({
        fitcircle_id: fitcircleId,
        creator_id: userId,
        template_id: templateId,
        name: template.name,
        description: template.description,
        category: template.challenge_category,
        goal_amount: template.goal_amount,
        unit: template.unit,
        logging_prompt: template.logging_prompt,
        is_open: true,
        status: 'active',
        starts_at: now.toISOString(),
        ends_at: endsAt.toISOString(),
        participant_count: 1,
        quest_type: questType,
        collective_target: questType === 'collaborative' ? template.goal_amount : null,
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
        fitcircle_id: fitcircleId,
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
      console.error('[TemplateService] Failed to add creator as participant:', participantError);
    }

    // Increment template completions count (fire and forget)
    this.incrementCompletions(templateId).catch((err) =>
      console.error('[TemplateService] Failed to increment completions:', err)
    );

    return challenge;
  }

  // ============================================================================
  // COMPLETIONS TRACKING
  // ============================================================================

  /**
   * Increment the completions_count for a template (used for popularity ranking)
   */
  static async incrementCompletions(templateId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { data: template, error: fetchError } = await supabaseAdmin
      .from('challenge_templates')
      .select('completions_count')
      .eq('id', templateId)
      .single();

    if (fetchError || !template) return;

    const { error } = await supabaseAdmin
      .from('challenge_templates')
      .update({ completions_count: (template.completions_count || 0) + 1 })
      .eq('id', templateId);

    if (error) {
      console.error('[TemplateService] Failed to update completions_count:', error);
    }
  }
}
