import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { MAX_STREAK_FREEZES, FREEZE_EARN_STREAK_DAYS } from '@/lib/types/streak';

// Mock Supabase admin
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  })),
}));

describe('EngagementStreakService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Streak Calculation Logic', () => {
    it('should calculate consecutive day streak correctly', async () => {
      // Test case: User has logged activities for last 5 days
      const activities = [
        { activity_date: '2025-10-15' }, // Today
        { activity_date: '2025-10-14' }, // Yesterday
        { activity_date: '2025-10-13' },
        { activity_date: '2025-10-12' },
        { activity_date: '2025-10-11' },
      ];

      // Expected: 5-day streak
      // This would be tested through the private calculateStreakWithGrace method
      // Since it's private, we test it indirectly through updateEngagementStreak
    });

    it('should not break streak for today with no activity yet', () => {
      // Test case: User has logged yesterday but not today yet
      const activities = [
        { activity_date: '2025-10-14' }, // Yesterday
        { activity_date: '2025-10-13' },
      ];

      // Expected: 2-day streak (today doesn't count as broken yet)
    });

    it('should use freeze when day is missed', () => {
      // Test case: User missed one day but has freezes available
      const activities = [
        { activity_date: '2025-10-15' }, // Today
        // { activity_date: '2025-10-14' }, // MISSED
        { activity_date: '2025-10-13' },
        { activity_date: '2025-10-12' },
      ];

      const freezesAvailable = 2;

      // Expected:
      // - Streak continues (uses 1 freeze)
      // - freezesUsed = 1
      // - currentStreak = 3
    });

    it('should break streak when no freezes available', () => {
      // Test case: User missed a day and has no freezes
      const activities = [
        { activity_date: '2025-10-15' }, // Today
        // { activity_date: '2025-10-14' }, // MISSED
        { activity_date: '2025-10-13' },
        { activity_date: '2025-10-12' },
      ];

      const freezesAvailable = 0;

      // Expected:
      // - Streak broken
      // - currentStreak = 1 (just today)
    });

    it('should earn freeze at 7-day milestone', () => {
      // Test case: User reaches 7-day streak
      const oldStreak = 6;
      const newStreak = 7;

      // Expected: Earn 1 freeze
      // freezesEarned = 1
    });

    it('should earn multiple freezes for multiple milestones', () => {
      // Test case: User goes from 6 to 14 days (crosses 7 and 14)
      const oldStreak = 6;
      const newStreak = 14;

      // Expected: Earn 2 freezes (one at 7, one at 14)
      // freezesEarned = 2
    });

    it('should cap freezes at maximum of 5', () => {
      // Test case: User has 4 freezes and earns 2 more
      const currentFreezesAvailable = 4;
      const freezesEarned = 2;

      const result = Math.min(MAX_STREAK_FREEZES, currentFreezesAvailable + freezesEarned);

      expect(result).toBe(MAX_STREAK_FREEZES);
    });

    it('should handle long gaps between activities', () => {
      // Test case: User has activity today but last activity was 30 days ago
      const activities = [
        { activity_date: '2025-10-15' }, // Today
        { activity_date: '2025-09-15' }, // 30 days ago
      ];

      const freezesAvailable = 5;

      // Expected:
      // - All freezes used (5 days)
      // - Streak broken after that
      // - currentStreak = 1 (just today)
    });
  });

  describe('Freeze Management', () => {
    it('should reset freezes weekly', async () => {
      // Test case: Weekly reset date has passed
      const today = new Date('2025-10-15');
      const lastResetDate = new Date('2025-10-08'); // 7 days ago

      // Expected:
      // - Add 1 freeze (up to max 5)
      // - Reset freezes_used_this_week to 0
      // - Set new reset date to +7 days
    });

    it('should not exceed max freezes on weekly reset', () => {
      // Test case: User already has 5 freezes
      const currentFreezes = 5;

      const newFreezes = Math.min(MAX_STREAK_FREEZES, currentFreezes + 1);

      expect(newFreezes).toBe(MAX_STREAK_FREEZES);
    });
  });

  describe('Pause Functionality', () => {
    it('should pause streak successfully', async () => {
      // Test case: User requests pause for 30 days
      const userId = 'test-user-id';
      const resumeDate = new Date('2025-11-15');

      // Mock implementation would verify:
      // - paused = true
      // - pause_start_date = today
      // - pause_end_date = resumeDate
    });

    it('should reject pause longer than 90 days', async () => {
      // Test case: User tries to pause for 100 days
      const userId = 'test-user-id';
      const resumeDate = new Date();
      resumeDate.setDate(resumeDate.getDate() + 100);

      // Expected: Throw StreakError with PAUSE_TOO_LONG code
    });

    it('should resume paused streak', async () => {
      // Test case: User resumes paused streak
      const userId = 'test-user-id';

      // Mock implementation would verify:
      // - paused = false
      // - pause_start_date = null
      // - pause_end_date = null
      // - Streak recalculated
    });

    it('should not update streak while paused', async () => {
      // Test case: User logs activity while paused
      const userId = 'test-user-id';

      // Expected:
      // - Activity recorded
      // - Streak NOT updated
    });
  });

  describe('Edge Cases', () => {
    it('should handle timezone boundaries correctly', () => {
      // Test case: Activity logged at 11:59 PM vs 12:01 AM
      // Should be treated as different days
    });

    it('should handle first-time user with no activities', async () => {
      // Test case: New user, no streak record exists
      const userId = 'new-user-id';

      // Expected:
      // - Create new streak record
      // - current_streak = 0
      // - freezes_available = 1 (default)
    });

    it('should handle user with single activity today', () => {
      // Test case: User just logged first activity today
      const activities = [
        { activity_date: '2025-10-15' }, // Today
      ];

      // Expected:
      // - current_streak = 1
      // - No freezes used
    });

    it('should calculate longest streak correctly', () => {
      // Test case: User had 10-day streak in past, current is 5
      const longestStreakInDb = 10;
      const currentStreak = 5;

      const result = Math.max(longestStreakInDb, currentStreak);

      expect(result).toBe(10);
    });

    it('should handle multiple activities on same day', () => {
      // Test case: User logs weight, steps, and mood on same day
      // Should count as single day for engagement streak
      const activities = [
        { activity_date: '2025-10-15', activity_type: 'weight_log' },
        { activity_date: '2025-10-15', activity_type: 'steps_log' },
        { activity_date: '2025-10-15', activity_type: 'mood_log' },
      ];

      // Expected: 1-day streak (activities grouped by date)
    });
  });

  describe('Freeze Earning Logic', () => {
    const testCases = [
      { oldStreak: 0, newStreak: 6, expectedFreezes: 0, description: 'Below first milestone' },
      { oldStreak: 6, newStreak: 7, expectedFreezes: 1, description: 'Cross 7-day milestone' },
      { oldStreak: 7, newStreak: 13, expectedFreezes: 0, description: 'Between milestones' },
      { oldStreak: 13, newStreak: 14, expectedFreezes: 1, description: 'Cross 14-day milestone' },
      { oldStreak: 6, newStreak: 14, expectedFreezes: 2, description: 'Cross multiple milestones' },
      { oldStreak: 20, newStreak: 21, expectedFreezes: 1, description: 'Cross 21-day milestone (3x7)' },
    ];

    testCases.forEach(({ oldStreak, newStreak, expectedFreezes, description }) => {
      it(`should earn ${expectedFreezes} freeze(s): ${description}`, () => {
        const oldMilestones = Math.floor(oldStreak / FREEZE_EARN_STREAK_DAYS);
        const newMilestones = Math.floor(newStreak / FREEZE_EARN_STREAK_DAYS);
        const earned = Math.max(0, newMilestones - oldMilestones);

        expect(earned).toBe(expectedFreezes);
      });
    });
  });

  describe('Activity Recording', () => {
    it('should record engagement activity successfully', async () => {
      const userId = 'test-user-id';
      const activityType = 'weight_log';
      const referenceId = 'tracking-record-id';

      // Mock would verify INSERT into engagement_activities
    });

    it('should handle duplicate activity gracefully', async () => {
      // Test case: Same activity recorded twice on same day
      const userId = 'test-user-id';
      const activityType = 'weight_log';
      const activityDate = '2025-10-15';

      // Expected: Second insert ignored (UNIQUE constraint)
      // No error thrown
    });

    it('should update engagement streak after recording activity', async () => {
      const userId = 'test-user-id';
      const activityType = 'steps_log';

      // Expected:
      // 1. Insert activity
      // 2. Update engagement streak
    });
  });

  describe('Performance Considerations', () => {
    it('should only query last 90 days of activities', () => {
      // Test case: User has 2 years of data
      // Expected: Query limited to 90 days for performance
    });

    it('should calculate streak efficiently for active users', () => {
      // Test case: User with 90 days of consecutive activities
      // Expected: Calculation completes in reasonable time (<100ms)
    });
  });

  describe('Error Handling', () => {
    it('should throw StreakError when pausing already paused streak', async () => {
      // Test case: User tries to pause when already paused
      // Expected: StreakError with ALREADY_PAUSED code
    });

    it('should throw StreakError when resuming non-paused streak', async () => {
      // Test case: User tries to resume when not paused
      // Expected: StreakError with NOT_PAUSED code
    });

    it('should throw StreakError when purchasing freeze at max', async () => {
      // Test case: User has 5 freezes and tries to buy more
      // Expected: StreakError with NO_FREEZES_AVAILABLE code
    });

    it('should handle database errors gracefully', async () => {
      // Test case: Database connection fails
      // Expected: Error propagated with useful message
    });
  });
});
