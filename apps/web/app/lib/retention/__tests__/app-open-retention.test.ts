import { describe, expect, it } from 'vitest';

import { buildRetention, userPlatform, userRetention, userSource, type OpenRow, type RetentionUser } from '../app-open-retention';

const CHI = 'America/Chicago';
const SINCE = '2026-11-01T00:00:00Z';
const u = (id: string, signupAt: string, platform: any = 'ios', source = 'organic'): RetentionUser => ({ userId: id, signupAt, timezone: CHI, platform, source });
const open = (user_id: string, local_date: string, platform = 'ios'): OpenRow => ({ user_id, local_date, platform });

describe('userRetention', () => {
  const signup = '2026-11-02T23:30:00Z'; // 17:30 Chicago Nov 2 → D1 = Nov 3, D7 = Nov 9
  it('D1 = an open on the next LOCAL day (any platform); null until that day has passed', () => {
    expect(userRetention(u('a', signup), [open('a', '2026-11-03', 'android')], new Date('2026-11-03T20:00:00Z'), SINCE)).toEqual({ d1: null, d7: null });
    expect(userRetention(u('a', signup), [open('a', '2026-11-03', 'android')], new Date('2026-11-04T07:00:00Z'), SINCE)).toEqual({ d1: true, d7: null });
    expect(userRetention(u('a', signup), [open('a', '2026-11-02')], new Date('2026-11-04T07:00:00Z'), SINCE).d1).toBe(false);
  });
  it('D7 on the 7th local day', () => {
    expect(userRetention(u('a', signup), [open('a', '2026-11-09')], new Date('2026-11-10T07:00:00Z'), SINCE)).toEqual({ d1: false, d7: true });
  });
  it('sign-ups before the signal existed are never counted as churn', () => {
    expect(userRetention(u('a', '2026-10-30T12:00:00Z'), [], new Date('2026-11-20T00:00:00Z'), SINCE)).toEqual({ d1: null, d7: null });
    expect(userRetention(u('a', signup), [], new Date('2026-11-20T00:00:00Z'), null)).toEqual({ d1: null, d7: null });
  });
});

describe('buildRetention', () => {
  it('totals and by platform / source / platform × source', () => {
    const users = [u('a', '2026-11-02T15:00:00Z', 'ios', 'apple_ads'), u('b', '2026-11-02T15:00:00Z', 'android', 'google_ads'), u('c', '2026-11-02T15:00:00Z', 'android', 'google_ads')];
    const opens = new Map([
      ['a', [open('a', '2026-11-03')]],
      ['b', [open('b', '2026-11-03', 'android')]],
    ]);
    const r = buildRetention(users, opens, new Date('2026-11-05T00:00:00Z'), SINCE);
    expect(r.totals).toMatchObject({ signups: 3, d1Eligible: 3, d1Retained: 2, d1Rate: 0.667, d7Eligible: 0, d7Rate: null });
    expect(r.byPlatform.find((p) => p.platform === 'android')).toMatchObject({ signups: 2, d1Retained: 1, d1Rate: 0.5 });
    expect(r.bySource.find((s) => s.source === 'apple_ads')).toMatchObject({ d1Rate: 1 });
    expect(r.byPlatformSource).toHaveLength(2);
    expect(r.signalSince).toBe(SINCE);
  });
});

describe('userPlatform / userSource', () => {
  it('first recorded open wins; else the fallback', () => {
    expect(userPlatform([{ ...open('a', '2026-11-03', 'android'), first_open_at: '2026-11-03T10:00:00Z' }, { ...open('a', '2026-11-02', 'ios'), first_open_at: '2026-11-02T10:00:00Z' }], null)).toBe('ios');
    expect(userPlatform([open('a', '2026-11-02', 'unknown')], 'android')).toBe('android');
    expect(userPlatform([], 'blackberry')).toBe('unknown');
  });
  it('invitees are "invite" whatever the attribution says', () => {
    expect(userSource(true, 'google_ads')).toBe('invite');
    expect(userSource(false, 'apple_ads')).toBe('apple_ads');
    expect(userSource(false, null)).toBe('unknown');
  });
});
