import { describe, expect, it } from 'vitest';

import type { InAppView } from '../../types';
import { capsAllow, filterMatches, routeForScreen, screenForPath, triggerMatches } from '../runtime';

const caps = { inAppPer24h: 2, inAppPerSession: 1 };
const msg = { messageId: 'm1', maxImpressions: 2, minHoursBetween: 24, impressionsSoFar: 0, lastShownAt: null, respectGlobalCap: true } as const;
const now = Date.parse('2026-10-16T12:00:00Z');

describe('capsAllow', () => {
  it('respects session + 24h global caps', () => {
    expect(capsAllow(msg, {}, 0, caps, now)).toBe(true);
    expect(capsAllow(msg, {}, 1, caps, now)).toBe(false);
    const two = { a: ['2026-10-16T08:00:00Z'], b: ['2026-10-16T09:00:00Z'] };
    expect(capsAllow(msg, two, 0, caps, now)).toBe(false);
    expect(capsAllow({ ...msg, respectGlobalCap: false }, two, 5, caps, now)).toBe(true);
  });
  it('respects max impressions and min hours between', () => {
    expect(capsAllow({ ...msg, impressionsSoFar: 2 }, {}, 0, caps, now)).toBe(false);
    expect(capsAllow(msg, { m1: ['2026-10-16T01:00:00Z'] }, 0, { inAppPer24h: 9, inAppPerSession: 9 }, now)).toBe(false);
    expect(capsAllow(msg, { m1: ['2026-10-14T01:00:00Z'] }, 0, caps, now)).toBe(true);
  });
});

describe('triggers', () => {
  const m = { trigger: { event: 'check_in_completed', filters: [{ key: 'streak', op: 'gte', value: 7 }], delaySeconds: 0 } } as Pick<InAppView, 'trigger'>;
  it('matches event + prop filters', () => {
    expect(triggerMatches(m, { name: 'check_in_completed', props: { streak: 7 } })).toBe(true);
    expect(triggerMatches(m, { name: 'check_in_completed', props: { streak: 3 } })).toBe(false);
    expect(triggerMatches(m, { name: 'app_open', props: {} })).toBe(false);
  });
  it('filter ops', () => {
    expect(filterMatches({ key: 's', op: 'in', value: ['home', 'circles'] }, { s: 'circles' })).toBe(true);
    expect(filterMatches({ key: 's', op: 'neq', value: 'home' }, { s: 'home' })).toBe(false);
  });
});

describe('routes', () => {
  it('maps paths and screens', () => {
    expect(screenForPath('/dashboard')).toBe('home');
    expect(screenForPath('/fitcircles/abc')).toBe('circles');
    expect(screenForPath('/nope')).toBeNull();
    expect(routeForScreen('invite_hub')).toBe('/invite');
    expect(routeForScreen('unknown')).toBe('/dashboard');
  });
});
