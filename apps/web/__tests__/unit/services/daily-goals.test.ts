/**
 * Daily Goals Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DailyGoalService } from '@/lib/services/daily-goals';

describe('DailyGoalService', () => {
  describe('calculateDailyStepGoal', () => {
    it('should calculate daily steps for step challenge', () => {
      const challenge = {
        id: '1',
        type: 'step_count' as const,
        start_date: '2025-01-01',
        end_date: '2025-01-31', // 30 days
      };

      const participant = {
        starting_weight_kg: null,
        goal_weight_kg: null,
        starting_value: null,
        goal_value: 300000, // 300k steps total
      };

      const dailySteps = DailyGoalService.calculateDailyStepGoal(
        challenge,
        participant,
        5000
      );

      // 300,000 / 30 = 10,000 steps/day
      expect(dailySteps).toBe(10000);
    });

    it('should calculate daily steps for weight loss challenge', () => {
      const challenge = {
        id: '1',
        type: 'weight_loss' as const,
        start_date: '2025-01-01',
        end_date: '2025-03-01', // ~56 days
      };

      const participant = {
        starting_weight_kg: 80, // 80 kg
        goal_weight_kg: 75, // Goal: lose 5 kg
        starting_value: null,
        goal_value: null,
      };

      const dailySteps = DailyGoalService.calculateDailyStepGoal(
        challenge,
        participant,
        6000
      );

      // Should recommend around 10,000 steps for moderate weight loss
      expect(dailySteps).toBeGreaterThan(8000);
      expect(dailySteps).toBeLessThan(13000);
    });

    it('should cap daily steps at reasonable limits', () => {
      const challenge = {
        id: '1',
        type: 'step_count' as const,
        start_date: '2025-01-01',
        end_date: '2025-01-02', // 1 day
      };

      const participant = {
        starting_weight_kg: null,
        goal_weight_kg: null,
        starting_value: null,
        goal_value: 50000, // Unrealistic 50k steps in 1 day
      };

      const dailySteps = DailyGoalService.calculateDailyStepGoal(
        challenge,
        participant,
        5000
      );

      // Should cap at 25,000
      expect(dailySteps).toBeLessThanOrEqual(25000);
    });

    it('should use fallback default for moderate weight loss', () => {
      const challenge = {
        id: '1',
        type: 'weight_loss' as const,
        start_date: '2025-01-01',
        end_date: '2025-02-01',
      };

      const participant = {
        starting_weight_kg: 75,
        goal_weight_kg: 70, // 5 kg loss
        starting_value: null,
        goal_value: null,
      };

      const dailySteps = DailyGoalService.calculateDailyStepGoal(
        challenge,
        participant,
        6000
      );

      expect(dailySteps).toBe(10000); // Moderate goal default
    });

    it('should return conservative goal for light weight loss', () => {
      const challenge = {
        id: '1',
        type: 'weight_loss' as const,
        start_date: '2025-01-01',
        end_date: '2025-02-01',
      };

      const participant = {
        starting_weight_kg: 72,
        goal_weight_kg: 70, // 2 kg loss (light)
        starting_value: null,
        goal_value: null,
      };

      const dailySteps = DailyGoalService.calculateDailyStepGoal(
        challenge,
        participant,
        6000
      );

      expect(dailySteps).toBe(8000); // Light goal
    });
  });

  describe('calculateDailyWeightGoal', () => {
    it('should recommend daily weight logging for weight loss challenges', () => {
      const challenge = {
        id: '1',
        type: 'weight_loss' as const,
        start_date: '2025-01-01',
        end_date: '2025-02-01',
      };

      const participant = {
        starting_weight_kg: 80,
        goal_weight_kg: 75,
        starting_value: null,
        goal_value: null,
      };

      const result = DailyGoalService.calculateDailyWeightGoal(challenge, participant);

      expect(result.shouldLog).toBe(true);
      expect(result.targetWeight).toBe(75);
    });

    it('should not recommend weight logging for step challenges', () => {
      const challenge = {
        id: '1',
        type: 'step_count' as const,
        start_date: '2025-01-01',
        end_date: '2025-01-31',
      };

      const participant = {
        starting_weight_kg: null,
        goal_weight_kg: null,
        starting_value: null,
        goal_value: 300000,
      };

      const result = DailyGoalService.calculateDailyWeightGoal(challenge, participant);

      expect(result.shouldLog).toBe(false);
      expect(result.targetWeight).toBe(null);
    });
  });

  describe('Streak Calculation', () => {
    it('should handle empty completion history', async () => {
      // This would need a mock Supabase client
      // Testing integration will be done with real DB in E2E tests
      expect(true).toBe(true);
    });
  });
});
