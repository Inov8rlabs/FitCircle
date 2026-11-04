/**
 * Onboarding / re-engagement step selection: conditions, goal-met stops,
 * once-per-period, cooldown, email spacing + weekly cap, send-hour window.
 */
import { describe, expect, it } from 'vitest';

import { LIFECYCLE_STEPS, selectLifecycleMessage } from '../messages/lifecycle';
import type { CircleFacts } from '../facts';

import { lifecycleFacts } from './fixtures';

const NOW = new Date('2026-10-31T15:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const solo: CircleFacts = { id: 'c1', name: 'Morning Crew', memberCount: 1, activeMembersThisWeek: 1, yourActiveDays: 2, yourRank: 1, upcoming: false, inviteCode: 'FITABC123', joinedAt: '2026-10-20T10:00:00Z' };
const full: CircleFacts = { ...solo, id: 'c2', memberCount: 4 };

const key = (d: ReturnType<typeof selectLifecycleMessage>) => (d && 'plan' in d ? d.plan.messageKey : d ? `skip:${d.skip}` : null);

describe('selectLifecycleMessage', () => {
  it('first meal: 20h+ old, nothing logged → email only (meal reminders already push)', () => {
    const d = selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 26 }), NOW);
    expect(key(d)).toBe('onboarding_first_meal');
    expect(d && 'plan' in d && d.plan.push).toBeUndefined();
    expect(d && 'plan' in d && d.plan.email!.subject).toBeTruthy();
  });

  it('first meal stops once the goal is met (a meal was logged)', () => {
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 26, mealsEver: 1 }), NOW))).toBeNull();
  });

  it('too early / too late for the first-meal step', () => {
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 10 }), NOW))).toBeNull();
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 120 }), NOW))).toBeNull();
  });

  it('first circle: logged a meal, no circle, day 2+ → email + push; stops when in a circle', () => {
    const d = selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 50, mealsEver: 2 }), NOW);
    expect(key(d)).toBe('onboarding_first_circle');
    expect(d && 'plan' in d && d.plan.push!.screen).toBe('circles');
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 50, mealsEver: 2, circles: [full] }), NOW))).toBeNull();
  });

  it('invite nudge: a circle with only the person in it (period = that circle)', () => {
    const d = selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 100, mealsEver: 3, circles: [solo] }), NOW);
    expect(key(d)).toBe('onboarding_invite_friend');
    expect(d && 'plan' in d && d.plan.periodKey).toBe('circle:c1');
    expect(JSON.stringify(d && 'plan' in d && d.plan.email)).toContain('fitcircle.ai/join/FITABC123');
  });

  it('once per period: a ledger row for the period (any status) moves on to the next step', () => {
    const f = lifecycleFacts({
      accountAgeHours: 100,
      mealsEver: 3,
      circles: [solo],
      recentSends: [{ messageKey: 'onboarding_invite_friend', periodKey: 'circle:c1', channel: 'email', status: 'holdout', at: hoursAgo(100) }],
    });
    expect(key(selectLifecycleMessage(f, NOW))).toBeNull();
  });

  it('streak milestone celebration (email only, once per streak run)', () => {
    const d = selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 400, mealsEver: 20, circles: [full], streak: { current: 7, lastEngagementDate: '2026-10-31' } }), NOW);
    expect(key(d)).toBe('celebrate_streak');
    expect(d && 'plan' in d && d.plan.periodKey).toBe('streak:7:2026-10-25');
    expect(d && 'plan' in d && d.plan.push).toBeUndefined();
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 400, mealsEver: 20, circles: [full], streak: { current: 8, lastEngagementDate: '2026-10-31' } }), NOW))).toBeNull();
  });

  it('comeback after 3–6 quiet days, once per lapse, at most every 14 days', () => {
    const base = { accountAgeHours: 900, mealsEver: 20, circles: [full], lastActiveDate: '2026-10-27' };
    expect(key(selectLifecycleMessage(lifecycleFacts(base), NOW))).toBe('reengage_comeback');
    expect(key(selectLifecycleMessage(lifecycleFacts({ ...base, lastActiveDate: '2026-10-30' }), NOW))).toBeNull();
    expect(key(selectLifecycleMessage(lifecycleFacts({ ...base, lastActiveDate: '2026-10-20' }), NOW))).toBeNull();
    const recent = lifecycleFacts({ ...base, recentSends: [{ messageKey: 'reengage_comeback', periodKey: 'lapse:2026-10-15', channel: 'email', status: 'sent', at: hoursAgo(24 * 10) }] });
    expect(key(selectLifecycleMessage(recent, NOW))).toBe('skip:cooldown');
  });

  it('email spacing: no two lifecycle emails within 44h', () => {
    const f = lifecycleFacts({ accountAgeHours: 50, mealsEver: 2, recentSends: [{ messageKey: 'onboarding_first_meal', periodKey: 'once', channel: 'email', status: 'sent', at: hoursAgo(20) }] });
    expect(key(selectLifecycleMessage(f, NOW))).toBe('skip:cooldown');
  });

  it('weekly cap: ≤ 3 engagement emails (incl. weekly report) per 7 days; welcome does not count', () => {
    const sends = [
      { messageKey: 'weekly_report', periodKey: '2026-W44', channel: 'email' as const, status: 'sent', at: hoursAgo(60) },
      { messageKey: 'onboarding_first_meal', periodKey: 'once', channel: 'email' as const, status: 'sent', at: hoursAgo(80) },
      { messageKey: 'celebrate_streak', periodKey: 'streak:7:x', channel: 'email' as const, status: 'sent', at: hoursAgo(130) },
      { messageKey: 'welcome', periodKey: 'once', channel: 'email' as const, status: 'sent', at: hoursAgo(10) },
    ];
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 60, mealsEver: 2, recentSends: sends }), NOW))).toBe('skip:cap');
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 60, mealsEver: 2, recentSends: sends.slice(1) }), NOW))).toBe('onboarding_first_circle');
  });

  it('only between 09:00 and 19:59 local', () => {
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 26, localHour: 7 }), NOW))).toBeNull();
    expect(key(selectLifecycleMessage(lifecycleFacts({ accountAgeHours: 26, localHour: 21 }), NOW))).toBeNull();
  });

  it('every step builds copy for named and anonymous people', () => {
    for (const step of LIFECYCLE_STEPS) {
      for (const firstName of ['Sam', '']) {
        const f = lifecycleFacts({ circles: [solo], streak: { current: 30, lastEngagementDate: '2026-10-31' }, profile: { ...lifecycleFacts().profile, firstName } });
        const b = step.build(f, 'p');
        if (step.channels.includes('email')) {
          expect(b.email!.subject).not.toMatch(/undefined|^,|, $/);
          expect(b.email!.blocks.some((x) => x.kind === 'cta')).toBe(true);
        }
        if (step.channels.includes('push')) expect(b.push!.title.length).toBeLessThanOrEqual(60);
      }
    }
  });
});
