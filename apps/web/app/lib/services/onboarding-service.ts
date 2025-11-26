import { createAdminSupabase } from '../supabase-admin';
import {
  CreateGoalData,
  CreateGoalsData,
  FirstCheckInData,
  OnboardingCompletionResult,
  OnboardingProgress,
  PersonaResult,
  QuestionnaireAnswers,
  SaveProgressData,
  UserGoal,
  PersonaType,
} from '../types/onboarding';
import { PersonaService } from './persona-service';

// ============================================================================
// ONBOARDING SERVICE
// ============================================================================

export class OnboardingService {
  /**
   * Save onboarding progress for a user
   * Allows resume if user closes app
   */
  static async saveProgress(userId: string, data: SaveProgressData): Promise<OnboardingProgress> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[OnboardingService.saveProgress] Saving progress for user:', userId, data);

    // Prepare data for upsert
    const progressData: any = {
      user_id: userId,
      current_step: data.currentStep,
      updated_at: new Date().toISOString(),
    };

    if (data.completedSteps) {
      progressData.completed_steps = data.completedSteps;
    }

    if (data.questionnaireAnswers) {
      progressData.questionnaire_answers = data.questionnaireAnswers;
    }

    if (data.personaScores) {
      progressData.persona_scores = data.personaScores;
    }

    if (data.detectedPersona) {
      progressData.detected_persona = data.detectedPersona;
    }

    if (data.goalsData) {
      progressData.goals_data = data.goalsData;
    }

    if (data.firstCheckinData) {
      progressData.first_checkin_data = data.firstCheckinData;
    }

    // Upsert progress
    const { data: progress, error } = await supabaseAdmin
      .from('onboarding_progress')
      .upsert(progressData, {
        onConflict: 'user_id',
      })
      .select()
      .single();

    if (error) {
      console.error('[OnboardingService.saveProgress] Error:', error);
      throw error;
    }

    console.log('[OnboardingService.saveProgress] Progress saved successfully');

    return this.mapProgressFromDb(progress);
  }

  /**
   * Get onboarding progress for a user
   * Returns null if completed or not started
   */
  static async getProgress(userId: string): Promise<OnboardingProgress | null> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[OnboardingService.getProgress] Fetching progress for user:', userId);

    const { data: progress, error } = await supabaseAdmin
      .from('onboarding_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // Not found is OK - means they haven't started
      if (error.code === 'PGRST116') {
        console.log('[OnboardingService.getProgress] No progress found - new user');
        return null;
      }
      console.error('[OnboardingService.getProgress] Error:', error);
      throw error;
    }

    // If completed, return null (they should go to dashboard)
    if (progress.is_complete) {
      console.log('[OnboardingService.getProgress] Onboarding already completed');
      return null;
    }

    return this.mapProgressFromDb(progress);
  }

  /**
   * Process questionnaire and detect persona
   */
  static async processQuestionnaire(
    userId: string,
    answers: QuestionnaireAnswers
  ): Promise<PersonaResult> {
    console.log('[OnboardingService.processQuestionnaire] Processing for user:', userId);

    // Detect persona
    const personaResult = await PersonaService.detectPersona(answers);

    // Save to progress
    await this.saveProgress(userId, {
      currentStep: 2,
      completedSteps: [1, 2],
      questionnaireAnswers: answers,
      personaScores: personaResult.scores,
      detectedPersona: personaResult.primary,
    });

    // Update profile with persona and fitness info
    const supabaseAdmin = createAdminSupabase();
    await supabaseAdmin
      .from('profiles')
      .update({
        persona: personaResult.primary,
        persona_secondary: personaResult.secondary || null,
        fitness_level: answers.fitnessLevel,
        time_commitment: answers.timeCommitment,
        onboarding_current_step: 2,
      })
      .eq('id', userId);

    console.log('[OnboardingService.processQuestionnaire] Persona detected:', personaResult.primary);

    return personaResult;
  }

  /**
   * Create user goals from onboarding data
   */
  static async createGoals(userId: string, goalsData: CreateGoalsData): Promise<UserGoal[]> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[OnboardingService.createGoals] Creating goals for user:', userId);

    const goals: CreateGoalData[] = [];

    // Convert weight goal
    if (goalsData.weightGoal) {
      const { currentWeight, targetWeight, targetDate, unit } = goalsData.weightGoal;

      // Convert to kg if needed
      const currentKg = unit === 'lbs' ? currentWeight * 0.453592 : currentWeight;
      const targetKg = unit === 'lbs' ? targetWeight * 0.453592 : targetWeight;

      goals.push({
        goalType: 'weight',
        goalName: 'Weight Loss Goal',
        goalDescription: `Lose ${Math.abs(currentWeight - targetWeight).toFixed(1)} ${unit}`,
        currentValue: currentKg,
        targetValue: targetKg,
        startValue: currentKg,
        targetDate,
        metadata: { unit, originalCurrent: currentWeight, originalTarget: targetWeight },
      });

      // Also update profile weight
      await supabaseAdmin
        .from('profiles')
        .update({ weight_kg: currentKg })
        .eq('id', userId);
    }

    // Convert steps goal
    if (goalsData.stepsGoal) {
      goals.push({
        goalType: 'steps',
        goalName: 'Daily Steps Goal',
        goalDescription: `Walk ${goalsData.stepsGoal.dailySteps.toLocaleString()} steps per day`,
        targetValue: goalsData.stepsGoal.dailySteps,
        metadata: { frequency: 'daily' },
      });
    }

    // Convert workout frequency goal
    if (goalsData.workoutFrequency) {
      const { daysPerWeek, minutesPerDay } = goalsData.workoutFrequency;
      goals.push({
        goalType: 'workout_frequency',
        goalName: 'Workout Schedule',
        goalDescription: `${daysPerWeek} days per week, ${minutesPerDay} minutes each`,
        targetValue: daysPerWeek,
        metadata: { daysPerWeek, minutesPerDay, frequency: 'weekly' },
      });
    }

    // Convert custom goals
    if (goalsData.customGoals) {
      goalsData.customGoals.forEach((customGoal) => {
        goals.push({
          goalType: 'custom',
          goalName: customGoal.name,
          goalDescription: customGoal.description,
          targetValue: customGoal.targetValue,
          metadata: { unit: customGoal.unit },
        });
      });
    }

    // Insert all goals
    const insertData = goals.map((goal) => ({
      user_id: userId,
      goal_type: goal.goalType,
      goal_name: goal.goalName,
      goal_description: goal.goalDescription || null,
      current_value: goal.currentValue || null,
      target_value: goal.targetValue,
      start_value: goal.startValue || goal.currentValue || null,
      target_date: goal.targetDate || null,
      metadata: goal.metadata || {},
      status: 'active',
      progress_percentage: 0,
    }));

    const { data: createdGoals, error } = await supabaseAdmin
      .from('user_goals')
      .insert(insertData)
      .select();

    if (error) {
      console.error('[OnboardingService.createGoals] Error:', error);
      throw error;
    }

    // Save goals to onboarding progress
    await this.saveProgress(userId, {
      currentStep: 4,
      completedSteps: [1, 2, 3, 4],
      goalsData,
    });

    console.log('[OnboardingService.createGoals] Created', createdGoals.length, 'goals');

    return createdGoals.map(this.mapGoalFromDb);
  }

  /**
   * Record first check-in during onboarding
   */
  static async recordFirstCheckIn(userId: string, checkInData: FirstCheckInData): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[OnboardingService.recordFirstCheckIn] Recording for user:', userId);

    // Convert weight to kg if needed
    const weightKg =
      checkInData.weight && checkInData.unit === 'lbs'
        ? checkInData.weight * 0.453592
        : checkInData.weight;

    // Insert into daily_tracking
    const trackingData: any = {
      user_id: userId,
      tracking_date: new Date().toISOString().split('T')[0],
    };

    if (weightKg) {
      trackingData.weight_kg = weightKg;
    }

    if (checkInData.height) {
      trackingData.height_cm = checkInData.height;
    }

    if (checkInData.mood) {
      trackingData.mood_score = checkInData.mood;
    }

    if (checkInData.energy) {
      trackingData.energy_level = checkInData.energy;
    }

    if (checkInData.notes) {
      trackingData.notes = checkInData.notes;
    }

    // Upsert (in case they already checked in today)
    const { error } = await supabaseAdmin
      .from('daily_tracking')
      .upsert(trackingData, {
        onConflict: 'user_id,tracking_date',
      });

    if (error) {
      console.error('[OnboardingService.recordFirstCheckIn] Error:', error);
      throw error;
    }

    // Update profile with height and weight if provided
    const profileUpdates: any = {};
    if (checkInData.height) {
      profileUpdates.height_cm = checkInData.height;
    }
    if (weightKg) {
      profileUpdates.weight_kg = weightKg;
    }

    if (Object.keys(profileUpdates).length > 0) {
      await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);
    }

    // Save to onboarding progress
    await this.saveProgress(userId, {
      currentStep: 5,
      completedSteps: [1, 2, 3, 4, 5],
      firstCheckinData: checkInData,
    });

    console.log('[OnboardingService.recordFirstCheckIn] First check-in recorded');
  }

  /**
   * Complete onboarding
   * - Mark as complete
   * - Award achievement
   * - Grant XP
   * - Update user status
   */
  static async completeOnboarding(userId: string): Promise<OnboardingCompletionResult> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[OnboardingService.completeOnboarding] Completing for user:', userId);

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, persona, total_xp, current_level')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('User not found');
    }

    // Award XP (250 for completing onboarding)
    const xpAwarded = 250;
    const newTotalXp = (profile.total_xp || 0) + xpAwarded;
    const newLevel = Math.floor(newTotalXp / 1000) + 1; // Simple leveling: 1000 XP per level

    // Create achievement
    const { data: achievement, error: achievementError } = await supabaseAdmin
      .from('user_achievements')
      .insert({
        user_id: userId,
        achievement_type: 'milestone',
        achievement_name: 'Getting Started',
        achievement_description: 'Completed onboarding and started your fitness journey!',
        achievement_icon: '🎉',
        xp_awarded: xpAwarded,
      })
      .select()
      .single();

    if (achievementError && achievementError.code !== '23505') {
      // Ignore duplicate error
      console.error('[OnboardingService.completeOnboarding] Achievement error:', achievementError);
    }

    // Update profile
    await supabaseAdmin
      .from('profiles')
      .update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        onboarding_current_step: 999, // Completed
        total_xp: newTotalXp,
        current_level: newLevel,
        is_active: true,
      })
      .eq('id', userId);

    // Mark onboarding progress as complete
    await supabaseAdmin
      .from('onboarding_progress')
      .update({
        is_complete: true,
        completed_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Get user's goals
    const { data: goals } = await supabaseAdmin
      .from('user_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    console.log('[OnboardingService.completeOnboarding] Onboarding completed successfully');

    return {
      success: true,
      user: {
        id: profile.id,
        displayName: profile.display_name,
        persona: profile.persona as PersonaType,
        totalXp: newTotalXp,
        currentLevel: newLevel,
      },
      achievement: {
        id: achievement?.id || 'achievement-id',
        name: 'Getting Started',
        description: 'Completed onboarding and started your fitness journey!',
        xpAwarded,
      },
      goals: (goals || []).map(this.mapGoalFromDb),
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Map database record to OnboardingProgress type
   */
  private static mapProgressFromDb(record: any): OnboardingProgress {
    return {
      id: record.id,
      userId: record.user_id,
      currentStep: record.current_step,
      completedSteps: record.completed_steps || [],
      isComplete: record.is_complete,
      questionnaireAnswers: record.questionnaire_answers || {},
      personaScores: record.persona_scores || null,
      detectedPersona: record.detected_persona || null,
      detectedPersonaSecondary: record.detected_persona_secondary || null,
      goalsData: record.goals_data || {},
      firstCheckinData: record.first_checkin_data || {},
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      completedAt: record.completed_at || null,
    };
  }

  /**
   * Map database record to UserGoal type
   */
  private static mapGoalFromDb(record: any): UserGoal {
    return {
      id: record.id,
      userId: record.user_id,
      goalType: record.goal_type,
      goalName: record.goal_name,
      goalDescription: record.goal_description,
      currentValue: record.current_value,
      targetValue: record.target_value,
      startValue: record.start_value,
      targetDate: record.target_date,
      createdDate: record.created_date,
      status: record.status,
      progressPercentage: record.progress_percentage,
      metadata: record.metadata || {},
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      completedAt: record.completed_at,
    };
  }
}
