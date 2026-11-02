import { describe, expect, it } from 'vitest';

import { challengeDays, computeStepsProgress, isStepsChallenge, localMidnight, snapChallengeWindow } from '../challenge-steps';

const TOR = 'America/Toronto';

describe('local day helpers', () => {
  it('finds local midnight across DST', () => {
    expect(localMidnight('2026-11-02', TOR).toISOString()).toBe('2026-11-02T05:00:00.000Z'); // EST
    expect(localMidnight('2026-10-31', TOR).toISOString()).toBe('2026-10-31T04:00:00.000Z'); // EDT
    expect(localMidnight('2026-11-01', TOR).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // DST ends that night
    expect(localMidnight('2026-11-02', 'Asia/Kolkata').toISOString()).toBe('2026-11-01T18:30:00.000Z');
  });

  it('snaps the founder challenge (created 3:02 PM) to whole local days', () => {
    expect(snapChallengeWindow('2026-11-02T20:02:00Z', '2026-11-30T20:01:00Z', TOR)).toEqual({
      starts_at: '2026-11-02T05:00:00.000Z',
      ends_at: '2026-11-30T05:00:00.000Z',
    });
    // Already-midnight input is unchanged; an end on/before the start gets one day.
    expect(snapChallengeWindow('2026-11-02T05:00:00Z', '2026-11-02T06:00:00Z', TOR)).toEqual({
      starts_at: '2026-11-02T05:00:00.000Z',
      ends_at: '2026-11-03T05:00:00.000Z',
    });
  });

  it('lists challenge days in the member zone (ends_at exclusive)', () => {
    expect(challengeDays('2026-11-02T05:00:00Z', '2026-11-30T05:00:00Z', TOR)).toEqual({ first: '2026-11-02', last: '2026-11-29' });
    // The unsnapped prod row still counts Nov 2 from its first minute.
    expect(challengeDays('2026-11-02T20:02:00Z', '2026-11-30T20:01:00Z', TOR)).toEqual({ first: '2026-11-02', last: '2026-11-30' });
  });

  it('recognises steps challenges by unit', () => {
    expect(isStepsChallenge({ unit: ' Steps ' })).toBe(true);
    expect(isStepsChallenge({ unit: 'reps' })).toBe(false);
    expect(isStepsChallenge(null)).toBe(false);
  });
});

describe('computeStepsProgress', () => {
  const base = { goalAmount: 168000, dailyGoal: 8000, first: '2026-11-02', last: '2026-11-29', lastSyncedAt: '2026-11-04T15:00:00Z' };

  it('takes max(synced, manual) per day inside the window', () => {
    const p = computeStepsProgress({
      ...base,
      today: '2026-11-04',
      synced: new Map([
        ['2026-11-01', 20000], // before the start
        ['2026-11-02', 9000],
        ['2026-11-03', 3000],
        ['2026-11-04', 8500],
      ]),
      logs: [
        { amount: 2000, log_date: '2026-11-03', logged_at: '2026-11-03T12:00:00Z' },
        { amount: 2500, log_date: '2026-11-03', logged_at: '2026-11-03T18:00:00Z' },
        { amount: 100, log_date: '2026-11-04', logged_at: '2026-11-04T10:00:00Z' },
      ],
    });
    expect(p.days.map((d) => d.amount)).toEqual([9000, 4500, 8500]);
    expect(p).toMatchObject({ cumulative_total: 22000, today_total: 8500, log_count: 3, goal_completion_pct: 13.1, current_streak: 1, longest_streak: 1 });
    expect(p.last_logged_at).toBe('2026-11-04T15:00:00Z');
  });

  it("keeps a streak alive while today is still under goal", () => {
    const p = computeStepsProgress({
      ...base,
      today: '2026-11-04',
      synced: new Map([['2026-11-02', 8000], ['2026-11-03', 8100], ['2026-11-04', 1200]]),
      logs: [],
    });
    expect(p).toMatchObject({ current_streak: 2, longest_streak: 2, today_total: 1200 });
  });

  it('is zero before the start and frozen after the end', () => {
    expect(computeStepsProgress({ ...base, today: '2026-11-01', synced: new Map([['2026-11-01', 9000]]), logs: [] })).toMatchObject({
      cumulative_total: 0, today_total: 0, log_count: 0, goal_completion_pct: 0, last_logged_at: null,
    });
    const done = computeStepsProgress({ ...base, last: '2026-11-03', today: '2026-11-10', synced: new Map([['2026-11-03', 5], ['2026-11-10', 99]]), logs: [] });
    expect(done).toMatchObject({ cumulative_total: 5, today_total: 0 });
  });

  it('caps the completion percentage at 100', () => {
    const p = computeStepsProgress({ ...base, goalAmount: 1000, today: '2026-11-02', synced: new Map([['2026-11-02', 5000]]), logs: [] });
    expect(p.goal_completion_pct).toBe(100);
  });
});
