import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LeaderboardService } from '@/lib/services/leaderboard-service';
import {
  createMockSupabaseClient,
  mockQuerySuccess,
} from '../../utils/mock-supabase';

describe('LeaderboardService', () => {
  describe('calculateProgress', () => {
    describe('weight loss challenges', () => {
      it('should calculate 0% when currentValue equals startValue', () => {
        const result = LeaderboardService.calculateProgress(
          95, // startValue
          95, // currentValue (no progress)
          85, // targetValue
          'weight_loss'
        );
        expect(result).toBe(0);
      });

      it('should calculate 50% when halfway to goal', () => {
        const result = LeaderboardService.calculateProgress(
          100, // startValue
          95, // currentValue (lost 5kg)
          90, // targetValue (goal is to lose 10kg)
          'weight_loss'
        );
        expect(result).toBe(50);
      });

      it('should calculate 100% when goal is reached', () => {
        const result = LeaderboardService.calculateProgress(
          95, // startValue
          85, // currentValue (reached goal)
          85, // targetValue
          'weight_loss'
        );
        expect(result).toBe(100);
      });

      it('should calculate 0% when currentValue is 0 (no entries)', () => {
        // This is the bug fix - when user has no entries, currentValue is 0
        // We should treat this as no progress made, not 100% progress
        const result = LeaderboardService.calculateProgress(
          95, // startValue
          0, // currentValue (no entries logged)
          85, // targetValue
          'weight_loss'
        );
        expect(result).toBe(0);
      });

      it('should cap progress at 100% even if exceeded goal', () => {
        const result = LeaderboardService.calculateProgress(
          100, // startValue
          80, // currentValue (lost 20kg)
          90, // targetValue (goal was to lose 10kg)
          'weight_loss'
        );
        expect(result).toBe(100); // Capped at 100%, not 200%
      });

      it('should return 0% when totalToLose is 0 or negative', () => {
        const result = LeaderboardService.calculateProgress(
          85, // startValue
          85, // currentValue
          85, // targetValue (no weight to lose)
          'weight_loss'
        );
        expect(result).toBe(0);
      });

      it('should return 0% when targetValue is 0', () => {
        const result = LeaderboardService.calculateProgress(
          95, // startValue
          90, // currentValue
          0, // targetValue (invalid)
          'weight_loss'
        );
        expect(result).toBe(0);
      });

      it('should never return negative progress', () => {
        const result = LeaderboardService.calculateProgress(
          100, // startValue
          110, // currentValue (gained weight)
          90, // targetValue
          'weight_loss'
        );
        expect(result).toBeGreaterThanOrEqual(0);
      });
    });

    describe('step count challenges', () => {
      it('should calculate 0% when no steps logged', () => {
        const result = LeaderboardService.calculateProgress(
          0, // startValue (not used for step count)
          0, // currentValue
          10000, // targetValue
          'step_count'
        );
        expect(result).toBe(0);
      });

      it('should calculate 50% when halfway to target', () => {
        const result = LeaderboardService.calculateProgress(
          0, // startValue (not used)
          5000, // currentValue
          10000, // targetValue
          'step_count'
        );
        expect(result).toBe(50);
      });

      it('should calculate 100% when target is reached', () => {
        const result = LeaderboardService.calculateProgress(
          0, // startValue (not used)
          10000, // currentValue
          10000, // targetValue
          'step_count'
        );
        expect(result).toBe(100);
      });

      it('should cap at 100% even if target exceeded', () => {
        const result = LeaderboardService.calculateProgress(
          0, // startValue (not used)
          15000, // currentValue
          10000, // targetValue
          'step_count'
        );
        expect(result).toBe(100);
      });
    });

    describe('workout frequency challenges', () => {
      it('should calculate progress based on minutes completed', () => {
        const result = LeaderboardService.calculateProgress(
          0, // startValue (not used)
          120, // currentValue (120 minutes)
          240, // targetValue (240 minutes goal)
          'workout_frequency'
        );
        expect(result).toBe(50);
      });
    });

    describe('edge cases', () => {
      it('should handle custom challenge type', () => {
        const result = LeaderboardService.calculateProgress(
          100,
          90,
          80,
          'custom'
        );
        expect(result).toBe(0); // Default behavior for unknown type
      });

      it('should handle undefined challenge type', () => {
        const result = LeaderboardService.calculateProgress(
          100,
          90,
          80,
          ''
        );
        expect(result).toBe(0);
      });
    });
  });

  describe('getLatestValueForFrequency', () => {
    const mockEntries = [
      { tracking_date: '2025-01-01', weight_kg: 100 },
      { tracking_date: '2025-01-02', weight_kg: 99 },
      { tracking_date: '2025-01-03', weight_kg: 98 },
      { tracking_date: '2025-01-04', weight_kg: 97 },
    ];

    it('should return latest entry for realtime frequency', () => {
      const result = LeaderboardService.getLatestValueForFrequency(
        mockEntries,
        'weight_kg',
        'realtime'
      );

      expect(result.value).toBe(97);
      expect(result.date).toBe('2025-01-04');
    });

    it('should return latest entry for daily frequency', () => {
      const result = LeaderboardService.getLatestValueForFrequency(
        mockEntries,
        'weight_kg',
        'daily'
      );

      expect(result.value).toBe(97);
      expect(result.date).toBe('2025-01-04');
    });

    it('should return 0 for empty entries', () => {
      const result = LeaderboardService.getLatestValueForFrequency(
        [],
        'weight_kg',
        'realtime'
      );

      expect(result.value).toBe(0);
      expect(result.date).toBeNull();
    });

    it('should handle weekly frequency', () => {
      const result = LeaderboardService.getLatestValueForFrequency(
        mockEntries,
        'weight_kg',
        'weekly',
        1, // Monday
        '12:00'
      );

      expect(result.value).toBeGreaterThan(0);
      expect(result.date).toBeTruthy();
    });
  });

  describe('shouldUpdateLeaderboard', () => {
    it('should always return true for realtime frequency', () => {
      const result = LeaderboardService.shouldUpdateLeaderboard('realtime');
      expect(result).toBe(true);
    });

    it('should always return true for daily frequency', () => {
      const result = LeaderboardService.shouldUpdateLeaderboard('daily');
      expect(result).toBe(true);
    });

    it('should check day and time for weekly frequency', () => {
      const result = LeaderboardService.shouldUpdateLeaderboard(
        'weekly',
        1, // Monday
        '00:00'
      );
      expect(typeof result).toBe('boolean');
    });

    it('should return false for weekly without required params', () => {
      const result = LeaderboardService.shouldUpdateLeaderboard('weekly');
      expect(result).toBe(false);
    });
  });
});
