import { describe, it, expect } from 'vitest';
import {
  MILESTONES,
  SHIELD_RULES,
  shieldsEarnedBetween,
  milestoneForDays,
  milestoneCrossed,
  nextMilestone,
  earnedMilestones,
} from '@/lib/streaks/streak-config';

describe('MILESTONES', () => {
  it('is sorted ascending and unique', () => {
    const days = MILESTONES.map(m => m.days);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });

  it('covers the canonical celebration points', () => {
    const days = MILESTONES.map(m => m.days);
    for (const expected of [3, 7, 14, 30, 60, 100, 365]) {
      expect(days).toContain(expected);
    }
  });

  it('every milestone has a name, description, badge and icon', () => {
    for (const m of MILESTONES) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.badge.length).toBeGreaterThan(0);
      expect(m.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('shieldsEarnedBetween', () => {
  it('earns +1 at each 7-day boundary', () => {
    expect(shieldsEarnedBetween(6, 7)).toBe(1);
    expect(shieldsEarnedBetween(13, 14)).toBe(1);
    expect(shieldsEarnedBetween(20, 21)).toBe(1);
  });

  it('earns +1 extra at each 30-day boundary', () => {
    expect(shieldsEarnedBetween(29, 30)).toBe(1); // 30 is not a multiple of 7
    expect(shieldsEarnedBetween(209, 210)).toBe(2); // 210 = 7×30 and 30×7 → both
  });

  it('earns nothing between boundaries', () => {
    expect(shieldsEarnedBetween(7, 8)).toBe(0);
    expect(shieldsEarnedBetween(0, 6)).toBe(0);
  });

  it('accumulates across multiple crossed boundaries (retroactive catch-up)', () => {
    // 0 → 31: crosses 7,14,21,28 (4 weekly) + 30 (1 monthly)
    expect(shieldsEarnedBetween(0, 31)).toBe(5);
  });

  it('never awards when the streak shrinks or is equal', () => {
    expect(shieldsEarnedBetween(10, 10)).toBe(0);
    expect(shieldsEarnedBetween(14, 7)).toBe(0);
  });

  it('is path-independent: day-by-day equals one jump', () => {
    let total = 0;
    for (let d = 0; d < 100; d++) total += shieldsEarnedBetween(d, d + 1);
    expect(total).toBe(shieldsEarnedBetween(0, 100));
  });
});

describe('milestone helpers', () => {
  it('milestoneForDays finds exact matches only', () => {
    expect(milestoneForDays(7)?.name).toBeTruthy();
    expect(milestoneForDays(8)).toBeNull();
  });

  it('milestoneCrossed returns the highest newly crossed milestone', () => {
    expect(milestoneCrossed(6, 7)?.days).toBe(7);
    expect(milestoneCrossed(7, 8)).toBeNull();
    expect(milestoneCrossed(0, 31)?.days).toBe(30); // crossed 3,7,14,30 → highest
  });

  it('nextMilestone returns the first milestone above the streak', () => {
    expect(nextMilestone(0)?.days).toBe(3);
    expect(nextMilestone(3)?.days).toBe(7);
    expect(nextMilestone(100)?.days).toBe(180);
  });

  it('earnedMilestones returns everything at or below the longest streak', () => {
    expect(earnedMilestones(30).map(m => m.days)).toEqual([3, 7, 14, 30]);
    expect(earnedMilestones(0)).toEqual([]);
  });
});

describe('SHIELD_RULES', () => {
  it('keeps the economy sane', () => {
    expect(SHIELD_RULES.WEEKLY_EARN_INTERVAL).toBe(7);
    expect(SHIELD_RULES.MONTHLY_EARN_INTERVAL).toBe(30);
    expect(SHIELD_RULES.MAX_SHIELD_BALANCE).toBeGreaterThanOrEqual(2);
    expect(SHIELD_RULES.MAX_SHIELD_BALANCE).toBeLessThanOrEqual(5);
    expect(SHIELD_RULES.MAX_CONSECUTIVE_AUTO_PROTECTS).toBeGreaterThanOrEqual(1);
  });
});
