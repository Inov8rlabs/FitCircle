/**
 * Weekly report selection: week types, zero-data handling, stats only where
 * we have data, biggest win from real data, next-week targets, growth-slot
 * rotation / skip / relevance rules and copy determinism.
 */
import { describe, expect, it } from 'vitest';

import {
  biggestWin,
  buildStatTiles,
  buildWeeklyReport,
  classifyWeek,
  nextWeekGoals,
  relevantGrowthVariants,
  selectGrowthSlot,
} from '../messages/weekly-report';
import { addDays, isoWeekKey } from '../time';
import type { MessagePlan } from '../types';

import { week, weeklyFacts } from './fixtures';

const plan = (f = weeklyFacts()): MessagePlan => {
  const p = buildWeeklyReport(f);
  if ('skip' in p) throw new Error(`skipped: ${p.skip}`);
  return p;
};

describe('classifyWeek', () => {
  it('skips fully dormant people (no activity this week or the 4 before)', () => {
    expect(classifyWeek(weeklyFacts({ thisWeek: week(), lastWeek: week(), activeDaysPrior4Weeks: 0 }))).toEqual({ skip: 'dormant' });
    expect(buildWeeklyReport(weeklyFacts({ thisWeek: week(), lastWeek: week(), activeDaysPrior4Weeks: 0 }))).toEqual({ skip: 'dormant' });
  });

  it('zero activity this week but some recently → fresh start', () => {
    expect(classifyWeek(weeklyFacts({ thisWeek: week(), activeDaysPrior4Weeks: 3 }))).toBe('fresh_start');
  });

  it('best week beats every earlier week (needs history)', () => {
    expect(classifyWeek(weeklyFacts({ thisWeek: week({ activeDays: 6 }), bestPriorActiveDays: 5 }))).toBe('best_week');
    expect(classifyWeek(weeklyFacts({ thisWeek: week({ activeDays: 6 }), bestPriorActiveDays: null }))).toBe('consistent');
  });

  it('comeback after a zero week with earlier history', () => {
    expect(classifyWeek(weeklyFacts({ thisWeek: week({ activeDays: 2 }), lastWeek: week(), activeDaysPrior4Weeks: 4, bestPriorActiveDays: 4 }))).toBe('comeback');
  });

  it('consistent / building / quiet', () => {
    expect(classifyWeek(weeklyFacts({ thisWeek: week({ activeDays: 5 }), bestPriorActiveDays: 7 }))).toBe('consistent');
    expect(classifyWeek(weeklyFacts({ thisWeek: week({ activeDays: 3 }), lastWeek: week({ activeDays: 2 }), bestPriorActiveDays: 7 }))).toBe('building');
    expect(classifyWeek(weeklyFacts({ thisWeek: week({ activeDays: 1 }), lastWeek: week({ activeDays: 4 }), bestPriorActiveDays: 7 }))).toBe('quiet');
  });
});

describe('fresh start variant', () => {
  it('is short: no stats table, no growth slot, one CTA', () => {
    const p = plan(weeklyFacts({ thisWeek: week(), activeDaysPrior4Weeks: 5 }));
    const kinds = p.email!.blocks.map((b) => b.kind);
    expect(kinds).toEqual(['hero', 'list', 'cta']);
    expect(p.variants.growth).toBe('none');
    expect(p.push!.title).toBe('A fresh week starts tomorrow');
    expect(JSON.stringify(p.email)).not.toMatch(/0\/7/);
  });
});

describe('stat tiles: only data we have', () => {
  it('hides steps, water, weight, workouts when never tracked', () => {
    const ids = buildStatTiles(weeklyFacts()).map((t) => t.id);
    expect(ids).toEqual(['active_days', 'meals', 'streak']);
  });

  it('shows steps / water / weight / workouts when present, with week-over-week deltas', () => {
    const f = weeklyFacts({
      goals: { dailyStepsTarget: 8000, dailyWaterMlTarget: 2000, targetWeightKg: 80 },
      thisWeek: week({
        activeDays: 5,
        meals: { count: 12, days: 5 },
        workouts: { count: 3, minutes: 95 },
        steps: { total: 56000, daysWithData: 7, daysAtGoal: 4 },
        water: { days: 5, daysAtGoal: 3 },
        weight: { first: 85, last: 84.4, entries: 3 },
      }),
      lastWeek: week({ activeDays: 3, meals: { count: 6, days: 3 }, workouts: { count: 1, minutes: 30 }, steps: { total: 42000, daysWithData: 7, daysAtGoal: 2 } }),
    });
    const tiles = buildStatTiles(f);
    expect(tiles.map((t) => t.id)).toEqual(['active_days', 'meals', 'workouts', 'steps', 'streak', 'water']);
    expect(tiles.find((t) => t.id === 'meals')!.delta).toBe('+6 vs last week');
    expect(tiles.find((t) => t.id === 'steps')!.value).toBe('8,000');
    expect(tiles.length).toBeLessThanOrEqual(6);
  });

  it('weight change shows in the unit the person uses, only when measurable', () => {
    const f = weeklyFacts({ streak: { current: 0, longest: 0 }, thisWeek: week({ activeDays: 2, weight: { first: 85, last: 84, entries: 2 } }) });
    const w = buildStatTiles(f).find((t) => t.id === 'weight')!;
    expect(w.value).toBe('−2.2 lb');
    const single = weeklyFacts({ thisWeek: week({ activeDays: 1, weight: { first: 85, last: 85, entries: 1 } }) });
    expect(buildStatTiles(single).find((t) => t.id === 'weight')).toBeUndefined();
  });

  it('a decline is phrased neutrally (no red, no guilt)', () => {
    const t = buildStatTiles(weeklyFacts({ thisWeek: week({ activeDays: 2, meals: { count: 2, days: 2 } }), lastWeek: week({ activeDays: 5, meals: { count: 9, days: 5 } }) }));
    expect(t.find((x) => x.id === 'meals')!.delta).toBe('9 last week');
  });
});

describe('biggest win', () => {
  it('prefers a record week, then a long streak', () => {
    expect(biggestWin(weeklyFacts({ thisWeek: week({ activeDays: 6 }), bestPriorActiveDays: 5 }), 'best_week')!.title).toMatch(/6 active days/);
    expect(biggestWin(weeklyFacts({ streak: { current: 12, longest: 12 } }), 'building')!.title).toBe('12-day streak');
  });

  it('circle leader', () => {
    const f = weeklyFacts({ circles: [{ id: 'c', name: 'Lunch Club', memberCount: 4, activeMembersThisWeek: 3, yourActiveDays: 5, yourRank: 1, upcoming: false, inviteCode: 'FITABC123', joinedAt: null }] });
    expect(biggestWin(f, 'consistent')!.title).toBe('Most active in Lunch Club');
  });

  it('weight win only when moving toward the target the person set', () => {
    const toward = weeklyFacts({ goals: { dailyStepsTarget: null, dailyWaterMlTarget: null, targetWeightKg: 80 }, streak: { current: 0, longest: 0 }, thisWeek: week({ activeDays: 2, weight: { first: 85, last: 84.5, entries: 2 } }) });
    expect(biggestWin(toward, 'building')!.title).toMatch(/closer to your goal/);
    const away = weeklyFacts({ goals: { dailyStepsTarget: null, dailyWaterMlTarget: null, targetWeightKg: 90 }, streak: { current: 0, longest: 0 }, thisWeek: week({ activeDays: 2, weight: { first: 85, last: 84.5, entries: 2 } }) });
    expect(biggestWin(away, 'building')).toBeNull();
  });

  it('nothing invented when there is no real win', () => {
    expect(biggestWin(weeklyFacts({ streak: { current: 1, longest: 1 }, thisWeek: week({ activeDays: 1 }) }), 'quiet')).toBeNull();
  });
});

describe('next week', () => {
  it('2–3 concrete targets from the person’s own numbers', () => {
    const g = nextWeekGoals(weeklyFacts({ goals: { dailyStepsTarget: 8000, dailyWaterMlTarget: null, targetWeightKg: null }, thisWeek: week({ activeDays: 4, meals: { count: 9, days: 4 }, steps: { total: 30000, daysWithData: 5, daysAtGoal: 2 } }) }))!;
    expect(g.items.map((i) => i.title)).toEqual(['Show up on 5 days', 'Hit 8,000 steps on 3 days', 'Log meals on 5 days']);
  });
});

describe('growth slot', () => {
  it('only relevant variants', () => {
    const inCircle = weeklyFacts({ circles: [{ id: 'c', name: 'Crew', memberCount: 3, activeMembersThisWeek: 2, yourActiveDays: 4, yourRank: 1, upcoming: false, inviteCode: null, joinedAt: null }] });
    expect(relevantGrowthVariants(inCircle)).not.toContain('create_circle');
    expect(relevantGrowthVariants(weeklyFacts())).toContain('create_circle');
    expect(relevantGrowthVariants(weeklyFacts({ fitzyUsed: true }))).not.toContain('try_fitzy');
    expect(relevantGrowthVariants(weeklyFacts({ fitzyUsed: false }))).toContain('try_fitzy');
    expect(relevantGrowthVariants(weeklyFacts({ photoMealsEver: 0 }))).toContain('try_photo');
    expect(relevantGrowthVariants(weeklyFacts({ referral: null }))).not.toContain('invite_friend');
  });

  it('campaigns: live or starting within 14 days, not joined', () => {
    const htl = { slug: 'hold_the_line', title: 'Hold the Line', tagline: null, startsAt: '2026-11-15', endsAt: '2026-12-15', joined: false };
    expect(relevantGrowthVariants(weeklyFacts({ campaigns: [htl] }))).toContain('join_campaign');
    expect(relevantGrowthVariants(weeklyFacts({ campaigns: [{ ...htl, joined: true }] }))).not.toContain('join_campaign');
    expect(relevantGrowthVariants(weeklyFacts({ campaigns: [{ ...htl, startsAt: '2026-12-20', endsAt: '2027-01-05' }] }))).not.toContain('join_campaign');
  });

  it('never shown three weeks in a row', () => {
    for (let i = 0; i < 30; i++) {
      const wk = isoWeekKey(addDays('2026-01-05', i * 7));
      expect(selectGrowthSlot(weeklyFacts({ weekKey: wk, recentGrowthSlots: ['try_fitzy', 'create_circle'] }), 'building')).toBeNull();
    }
  });

  it('never repeats last week’s variant', () => {
    for (let i = 0; i < 40; i++) {
      const wk = isoWeekKey(addDays('2026-01-05', i * 7));
      const v = selectGrowthSlot(weeklyFacts({ weekKey: wk, fitzyUsed: false, photoMealsEver: 0, recentGrowthSlots: ['create_circle', 'none'] }), 'building');
      expect(v).not.toBe('create_circle');
    }
  });

  it('skips roughly one week in three, deterministically per user + week', () => {
    let skipped = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const wk = isoWeekKey(addDays('2020-01-06', i * 7));
      const f = weeklyFacts({ weekKey: wk, recentGrowthSlots: ['none'] });
      const a = selectGrowthSlot(f, 'building');
      expect(selectGrowthSlot(f, 'building')).toBe(a);
      if (a === null) skipped++;
    }
    expect(skipped / N).toBeGreaterThan(0.22);
    expect(skipped / N).toBeLessThan(0.45);
  });

  it('nothing relevant → no slot', () => {
    const f = weeklyFacts({ referral: null, fitzyUsed: true, photoMealsEver: 5, circles: [{ id: 'c', name: 'Crew', memberCount: 3, activeMembersThisWeek: 2, yourActiveDays: 4, yourRank: 1, upcoming: false, inviteCode: null, joinedAt: null }] });
    expect(selectGrowthSlot(f, 'consistent')).toBeNull();
  });
});

describe('plan', () => {
  it('is deterministic per user + week and keyed by ISO week', () => {
    const a = plan();
    const b = plan();
    expect(a).toEqual(b);
    expect(a.periodKey).toBe('2026-W44');
    expect(a.messageKey).toBe('weekly_report');
    expect(a.variants.hero).toBe('building');
  });

  it('subject variants rotate across weeks and work without a first name', () => {
    const subjects = new Set<string>();
    for (let i = 0; i < 20; i++) subjects.add(plan(weeklyFacts({ weekKey: isoWeekKey(addDays('2026-01-05', i * 7)) })).email!.subject);
    expect(subjects.size).toBeGreaterThan(1);
    const anon = plan(weeklyFacts({ profile: { ...weeklyFacts().profile, firstName: '' } }));
    expect(anon.email!.subject).not.toMatch(/undefined|, $|^,/);
    expect(anon.email!.greeting).toBe('Hi there,');
  });

  it('push never carries health values (no weight, steps)', () => {
    const p = plan(weeklyFacts({ thisWeek: week({ activeDays: 4, meals: { count: 9, days: 4 }, weight: { first: 90, last: 89, entries: 2 }, steps: { total: 50000, daysWithData: 7, daysAtGoal: null } }) }));
    expect(p.push!.body).toBe('4 days active, 9 meals logged. Your full recap is in your inbox.');
  });

  it('records growth slot + week type in meta for rotation history', () => {
    const p = plan();
    expect(p.meta).toMatchObject({ week_type: 'building' });
    expect(typeof p.meta!.growth_slot).toBe('string');
    expect(p.variants.growth).toBe(p.meta!.growth_slot);
  });
});
