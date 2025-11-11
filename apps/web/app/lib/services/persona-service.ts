import {
  PersonaScores,
  PersonaResult,
  PersonaType,
  QuestionnaireAnswers,
} from '../types/onboarding';

// ============================================================================
// PERSONA SERVICE
// ============================================================================

export class PersonaService {
  /**
   * Detect user persona based on questionnaire answers
   * Uses a scoring algorithm to determine primary and secondary personas
   */
  static async detectPersona(answers: QuestionnaireAnswers): Promise<PersonaResult> {
    console.log('[PersonaService.detectPersona] Analyzing answers:', answers);

    // Initialize scores
    const scores: PersonaScores = {
      casey: 0, // Competitive
      sarah: 0, // Social
      mike: 0, // Practical/Motivated
      fiona: 0, // Fitness Fanatic
    };

    // ========================================================================
    // Question 1: Primary Goal
    // ========================================================================
    switch (answers.primaryGoal) {
      case 'lose_weight':
        scores.mike += 1;
        scores.casey += 1;
        break;
      case 'get_stronger':
        scores.casey += 1;
        scores.fiona += 1;
        break;
      case 'stay_accountable':
        scores.sarah += 2;
        break;
      case 'stay_active':
        scores.mike += 1;
        break;
    }

    // ========================================================================
    // Question 2: Motivation Style (MOST IMPORTANT for persona detection)
    // ========================================================================
    switch (answers.motivationStyle) {
      case 'competition':
        scores.casey += 3; // Strong signal for competitive persona
        break;
      case 'community':
        scores.sarah += 3; // Strong signal for social persona
        break;
      case 'progress_tracking':
        scores.mike += 2; // Strong signal for practical persona
        break;
      case 'rewards':
        scores.casey += 1; // Slight competitive signal
        scores.mike += 1; // Also practical
        break;
    }

    // ========================================================================
    // Question 3: Fitness Level
    // ========================================================================
    switch (answers.fitnessLevel) {
      case 'beginner':
        scores.mike += 1; // Beginners often need practical guidance
        break;
      case 'intermediate':
        // No strong signal
        break;
      case 'advanced':
        scores.fiona += 1;
        break;
      case 'athlete':
        scores.fiona += 2;
        scores.casey += 1;
        break;
    }

    // ========================================================================
    // Question 4: Time Commitment
    // ========================================================================
    switch (answers.timeCommitment) {
      case '15-30':
        scores.mike += 1; // Quick and efficient
        break;
      case '30-60':
        // No strong signal
        break;
      case '60+':
        scores.fiona += 1; // Fitness is priority
        scores.casey += 1; // Serious commitment
        break;
      case 'flexible':
        scores.mike += 1;
        break;
    }

    console.log('[PersonaService.detectPersona] Calculated scores:', scores);

    // ========================================================================
    // Determine primary and secondary personas
    // ========================================================================
    const sortedPersonas = (Object.entries(scores) as [PersonaType, number][]).sort(
      ([, scoreA], [, scoreB]) => scoreB - scoreA
    );

    const primary = sortedPersonas[0][0];
    const secondary =
      sortedPersonas[1][1] > 0 && sortedPersonas[0][1] - sortedPersonas[1][1] <= 2
        ? sortedPersonas[1][0]
        : undefined;

    console.log('[PersonaService.detectPersona] Primary:', primary, 'Secondary:', secondary);

    // ========================================================================
    // Generate description and recommendations
    // ========================================================================
    const { description, recommendations } = this.getPersonaDetails(primary, secondary);

    return {
      primary,
      secondary,
      scores,
      description,
      recommendations,
    };
  }

  /**
   * Get persona-specific description and recommendations
   */
  private static getPersonaDetails(
    primary: PersonaType,
    secondary?: PersonaType
  ): { description: string; recommendations: string[] } {
    const descriptions: Record<PersonaType, string> = {
      casey:
        "You're a competitive achiever who thrives on challenges and loves the thrill of victory. You're motivated by leaderboards, competition, and proving you're the best.",
      sarah:
        "You're a social connector who finds strength in community. You're motivated by friendship, accountability, and shared experiences with others on the same journey.",
      mike:
        "You're a practical go-getter who values efficiency and measurable progress. You're motivated by data, tracking, and seeing real results from your efforts.",
      fiona:
        "You're a fitness enthusiast who makes health a top priority. You're motivated by pushing your limits, trying new workouts, and continuous improvement.",
    };

    const recommendationsMap: Record<PersonaType, string[]> = {
      casey: [
        'Join high-stakes challenges with cash prizes',
        'Compete on leaderboards against other top performers',
        'Set aggressive goals and track your ranking',
        'Challenge friends to head-to-head competitions',
      ],
      sarah: [
        'Create or join a FitCircle with friends',
        'Invite friends to join your fitness journey',
        'Participate in team-based challenges',
        'Share your progress and celebrate wins together',
      ],
      mike: [
        'Set SMART goals with clear metrics',
        'Use Fitzy AI coach for personalized guidance',
        'Track your progress with detailed analytics',
        'Start with beginner-friendly challenges to build momentum',
      ],
      fiona: [
        'Join intense workout challenges',
        'Set ambitious fitness goals',
        'Track multiple metrics (weight, strength, endurance)',
        'Compete in advanced-level challenges',
      ],
    };

    let description = descriptions[primary];
    let recommendations = recommendationsMap[primary];

    // Add secondary persona influence
    if (secondary) {
      description += ` You also have strong ${secondary === 'casey' ? 'competitive' : secondary === 'sarah' ? 'social' : secondary === 'mike' ? 'practical' : 'fitness-focused'} tendencies.`;

      // Mix in one recommendation from secondary
      const secondaryRec = recommendationsMap[secondary][0];
      if (!recommendations.includes(secondaryRec)) {
        recommendations = [...recommendations.slice(0, 3), secondaryRec];
      }
    }

    return { description, recommendations };
  }

  /**
   * Get persona-specific onboarding flow customization
   */
  static getPersonaFlow(persona: PersonaType): {
    emphasize: string[];
    firstAction: string;
    suggestedChallenges: string[];
  } {
    const flows = {
      casey: {
        emphasize: ['challenges', 'leaderboards', 'prizes', 'competition'],
        firstAction: 'browse_challenges',
        suggestedChallenges: ['weight_loss', 'step_count', 'high_stakes'],
      },
      sarah: {
        emphasize: ['teams', 'friends', 'community', 'social'],
        firstAction: 'create_fitcircle',
        suggestedChallenges: ['team_based', 'social', 'friend_challenges'],
      },
      mike: {
        emphasize: ['ai_coach', 'progress_tracking', 'efficiency', 'data'],
        firstAction: 'meet_fitzy',
        suggestedChallenges: ['beginner_friendly', 'structured', 'measurable'],
      },
      fiona: {
        emphasize: ['workouts', 'advanced_challenges', 'fitness_goals', 'metrics'],
        firstAction: 'browse_advanced_challenges',
        suggestedChallenges: ['workout_frequency', 'advanced', 'intense'],
      },
    };

    return flows[persona];
  }

  /**
   * Get Fitzy's personalized welcome message based on persona
   */
  static getFitzyWelcomeMessage(persona: PersonaType, userName: string): string {
    const messages: Record<PersonaType, string> = {
      casey: `Hey there, champion! 💪\n\nI'm Fitzy, your AI fitness coach. I've analyzed your goals, and I can already tell you're built to compete.\n\nHere's your first insight:\nUsers like you who join challenges within 48 hours are 4x more likely to hit their goals. You ready to prove you're the best?\n\nLet's get you set up to dominate! 🏆`,
      sarah: `Welcome to the family! 🤗\n\nI'm Fitzy, your AI coach and cheerleader. I've learned about your goals, and I think FitCircle is perfect for you.\n\nHere's your first insight:\nPeople who work out with friends lose 3x more weight and have way more fun doing it. Ready to find your fitness squad?\n\nLet's build your circle! ❤️`,
      mike: `Hi ${userName}! 📊\n\nI'm Fitzy, your AI fitness coach. I've reviewed your profile, and I'm excited to help you hit your goals.\n\nHere's your first insight:\nUsers who track their progress daily are 5x more likely to reach their target weight. I'll help you stay on track.\n\nLet's set up your dashboard! 🎯`,
      fiona: `What's up, athlete! 🔥\n\nI'm Fitzy, your AI training partner. I can see you're serious about fitness, and I'm here to help you level up.\n\nHere's your first insight:\nElite performers track multiple metrics to optimize results. I'll help you monitor everything that matters.\n\nLet's push your limits! 💪`,
    };

    return messages[persona];
  }
}
