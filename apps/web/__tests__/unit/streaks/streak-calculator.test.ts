import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  localToday,
  addDays,
  daysBetween,
  isWithinGracePeriod,
  isWithinRetroactiveWindow,
  calculateStreak,
} from '@/lib/streaks/streak-calculator';

afterEach(() => {
  vi.useRealTimers();
});

describe('localToday', () => {
  it('returns the local date for a timezone east of UTC', () => {
    // 2026-08-03T20:00:00Z = Aug 4, 05:00 in Tokyo
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T20:00:00Z'));
    expect(localToday('Asia/Tokyo')).toBe('2026-08-04');
    expect(localToday('UTC')).toBe('2026-08-03');
  });

  it('returns the local date for a timezone west of UTC', () => {
    // 2026-08-04T02:00:00Z = Aug 3, 19:00 in Los Angeles
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T02:00:00Z'));
    expect(localToday('America/Los_Angeles')).toBe('2026-08-03');
  });

  it('falls back to UTC for invalid or missing timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
    expect(localToday('Not/AZone')).toBe('2026-08-03');
    expect(localToday()).toBe('2026-08-03');
  });
});

describe('addDays / daysBetween', () => {
  it('adds and subtracts days across month boundaries', () => {
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('is DST-proof (pure calendar math)', () => {
    // US DST spring-forward 2026-03-08
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});

describe('isWithinGracePeriod', () => {
  it('is true before 3am local, false after', () => {
    vi.useFakeTimers();
    // 06:00 UTC = 02:00 in Berlin (UTC+2 in summer) → within grace
    vi.setSystemTime(new Date('2026-08-04T00:30:00Z'));
    expect(isWithinGracePeriod('Europe/Berlin')).toBe(true); // 02:30 local
    expect(isWithinGracePeriod('UTC')).toBe(true); // 00:30
    expect(isWithinGracePeriod('Asia/Tokyo')).toBe(false); // 09:30 local
  });
});

describe('isWithinRetroactiveWindow', () => {
  const today = '2026-08-03';

  it('accepts today and the past 6 days (7-day window)', () => {
    expect(isWithinRetroactiveWindow('2026-08-03', today)).toBe(true);
    expect(isWithinRetroactiveWindow('2026-07-28', today)).toBe(true); // 6 days back
    expect(isWithinRetroactiveWindow('2026-07-27', today)).toBe(false); // 7 days back
  });

  it('rejects future dates', () => {
    expect(isWithinRetroactiveWindow('2026-08-04', today)).toBe(false);
  });
});

describe('calculateStreak', () => {
  const today = '2026-08-03';

  it('returns 0 with no claims', () => {
    expect(calculateStreak(new Set(), today)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const claims = new Set(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(calculateStreak(claims, today)).toBe(3);
  });

  it("today unclaimed doesn't break the streak (free pass)", () => {
    const claims = new Set(['2026-07-31', '2026-08-01', '2026-08-02']);
    expect(calculateStreak(claims, today)).toBe(3);
  });

  it('a gap before yesterday breaks the streak', () => {
    const claims = new Set(['2026-07-30', '2026-07-31', '2026-08-02', '2026-08-03']);
    expect(calculateStreak(claims, today)).toBe(2); // Aug 2-3 only
  });

  it('missing yesterday AND today means broken (0)', () => {
    const claims = new Set(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(calculateStreak(claims, today)).toBe(0);
  });

  it('counts a long unbroken run', () => {
    const claims = new Set<string>();
    for (let i = 0; i < 100; i++) claims.add(addDays(today, -i));
    expect(calculateStreak(claims, today)).toBe(100);
  });

  it('anchors on the provided today (timezone correctness)', () => {
    const claims = new Set(['2026-08-02', '2026-08-03']);
    // For a user whose local today is Aug 4 (e.g. Tokyo morning), the run
    // ended yesterday and still counts.
    expect(calculateStreak(claims, '2026-08-04')).toBe(2);
    // But if their local today were Aug 5, the streak is broken.
    expect(calculateStreak(claims, '2026-08-05')).toBe(0);
  });
});

describe('localDayOf / isValidTimezone', () => {
  it('projects an instant into the user timezone', async () => {
    const { localDayOf, isValidTimezone } = await import('@/lib/streaks/streak-calculator');
    expect(localDayOf('2026-08-03T06:30:00.000Z', 'America/Los_Angeles')).toBe('2026-08-02');
    expect(localDayOf('2026-08-03T19:00:00.000Z', 'Asia/Kolkata')).toBe('2026-08-04');
    expect(localDayOf('2026-08-03T12:00:00.000Z', null)).toBe('2026-08-03');
    expect(localDayOf('2026-08-03T12:00:00.000Z', 'Not/AZone')).toBe('2026-08-03');
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Nowhere/Land')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
  });
});
