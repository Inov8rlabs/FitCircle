import { describe, it, expect } from 'vitest';
import { PersonaService } from '../persona-service';
import { QuestionnaireAnswers } from '../../types/onboarding';

describe('PersonaService', () => {
  describe('detectPersona', () => {
    it('should detect Casey (competitive) persona correctly', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'lose_weight',
        motivationStyle: 'competition',
        fitnessLevel: 'intermediate',
        timeCommitment: '60+',
      };

      const result = await PersonaService.detectPersona(answers);

      expect(result.primary).toBe('casey');
      expect(result.scores.casey).toBeGreaterThan(0);
      expect(result.description).toContain('competitive');
      expect(result.recommendations).toHaveLength(4);
    });

    it('should detect Sarah (social) persona correctly', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'stay_accountable',
        motivationStyle: 'community',
        fitnessLevel: 'beginner',
        timeCommitment: '30-60',
      };

      const result = await PersonaService.detectPersona(answers);

      expect(result.primary).toBe('sarah');
      expect(result.scores.sarah).toBeGreaterThan(result.scores.casey);
      expect(result.description).toContain('social');
      expect(result.recommendations).toContain('Create or join a FitCircle with friends');
    });

    it('should detect Mike (practical) persona correctly', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'stay_active',
        motivationStyle: 'progress_tracking',
        fitnessLevel: 'beginner',
        timeCommitment: '15-30',
      };

      const result = await PersonaService.detectPersona(answers);

      expect(result.primary).toBe('mike');
      expect(result.scores.mike).toBeGreaterThan(0);
      expect(result.description).toContain('practical');
      expect(result.recommendations).toContain('Set SMART goals with clear metrics');
    });

    it('should detect Fiona (fitness fanatic) persona correctly', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'get_stronger',
        motivationStyle: 'progress_tracking',
        fitnessLevel: 'athlete',
        timeCommitment: '60+',
      };

      const result = await PersonaService.detectPersona(answers);

      expect(result.primary).toBe('fiona');
      expect(result.scores.fiona).toBeGreaterThan(0);
      expect(result.description).toContain('fitness');
    });

    it('should handle secondary persona when scores are close', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'lose_weight',
        motivationStyle: 'rewards',
        fitnessLevel: 'intermediate',
        timeCommitment: 'flexible',
      };

      const result = await PersonaService.detectPersona(answers);

      // rewards gives +1 to both casey and mike
      expect(result.primary).toBeDefined();
      expect(result.scores).toHaveProperty('casey');
      expect(result.scores).toHaveProperty('mike');
      expect(result.scores).toHaveProperty('sarah');
      expect(result.scores).toHaveProperty('fiona');
    });

    it('should calculate persona scores correctly for competition motivation', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'stay_active',
        motivationStyle: 'competition',
        fitnessLevel: 'beginner',
        timeCommitment: '15-30',
      };

      const result = await PersonaService.detectPersona(answers);

      // Competition gives +3 to casey
      expect(result.scores.casey).toBeGreaterThanOrEqual(3);
    });

    it('should return all required fields in persona result', async () => {
      const answers: QuestionnaireAnswers = {
        primaryGoal: 'lose_weight',
        motivationStyle: 'community',
        fitnessLevel: 'intermediate',
        timeCommitment: '30-60',
      };

      const result = await PersonaService.detectPersona(answers);

      expect(result).toHaveProperty('primary');
      expect(result).toHaveProperty('scores');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('recommendations');
      expect(result.scores).toHaveProperty('casey');
      expect(result.scores).toHaveProperty('sarah');
      expect(result.scores).toHaveProperty('mike');
      expect(result.scores).toHaveProperty('fiona');
    });
  });

  describe('getPersonaFlow', () => {
    it('should return correct flow for Casey', () => {
      const flow = PersonaService.getPersonaFlow('casey');

      expect(flow.emphasize).toContain('challenges');
      expect(flow.emphasize).toContain('competition');
      expect(flow.firstAction).toBe('browse_challenges');
      expect(flow.suggestedChallenges).toContain('high_stakes');
    });

    it('should return correct flow for Sarah', () => {
      const flow = PersonaService.getPersonaFlow('sarah');

      expect(flow.emphasize).toContain('teams');
      expect(flow.emphasize).toContain('community');
      expect(flow.firstAction).toBe('create_fitcircle');
      expect(flow.suggestedChallenges).toContain('team_based');
    });

    it('should return correct flow for Mike', () => {
      const flow = PersonaService.getPersonaFlow('mike');

      expect(flow.emphasize).toContain('ai_coach');
      expect(flow.emphasize).toContain('progress_tracking');
      expect(flow.firstAction).toBe('meet_fitzy');
      expect(flow.suggestedChallenges).toContain('beginner_friendly');
    });

    it('should return correct flow for Fiona', () => {
      const flow = PersonaService.getPersonaFlow('fiona');

      expect(flow.emphasize).toContain('workouts');
      expect(flow.emphasize).toContain('advanced_challenges');
      expect(flow.firstAction).toBe('browse_advanced_challenges');
      expect(flow.suggestedChallenges).toContain('intense');
    });
  });

  describe('getFitzyWelcomeMessage', () => {
    it('should return personalized message for Casey', () => {
      const message = PersonaService.getFitzyWelcomeMessage('casey', 'John');

      expect(message).toContain('champion');
      expect(message).toContain('compete');
      expect(message).toContain('💪');
    });

    it('should return personalized message for Sarah', () => {
      const message = PersonaService.getFitzyWelcomeMessage('sarah', 'Jane');

      expect(message).toContain('family');
      expect(message).toContain('friends');
      expect(message).toContain('🤗');
    });

    it('should return personalized message for Mike', () => {
      const message = PersonaService.getFitzyWelcomeMessage('mike', 'Mike');

      expect(message).toContain('Mike');
      expect(message).toContain('track');
      expect(message).toContain('📊');
    });

    it('should return personalized message for Fiona', () => {
      const message = PersonaService.getFitzyWelcomeMessage('fiona', 'Fiona');

      expect(message).toContain('athlete');
      expect(message).toContain('metrics');
      expect(message).toContain('🔥');
    });

    it('should include user name in message', () => {
      const message = PersonaService.getFitzyWelcomeMessage('mike', 'TestUser');

      expect(message).toContain('TestUser');
    });
  });
});
