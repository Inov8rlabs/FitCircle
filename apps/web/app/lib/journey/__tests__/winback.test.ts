import { describe, expect, it } from 'vitest';

import { computeLifecycle } from '../../notifications/lifecycle';
import { SEND_WINDOW, day14Copy, day30Copy, day3Copy, day7Copy, selectWinbackStep, winbackDedupeKey } from '../winback';

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const now = new Date('2026-11-13T23:30:00Z'); // 18:30 New York
const at = (daysAgo: number) => computeLifecycle(new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), now, 'America/New_York');
const empty = { sentSteps: new Set<any>(), lastWinbackAt: null, lastTriggerAt: null };
const pick = (lifecycle: any, extra: Partial<Parameters<typeof selectWinbackStep>[0]> = {}) =>
  selectWinbackStep({ lifecycle, testUser: false, localMinutes: 18 * 60 + 30, history: empty, now, ...extra });

describe('win-back step selection', () => {
  it('maps each lapse band to its step and nothing for active / dormant', () => {
    expect(pick(at(1))).toEqual({ skip: 'not_lapsed' });
    expect(pick(at(3))).toEqual({ step: 'day3' });
    expect(pick(at(5))).toEqual({ step: 'day3' }); // catch-up inside the band
    expect(pick(at(7))).toEqual({ step: 'day7' });
    expect(pick(at(14))).toEqual({ step: 'day14' });
    expect(pick(at(29))).toEqual({ step: 'day14' });
    expect(pick(at(30))).toEqual({ step: 'day30' });
    expect(pick(at(31))).toEqual({ skip: 'not_lapsed' });
    expect(pick(null)).toEqual({ skip: 'unknown_stage' });
  });

  it('is idempotent per lapse episode and spaced', () => {
    expect(pick(at(4), { history: { ...empty, sentSteps: new Set(['day3']) } })).toEqual({ skip: 'already_sent' });
    // Day 7 after day 3 went out 4 days ago: due.
    expect(pick(at(7), { history: { ...empty, sentSteps: new Set(['day3']), lastWinbackAt: new Date(now.getTime() - 96 * 3_600_000).toISOString() } })).toEqual({ step: 'day7' });
    // Any win-back in the last 44 h blocks the next one.
    expect(pick(at(7), { history: { ...empty, lastWinbackAt: new Date(now.getTime() - 30 * 3_600_000).toISOString() } })).toEqual({ skip: 'spacing' });
  });

  it('an overtake / health-sync push today replaces the step', () => {
    expect(pick(at(3), { history: { ...empty, lastTriggerAt: new Date(now.getTime() - 3 * 3_600_000).toISOString() } })).toEqual({ skip: 'replaced_by_trigger' });
    expect(pick(at(3), { history: { ...empty, lastTriggerAt: new Date(now.getTime() - 25 * 3_600_000).toISOString() } })).toEqual({ step: 'day3' });
  });

  it('local evening window + test accounts', () => {
    expect(pick(at(3), { localMinutes: SEND_WINDOW.start - 1 })).toEqual({ skip: 'outside_window' });
    expect(pick(at(3), { localMinutes: SEND_WINDOW.end })).toEqual({ skip: 'outside_window' });
    expect(pick(at(3), { localMinutes: 9 * 60, ignoreWindow: true })).toEqual({ step: 'day3' });
    expect(pick(at(3), { testUser: true })).toEqual({ skip: 'test_user' });
  });

  it('dedupe key = step + lapse start', () => {
    expect(winbackDedupeKey('day3', '2026-11-10')).toBe('winback:day3:2026-11-10');
  });
});

describe('win-back copy', () => {
  it('day 3: scans left only for free users who have some', () => {
    expect(day3Copy({ scansLeft: 3, isPro: false })).toMatchObject({ variant: 'scans_left', screen: 'food_log', body: expect.stringContaining('3 free meal scans left') });
    expect(day3Copy({ scansLeft: 1, isPro: false }).body).toContain('1 free meal scan left');
    // Pro / trial: never a scans count.
    const pro = day3Copy({ scansLeft: 3, isPro: true });
    expect(pro.variant).toBe('two_taps');
    expect(pro.body).not.toMatch(/\d/);
    // Gate dark / unknown → generic.
    expect(day3Copy({ scansLeft: null, isPro: false }).variant).toBe('two_taps');
    // 0 left: no photo-scan promise.
    const zero = day3Copy({ scansLeft: 0, isPro: false });
    expect(zero.variant).toBe('manual_log');
    expect(zero.body.toLowerCase()).not.toContain('photo');
    expect(zero.title.toLowerCase()).not.toContain('snap');
  });

  it('day 7: real circle facts or a plain restart (no fabricated social proof)', () => {
    expect(day7Copy({ circleId: 'c1', circleName: 'Morning Movers', activeOthers: 1, top: { name: 'Priya', days: 4 } })).toMatchObject({
      title: 'This week in Morning Movers',
      body: 'Priya checked in on 4 days this week. One log tonight puts you back on the board.',
      screen: 'circle_detail',
      circleId: 'c1',
    });
    expect(day7Copy({ circleId: 'c1', circleName: 'Crew', activeOthers: 3, top: { name: 'Sam', days: 6 } }).body).toContain('Sam and 2 others checked in this week.');
    const plain = day7Copy(null);
    expect(plain).toMatchObject({ screen: 'dashboard', variant: 'restart' });
    expect(plain.body).not.toMatch(/\d/);
    expect(day7Copy({ circleId: 'c1', circleName: 'Crew', activeOthers: 0, top: null }).variant).toBe('restart');
  });

  it('day 14: their own history', () => {
    expect(day14Copy({ daysLogged: 12, longestStreak: 5 }).body).toBe('You have logged meals on 12 days so far. One log today adds the next.');
    expect(day14Copy({ daysLogged: 1, longestStreak: 4 }).body).toContain('best streak is 4 days');
    expect(day14Copy({ daysLogged: 0, longestStreak: 0 }).variant).toBe('restart');
  });

  it('day 30: live campaign or a feature highlight', () => {
    expect(day30Copy({ slug: 'hold-the-line', title: 'Hold the Line', tagline: 'Nov 15 – Dec 15 with your circle' })).toMatchObject({ screen: 'campaign', campaignSlug: 'hold-the-line', title: 'Hold the Line is on' });
    expect(day30Copy(null)).toMatchObject({ screen: 'dashboard', variant: 'feature' });
  });

  it('no emoji anywhere', () => {
    const all = [
      day3Copy({ scansLeft: 2, isPro: false }),
      day3Copy({ scansLeft: 0, isPro: false }),
      day7Copy(null),
      day14Copy({ daysLogged: 3, longestStreak: 0 }),
      day30Copy(null),
    ];
    for (const c of all) expect(EMOJI_RE.test(c.title + c.body)).toBe(false);
  });
});
