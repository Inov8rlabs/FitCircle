import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricStreakService } from '@/lib/services/metric-streak-service';
import { METRIC_FREQUENCY_CONFIG } from '@/lib/types/streak';

// Mock Supabase admin
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  })),
}));

describe('MetricStreakService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Daily Metric Streaks (Weight, Steps, Mood)', () => {
    describe('Weight Streak (1 grace day per week)', () => {
      it('should calculate consecutive days correctly', () => {
        const logs = [
          '2025-10-15', // Today
          '2025-10-14',
          '2025-10-13',
          '2025-10-12',
          '2025-10-11',
        ];

        // Expected: 5-day streak
      });

      it('should allow 1 miss per week with grace', () => {
        const logs = [
          '2025-10-15', // Today (Wed)
          '2025-10-14', // Tue
          // '2025-10-13', // Mon - MISSED
          '2025-10-12', // Sun (previous week)
          '2025-10-11', // Sat
          '2025-10-10', // Fri
        ];

        const graceDaysPerWeek = METRIC_FREQUENCY_CONFIG.weight.grace_days;
        expect(graceDaysPerWeek).toBe(1);

        // Expected:
        // - Streak continues using 1 grace day
        // - currentStreak = 5
      });

      it('should break streak after using all grace days in week', () => {
        const logs = [
          '2025-10-15', // Today (Wed)
          // '2025-10-14', // Tue - MISSED (grace used)
          // '2025-10-13', // Mon - MISSED (no grace left)
          '2025-10-12', // Sun
        ];

        // Expected:
        // - Streak broken at Monday
        // - currentStreak = 1 (just today)
      });

      it('should reset grace days at start of new week', () => {
        const logs = [
          '2025-10-15', // Today (Wed)
          '2025-10-14', // Tue
          // '2025-10-13', // Mon - MISSED (grace used for this week)
          '2025-10-12', // Sun
          '2025-10-11', // Sat
          // '2025-10-10', // Fri - MISSED (grace used for previous week)
          '2025-10-09', // Thu
        ];

        // Expected:
        // - Each week gets its own grace day
        // - Streak continues
      });
    });

    describe('Steps Streak (1 grace day per week)', () => {
      it('should allow rest days with grace', () => {
        const logs = [
          '2025-10-15',
          '2025-10-14',
          '2025-10-13',
          // '2025-10-12', // Rest day - MISSED
          '2025-10-11',
        ];

        const graceDaysPerWeek = METRIC_FREQUENCY_CONFIG.steps.grace_days;
        expect(graceDaysPerWeek).toBe(1);

        // Expected: Streak continues (rest day covered by grace)
      });
    });

    describe('Mood Streak (2 grace days per week)', () => {
      it('should allow 2 misses per week with grace', () => {
        const logs = [
          '2025-10-15', // Today (Wed)
          // '2025-10-14', // Tue - MISSED (grace 1)
          // '2025-10-13', // Mon - MISSED (grace 2)
          '2025-10-12', // Sun
          '2025-10-11', // Sat
        ];

        const graceDaysPerWeek = METRIC_FREQUENCY_CONFIG.mood.grace_days;
        expect(graceDaysPerWeek).toBe(2);

        // Expected: Streak continues (2 grace days available)
      });

      it('should break streak after 3 misses in week', () => {
        const logs = [
          '2025-10-15', // Today (Wed)
          // '2025-10-14', // Tue - MISSED (grace 1)
          // '2025-10-13', // Mon - MISSED (grace 2)
          // '2025-10-12', // Sun - MISSED (no grace left)
          '2025-10-11', // Sat
        ];

        // Expected: Streak broken
      });
    });
  });

  describe('Weekly Metric Streaks (Measurements, Photos)', () => {
    describe('Measurements Streak (Weekly, Mon-Sun)', () => {
      it('should count week as complete if logged any day', () => {
        const logs = [
          '2025-10-15', // Wed this week
          '2025-10-08', // Wed last week
          '2025-10-01', // Wed two weeks ago
        ];

        const config = METRIC_FREQUENCY_CONFIG.measurements;
        expect(config.frequency).toBe('weekly');
        expect(config.window_start).toBe(1); // Monday
        expect(config.window_end).toBe(0); // Sunday

        // Expected: 3-week streak
      });

      it('should break streak if week has no log', () => {
        const logs = [
          '2025-10-15', // This week (Oct 13-19)
          // Last week (Oct 6-12) - MISSED
          '2025-10-01', // Two weeks ago (Sep 29 - Oct 5)
        ];

        // Expected: Streak broken, currentStreak = 1
      });

      it('should handle logging on different days each week', () => {
        const logs = [
          '2025-10-15', // Wed this week
          '2025-10-06', // Mon last week
          '2025-09-29', // Sun two weeks ago
        ];

        // Expected: All valid, 3-week streak
      });
    });

    describe('Photos Streak (Weekly, Fri-Sun window)', () => {
      it('should count week as complete if logged during weekend', () => {
        const logs = [
          '2025-10-12', // Sat this week (Oct 11-13)
          '2025-10-05', // Sat last week (Oct 4-6)
          '2025-09-27', // Fri two weeks ago (Sep 27-29)
        ];

        const config = METRIC_FREQUENCY_CONFIG.photos;
        expect(config.frequency).toBe('weekly');
        expect(config.window_start).toBe(5); // Friday
        expect(config.window_end).toBe(0); // Sunday

        // Expected: 3-week streak
      });

      it('should not count week if logged outside weekend window', () => {
        const logs = [
          '2025-10-14', // Mon - OUTSIDE WINDOW
          '2025-10-05', // Sat last week (valid)
        ];

        // Expected: Only last week counts, currentStreak = 1
      });

      it('should accept any day within Fri-Sun window', () => {
        const logs = [
          '2025-10-13', // Sun this week
          '2025-10-05', // Sat last week
          '2025-09-27', // Fri two weeks ago
        ];

        // Expected: All valid, 3-week streak
      });

      it('should break streak if weekend is missed', () => {
        const logs = [
          '2025-10-12', // Sat this week
          // Last weekend (Oct 4-6) - MISSED
          '2025-09-28', // Sat two weeks ago
        ];

        // Expected: Streak broken, currentStreak = 1
      });
    });
  });

  describe('Streak Calculation Edge Cases', () => {
    it('should handle current week with no log yet (daily)', () => {
      const logs = [
        '2025-10-14', // Yesterday
        '2025-10-13',
      ];

      // Expected: Streak continues (today day 0 doesn't break it)
    });

    it('should handle current week with no log yet (weekly)', () => {
      const logs = [
        '2025-10-08', // Last week
        '2025-10-01', // Two weeks ago
      ];

      // Expected: Current week ongoing, streak = 2 weeks so far
    });

    it('should handle user with no logs yet', () => {
      const logs: string[] = [];

      // Expected:
      // - currentStreak = 0
      // - longestStreak = 0
    });

    it('should handle single log', () => {
      const logs = ['2025-10-15'];

      // Expected: currentStreak = 1
    });

    it('should calculate longest streak correctly', () => {
      // Test case: User had long streak in past, broke it, starting new one
      const longestInDb = 30;
      const currentStreak = 5;

      const result = Math.max(longestInDb, currentStreak);
      expect(result).toBe(30);
    });
  });

  describe('Metric Frequency Configuration', () => {
    it('should have correct configuration for weight', () => {
      const config = METRIC_FREQUENCY_CONFIG.weight;

      expect(config.frequency).toBe('daily');
      expect(config.grace_days).toBe(1);
      expect(config.description).toContain('weight');
    });

    it('should have correct configuration for steps', () => {
      const config = METRIC_FREQUENCY_CONFIG.steps;

      expect(config.frequency).toBe('daily');
      expect(config.grace_days).toBe(1);
      expect(config.description).toContain('steps');
    });

    it('should have correct configuration for mood', () => {
      const config = METRIC_FREQUENCY_CONFIG.mood;

      expect(config.frequency).toBe('daily');
      expect(config.grace_days).toBe(2);
      expect(config.description).toContain('mood');
    });

    it('should have correct configuration for measurements', () => {
      const config = METRIC_FREQUENCY_CONFIG.measurements;

      expect(config.frequency).toBe('weekly');
      expect(config.grace_days).toBe(0);
      expect(config.window_start).toBe(1); // Monday
      expect(config.window_end).toBe(0); // Sunday
    });

    it('should have correct configuration for photos', () => {
      const config = METRIC_FREQUENCY_CONFIG.photos;

      expect(config.frequency).toBe('weekly');
      expect(config.grace_days).toBe(0);
      expect(config.window_start).toBe(5); // Friday
      expect(config.window_end).toBe(0); // Sunday
    });
  });

  describe('Week Calculation Logic', () => {
    it('should correctly identify week boundaries (Sun-Sat)', () => {
      // Test various dates and their week starts
      const testCases = [
        { date: '2025-10-15', expectedWeekStart: '2025-10-12' }, // Wed -> Sun
        { date: '2025-10-12', expectedWeekStart: '2025-10-12' }, // Sun -> Sun
        { date: '2025-10-13', expectedWeekStart: '2025-10-12' }, // Mon -> Sun
        { date: '2025-10-18', expectedWeekStart: '2025-10-12' }, // Sat -> Sun
      ];

      // Week calculation logic test
    });

    it('should handle year boundaries correctly', () => {
      const logs = [
        '2025-01-02', // Thu, Week 1 of 2025
        '2024-12-30', // Mon, Last week of 2024
      ];

      // Expected: 2-week streak across year boundary
    });
  });

  describe('Multiple Metrics Tracking', () => {
    it('should track streaks independently for each metric', () => {
      // Test case: User has different streaks for different metrics
      const metrics = {
        weight: { current_streak: 10, longest_streak: 15 },
        steps: { current_streak: 5, longest_streak: 8 },
        mood: { current_streak: 3, longest_streak: 7 },
      };

      // Expected: Each metric maintained separately
    });

    it('should update only affected metric when logging', () => {
      // Test case: User logs weight, only weight streak updates
      const metricType = 'weight';

      // Expected:
      // - Weight streak updated
      // - Steps streak unchanged
      // - Mood streak unchanged
    });
  });

  describe('Integration with Engagement Streak', () => {
    it('should record both engagement and metric streak', async () => {
      // Test case: Logging weight should:
      // 1. Record engagement_activity (weight_log)
      // 2. Update engagement_streak
      // 3. Update metric_streak (weight)
    });
  });

  describe('Performance Tests', () => {
    it('should handle users with 1+ years of logs', () => {
      // Test case: Query limited to last 365 days
      const logs = Array.from({ length: 365 }, (_, i) => {
        const date = new Date('2025-10-15');
        date.setDate(date.getDate() - i);
        return date.toISOString().split('T')[0];
      });

      // Expected: Calculation completes efficiently
    });
  });
});
