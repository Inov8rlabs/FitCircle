/** Pure allowance math (docs/ENGAGEMENT_115_SPEC.md §2.1, §3.1). */
import { describe, expect, it } from 'vitest';

import {
  allowanceTimezone,
  dailyScansUsed,
  fitzyAllowanceFrom,
  freeFoodScanAllowance,
  localDayWindow,
  localWeekWindow,
  nextUtcMidnight,
} from '../allowance';

describe('dailyScansUsed (no double counting across the starter → daily boundary)', () => {
  it.each([
    // total, lifetime L, today T, expected dailyUsed
    [21, 21, 0, 0], // starter finished yesterday, nothing today
    [21, 21, 3, 0], // the 3 today were the last starter scans
    [21, 22, 3, 1], // 3 today: 2 starter + 1 daily
    [21, 23, 3, 2], // 3 today: 1 starter + 2 daily
    [21, 25, 4, 4], // starter finished on an earlier day: every scan today is daily
    [21, 10, 2, 0], // still inside the starter allowance
    [0, 2, 2, 2], // no starter at all
  ])('total %i, L=%i, T=%i → %i', (total, l, t, expected) => {
    expect(dailyScansUsed(total, l, t)).toBe(expected);
  });

  it('never trusts T > L (clock skew, partial reads)', () => {
    expect(dailyScansUsed(21, 22, 30)).toBe(1);
  });
});

describe('freeFoodScanAllowance phases', () => {
  const base = { total: 21, daily: 2, timezone: 'America/New_York', resetsAt: new Date('2026-11-14T05:00:00.000Z') };

  it('starter: remaining = total − lifetime; dailyLimit announced, no reset', () => {
    expect(freeFoodScanAllowance({ ...base, lifetimeUsed: 19, todayUsed: 0 })).toEqual({
      mode: 'starter', remaining: 2, starterTotal: 21, starterRemaining: 2, dailyLimit: 2, dailyRemaining: null, resetsAt: null, timezone: 'America/New_York',
    });
  });

  it('daily: remaining = daily − dailyUsed, resets at the next local midnight', () => {
    expect(freeFoodScanAllowance({ ...base, lifetimeUsed: 22, todayUsed: 1 })).toEqual({
      mode: 'daily', remaining: 1, starterTotal: 21, starterRemaining: 0, dailyLimit: 2, dailyRemaining: 1, resetsAt: '2026-11-14T05:00:00.000Z', timezone: 'America/New_York',
    });
  });

  it('the boundary day: starter scans today do not eat the daily allowance', () => {
    expect(freeFoodScanAllowance({ ...base, lifetimeUsed: 21, todayUsed: 3 }).remaining).toBe(2);
  });

  it('exhausted when the daily key is 0 (1.1.2–1.1.4, web): today behaviour', () => {
    expect(freeFoodScanAllowance({ ...base, daily: 0, lifetimeUsed: 21, todayUsed: 0 })).toEqual({
      mode: 'exhausted', remaining: 0, starterTotal: 21, starterRemaining: 0, dailyLimit: null, dailyRemaining: null, resetsAt: null, timezone: 'America/New_York',
    });
  });

  it('daily at 0 stays in daily mode (the meter says "resets at midnight")', () => {
    const a = freeFoodScanAllowance({ ...base, lifetimeUsed: 30, todayUsed: 2 });
    expect(a).toMatchObject({ mode: 'daily', remaining: 0, dailyRemaining: 0 });
  });
});

describe('local day window', () => {
  it.each([
    ['America/New_York', '2026-11-13T15:00:00Z', '2026-11-13T05:00:00.000Z', '2026-11-14T05:00:00.000Z'],
    ['Asia/Kolkata', '2026-11-13T20:00:00Z', '2026-11-13T18:30:00.000Z', '2026-11-14T18:30:00.000Z'],
    ['Pacific/Auckland', '2026-11-13T09:30:00Z', '2026-11-12T11:00:00.000Z', '2026-11-13T11:00:00.000Z'],
    // One second before local midnight / exactly at it.
    ['America/New_York', '2026-11-14T04:59:59Z', '2026-11-13T05:00:00.000Z', '2026-11-14T05:00:00.000Z'],
    ['America/New_York', '2026-11-14T05:00:00Z', '2026-11-14T05:00:00.000Z', '2026-11-15T05:00:00.000Z'],
  ])('%s at %s', (tz, now, start, resets) => {
    const w = localDayWindow(tz, new Date(now));
    expect(w.start.toISOString()).toBe(start);
    expect(w.resetsAt.toISOString()).toBe(resets);
  });

  it('a DST day is 25 hours long (New York, 1 Nov 2026)', () => {
    const w = localDayWindow('America/New_York', new Date('2026-11-01T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(w.resetsAt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('local week window (Monday 00:00 local)', () => {
  it('Friday → the Monday before, resets next Monday', () => {
    const w = localWeekWindow('America/New_York', new Date('2026-11-13T15:00:00Z')); // Fri
    expect(w.start.toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(w.resetsAt.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });

  it('Sunday 23:59 local still belongs to the old week; Monday 00:00 starts a new one', () => {
    const sunday = localWeekWindow('America/New_York', new Date('2026-11-16T04:59:00Z'));
    expect(sunday.start.toISOString()).toBe('2026-11-09T05:00:00.000Z');
    const monday = localWeekWindow('America/New_York', new Date('2026-11-16T05:00:00Z'));
    expect(monday.start.toISOString()).toBe('2026-11-16T05:00:00.000Z');
    expect(monday.resetsAt.toISOString()).toBe('2026-11-23T05:00:00.000Z');
  });

  it('uses the user zone, not UTC (Auckland is already Monday)', () => {
    const w = localWeekWindow('Pacific/Auckland', new Date('2026-11-15T12:00:00Z')); // Mon 01:00 NZDT
    expect(w.start.toISOString()).toBe('2026-11-15T11:00:00.000Z');
  });
});

describe('timezone fallback and Fitzy allowance', () => {
  it('request zone → profile zone → New York', () => {
    expect(allowanceTimezone('Europe/Berlin', 'Asia/Tokyo')).toBe('Europe/Berlin');
    expect(allowanceTimezone('Not/AZone', 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(allowanceTimezone(null, null)).toBe('America/New_York');
  });

  it('weekly / daily / locked modes', () => {
    const r = new Date('2026-11-16T05:00:00Z');
    expect(fitzyAllowanceFrom({ window: 'week', limit: 3, used: 1, resetsAt: r })).toEqual({
      mode: 'weekly', limit: 3, used: 1, remaining: 2, window: 'week', resetsAt: '2026-11-16T05:00:00.000Z',
    });
    expect(fitzyAllowanceFrom({ window: 'day', limit: 5, used: 7, resetsAt: r })).toMatchObject({ mode: 'daily', remaining: 0 });
    expect(fitzyAllowanceFrom({ window: 'day', limit: 0, used: 0, resetsAt: r })).toMatchObject({ mode: 'locked', remaining: 0 });
  });

  it('next UTC midnight', () => {
    expect(nextUtcMidnight(new Date('2026-11-13T23:59:59Z')).toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });
});
