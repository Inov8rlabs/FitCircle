import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface AssessmentQuestion {
  key: string;
  question: string;
  type: 'single' | 'multi';
  options: { value: string; label: string }[];
}

export interface AssessmentResponses {
  exercise_frequency: string;
  primary_goal: string;
  preferred_workouts: string[];
  daily_time: string;
  fitness_self_assessment: string;
}

export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type TimeCommitment = 'light' | 'moderate' | 'intense' | 'extreme';

export interface OnboardingStatus {
  hasCompletedAssessment: boolean;
  hasCompletedOnboarding: boolean;
  currentStep: number;
  completedSteps: string[];
  nextStep: string | null;
  fitnessLevel: FitnessLevel | null;
  preferredWorkoutTypes: string[];
}

export interface CircleRecommendation {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  matchReason: string;
  matchScore: number;
}

// ============================================================================
// ASSESSMENT QUESTIONS (hardcoded)
// ============================================================================

const ASSESSMENT_QUESTIONS: AssessmentQuestion[] = [
  {
    key: 'exercise_frequency',
    question: 'How often do you currently exercise?',
    type: 'single',
    options: [
      { value: 'never', label: 'Never' },
      { value: '1-2x_week', label: '1-2 times per week' },
      { value: '3-4x_week', label: '3-4 times per week' },
      { value: 'daily', label: 'Daily' },
    ],
  },
  {
    key: 'primary_goal',
    question: "What's your primary fitness goal?",
    type: 'single',
    options: [
      { value: 'lose_weight', label: 'Lose Weight' },
      { value: 'gain_muscle', label: 'Gain Muscle' },
      { value: 'improve_cardio', label: 'Improve Cardio' },
      { value: 'maintain_health', label: 'Maintain Health' },
      { value: 'stress_relief', label: 'Stress Relief' },
    ],
  },
  {
    key: 'preferred_workouts',
    question: 'What types of workouts do you prefer?',
    type: 'multi',
    options: [
      { value: 'cardio', label: 'Cardio' },
      { value: 'strength', label: 'Strength Training' },
      { value: 'yoga', label: 'Yoga' },
      { value: 'sports', label: 'Sports' },
      { value: 'dancing', label: 'Dancing' },
      { value: 'outdoor', label: 'Outdoor Activities' },
      { value: 'home_workouts', label: 'Home Workouts' },
    ],
  },
  {
    key: 'daily_time',
    question: 'How much time can you commit to exercise daily?',
    type: 'single',
    options: [
      { value: '15min', label: '15 minutes' },
      { value: '30min', label: '30 minutes' },
      { value: '45min', label: '45 minutes' },
      { value: '60min', label: '60 minutes' },
      { value: '90min+', label: '90+ minutes' },
    ],
  },
  {
    key: 'fitness_self_assessment',
    question: 'How would you describe your current fitness level?',
    type: 'single',
    options: [
      { value: 'complete_beginner', label: 'Complete Beginner' },
      { value: 'some_experience', label: 'Some Experience' },
      { value: 'regular_exerciser', label: 'Regular Exerciser' },
      { value: 'very_fit', label: 'Very Fit' },
    ],
  },
];

// ============================================================================
// SCORING LOGIC
// ============================================================================

function calculateFitnessLevel(responses: AssessmentResponses): FitnessLevel {
  let score = 0;

  // Frequency scoring (0-3)
  const frequencyScores: Record<string, number> = {
    never: 0,
    '1-2x_week': 1,
    '3-4x_week': 2,
    daily: 3,
  };
  score += frequencyScores[responses.exercise_frequency] ?? 0;

  // Self-assessment scoring (0-3)
  const selfAssessmentScores: Record<string, number> = {
    complete_beginner: 0,
    some_experience: 1,
    regular_exerciser: 2,
    very_fit: 3,
  };
  score += selfAssessmentScores[responses.fitness_self_assessment] ?? 0;

  // Time commitment scoring (0-2)
  const timeScores: Record<string, number> = {
    '15min': 0,
    '30min': 0,
    '45min': 1,
    '60min': 1,
    '90min+': 2,
  };
  score += timeScores[responses.daily_time] ?? 0;

  // Total: 0-8
  if (score <= 2) return 'beginner';
  if (score <= 4) return 'intermediate';
  if (score <= 6) return 'advanced';
  return 'expert';
}

function calculateTimeCommitment(dailyTime: string): TimeCommitment {
  const mapping: Record<string, TimeCommitment> = {
    '15min': 'light',
    '30min': 'light',
    '45min': 'moderate',
    '60min': 'intense',
    '90min+': 'extreme',
  };
  return mapping[dailyTime] ?? 'moderate';
}

// ============================================================================
// ASSESSMENT SERVICE
// ============================================================================

export class AssessmentService {
  /**
   * Return assessment questionnaire structure
   */
  static getAssessmentQuestions(): AssessmentQuestion[] {
    return ASSESSMENT_QUESTIONS;
  }

  /**
   * Save all responses, calculate fitness_level, set has_completed_assessment
   */
  static async submitAssessment(
    userId: string,
    responses: AssessmentResponses
  ): Promise<{
    fitnessLevel: FitnessLevel;
    timeCommitment: TimeCommitment;
    preferredWorkoutTypes: string[];
  }> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[AssessmentService.submitAssessment] Processing for user:', userId);

    // Calculate derived values
    const fitnessLevel = calculateFitnessLevel(responses);
    const timeCommitment = calculateTimeCommitment(responses.daily_time);
    const preferredWorkoutTypes = responses.preferred_workouts || [];

    // Save individual responses to onboarding_responses (upsert)
    const responseEntries = Object.entries(responses).map(([key, value]) => ({
      user_id: userId,
      question_key: key,
      response_value: JSON.stringify(value),
    }));

    for (const entry of responseEntries) {
      const { error } = await supabaseAdmin
        .from('onboarding_responses')
        .upsert(entry, { onConflict: 'user_id,question_key' });

      if (error) {
        console.error('[AssessmentService.submitAssessment] Error saving response:', entry.question_key, error);
        throw error;
      }
    }

    // Update profile with calculated values
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        fitness_level: fitnessLevel,
        time_commitment: timeCommitment,
        preferred_workout_types: preferredWorkoutTypes,
        has_completed_assessment: true,
      })
      .eq('id', userId);

    if (profileError) {
      console.error('[AssessmentService.submitAssessment] Error updating profile:', profileError);
      throw profileError;
    }

    console.log('[AssessmentService.submitAssessment] Assessment completed:', {
      fitnessLevel,
      timeCommitment,
      preferredWorkoutTypes,
    });

    return { fitnessLevel, timeCommitment, preferredWorkoutTypes };
  }

  /**
   * Return current onboarding progress, completed steps, next step
   */
  static async getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
    const supabaseAdmin = createAdminSupabase();

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select(
        'has_completed_assessment, onboarding_completed, fitness_level, preferred_workout_types, onboarding_current_step'
      )
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[AssessmentService.getOnboardingStatus] Error:', error);
      throw error;
    }

    const hasCompletedAssessment = profile.has_completed_assessment ?? false;
    const hasCompletedOnboarding = profile.onboarding_completed ?? false;
    const currentStep = profile.onboarding_current_step ?? 0;

    // Determine completed steps and next step
    const completedSteps: string[] = [];
    if (currentStep >= 1) completedSteps.push('profile_setup');
    if (hasCompletedAssessment) completedSteps.push('fitness_assessment');
    if (currentStep >= 3) completedSteps.push('goal_setting');
    if (currentStep >= 4) completedSteps.push('circle_recommendations');
    if (hasCompletedOnboarding) completedSteps.push('onboarding_complete');

    let nextStep: string | null = null;
    if (!hasCompletedOnboarding) {
      if (currentStep < 1) nextStep = 'profile_setup';
      else if (!hasCompletedAssessment) nextStep = 'fitness_assessment';
      else if (currentStep < 3) nextStep = 'goal_setting';
      else if (currentStep < 4) nextStep = 'circle_recommendations';
      else nextStep = 'onboarding_complete';
    }

    return {
      hasCompletedAssessment,
      hasCompletedOnboarding,
      currentStep,
      completedSteps,
      nextStep,
      fitnessLevel: profile.fitness_level as FitnessLevel | null,
      preferredWorkoutTypes: profile.preferred_workout_types ?? [],
    };
  }

  /**
   * Based on assessment, return suggested circles to join
   */
  static async recommendCircles(userId: string): Promise<CircleRecommendation[]> {
    const supabaseAdmin = createAdminSupabase();

    // Get user's profile with assessment data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('fitness_level, preferred_workout_types, has_completed_assessment')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('[AssessmentService.recommendCircles] Error fetching profile:', profileError);
      throw profileError;
    }

    if (!profile.has_completed_assessment) {
      return [];
    }

    const fitnessLevel = profile.fitness_level as string;
    const workoutTypes = (profile.preferred_workout_types as string[]) || [];

    // Get active/upcoming circles the user is NOT already a member of
    const { data: circles, error: circlesError } = await supabaseAdmin
      .from('fitcircles')
      .select('id, name, description, participant_count, status, metadata')
      .in('status', ['active', 'upcoming'])
      .order('participant_count', { ascending: false })
      .limit(20);

    if (circlesError) {
      console.error('[AssessmentService.recommendCircles] Error fetching circles:', circlesError);
      throw circlesError;
    }

    // Get circles user is already in
    const { data: memberships } = await supabaseAdmin
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', userId);

    const memberCircleIds = new Set((memberships || []).map((m: any) => m.circle_id));

    // Score and filter circles
    const recommendations: CircleRecommendation[] = [];

    for (const circle of circles || []) {
      if (memberCircleIds.has(circle.id)) continue;

      let matchScore = 0;
      const reasons: string[] = [];

      // Check circle metadata for matching criteria
      const metadata = (circle.metadata as any) || {};
      const circleTags = (metadata.tags as string[]) || [];
      const circleLevel = metadata.fitness_level as string;

      // Fitness level match
      if (circleLevel && circleLevel === fitnessLevel) {
        matchScore += 3;
        reasons.push(`Matches your ${fitnessLevel} fitness level`);
      }

      // Workout type overlap
      const tagOverlap = workoutTypes.filter((t) => circleTags.includes(t));
      if (tagOverlap.length > 0) {
        matchScore += tagOverlap.length * 2;
        reasons.push(`Includes ${tagOverlap.join(', ')}`);
      }

      // Popularity bonus (more members = slightly higher score)
      if (circle.participant_count >= 5) {
        matchScore += 1;
        reasons.push('Popular circle');
      }

      // Base score for any active circle (so we still recommend even without metadata)
      matchScore += 1;
      if (reasons.length === 0) {
        reasons.push('Active circle looking for members');
      }

      recommendations.push({
        id: circle.id,
        name: circle.name,
        description: circle.description,
        memberCount: circle.participant_count || 0,
        matchReason: reasons[0],
        matchScore,
      });
    }

    // Sort by match score descending, limit to top 5
    recommendations.sort((a, b) => b.matchScore - a.matchScore);
    return recommendations.slice(0, 5);
  }

  /**
   * Mark onboarding as complete, trigger welcome sequence
   */
  static async completeOnboarding(userId: string): Promise<{
    success: boolean;
    xpAwarded: number;
  }> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[AssessmentService.completeOnboarding] Completing for user:', userId);

    // Get current profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('total_xp, current_level, onboarding_completed')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('[AssessmentService.completeOnboarding] Error:', profileError);
      throw profileError;
    }

    // If already completed, return early
    if (profile.onboarding_completed) {
      return { success: true, xpAwarded: 0 };
    }

    const xpAwarded = 250;
    const newTotalXp = (profile.total_xp || 0) + xpAwarded;
    const newLevel = Math.floor(newTotalXp / 1000) + 1;

    // Update profile
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        onboarding_current_step: 999,
        total_xp: newTotalXp,
        current_level: newLevel,
        is_active: true,
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[AssessmentService.completeOnboarding] Update error:', updateError);
      throw updateError;
    }

    // Mark onboarding_progress as complete
    await supabaseAdmin
      .from('onboarding_progress')
      .update({
        is_complete: true,
        completed_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Award achievement (ignore duplicate)
    const { error: achievementError } = await supabaseAdmin
      .from('user_achievements')
      .insert({
        user_id: userId,
        achievement_type: 'milestone',
        achievement_name: 'Getting Started',
        achievement_description: 'Completed onboarding and started your fitness journey!',
        achievement_icon: '🎉',
        xp_awarded: xpAwarded,
      });

    if (achievementError && achievementError.code !== '23505') {
      console.error('[AssessmentService.completeOnboarding] Achievement error:', achievementError);
    }

    console.log('[AssessmentService.completeOnboarding] Onboarding completed, awarded', xpAwarded, 'XP');

    return { success: true, xpAwarded };
  }
}
