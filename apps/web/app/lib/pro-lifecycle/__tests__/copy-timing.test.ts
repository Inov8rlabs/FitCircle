import { describe, expect, it } from 'vitest';

import { parseClientActions } from '../../promos/actions';
import { promoPropsSchema , buildPromoProps } from '../../promos/creative';
import { lifecycleCreative, localWallTime } from '../card';
import { DEFAULT_CONFIG, configVersion, diffConfigs, validateConfig } from '../config';
import { endedPhrase, endsPhrase, fill, periodPhrase, renderCardCopy, renderPushCopy, usagePhrase, type RenderInput } from '../copy';
import { personaLifecycle } from '../persona';
import { decideExpiredPush, decideExpiringPush, expiringPushAt, lifecyclePushDedupeKey } from '../timing';
import type { LifecycleResult } from '../types';

const SHIPPED_ACTIONS = parseClientActions('open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1');

describe('relative day phrases (user time zone)', () => {
  // Asael: Pro ends 2026-11-09 19:17 UTC = 1:17 PM CST.
  const end = new Date('2026-11-09T19:17:45Z');
  it('Chicago: Saturday → "on Monday", Sunday 10 AM → "tomorrow", Monday → "today"', () => {
    expect(endsPhrase(end, new Date('2026-11-07T19:30:00Z'), 'America/Chicago')).toBe('on Monday');
    expect(endsPhrase(end, new Date('2026-11-08T16:00:00Z'), 'America/Chicago')).toBe('tomorrow');
    expect(endsPhrase(end, new Date('2026-11-09T14:00:00Z'), 'America/Chicago')).toBe('today');
  });
  it('time zone boundary: 05:30 UTC on the 9th is still the 8th in Chicago', () => {
    const lateEnd = new Date('2026-11-09T05:30:00Z');
    expect(endsPhrase(lateEnd, new Date('2026-11-07T18:00:00Z'), 'America/Chicago')).toBe('tomorrow');
    expect(endsPhrase(lateEnd, new Date('2026-11-07T18:00:00Z'), 'UTC')).toBe('on Monday');
  });
  it('ended phrases', () => {
    expect(endedPhrase(end, new Date('2026-11-09T20:00:00Z'), 'America/Chicago')).toBe('today');
    expect(endedPhrase(end, new Date('2026-11-10T15:00:00Z'), 'America/Chicago')).toBe('yesterday');
    expect(endedPhrase(end, new Date('2026-11-12T15:00:00Z'), 'America/Chicago')).toBe('on Monday');
  });
  it('period: a 7-day referral week vs longer / store trial', () => {
    expect(periodPhrase('referral', 7)).toBe('free Pro week');
    expect(periodPhrase('referral', 14)).toBe('free Pro');
    expect(periodPhrase('complimentary', null)).toBe('free Pro');
    expect(periodPhrase('store_trial', 3)).toBe('Pro trial');
  });
});

describe('usage line — only real, meaningful numbers', () => {
  it('nothing meaningful → null (value-prop body)', () => {
    expect(usagePhrase(null)).toBeNull();
    expect(usagePhrase({ aiMeals: 1, meals: 2, fitzyChats: 1, plans: 0 })).toBeNull();
  });
  it('AI meals first, then plans or chats', () => {
    expect(usagePhrase({ aiMeals: 5, meals: 6, fitzyChats: 0, plans: 0 })).toBe('5 meals analyzed by AI');
    expect(usagePhrase({ aiMeals: 0, meals: 4, fitzyChats: 3, plans: 0 })).toBe('4 meals logged and 3 chats with Fitzy');
    expect(usagePhrase({ aiMeals: 2, meals: 2, fitzyChats: 9, plans: 1 })).toBe('2 meals analyzed by AI and 1 weekly plan from Fitzy');
  });
});

const input = (over: Partial<RenderInput> = {}): RenderInput => ({
  state: 'pro_expiring',
  now: new Date('2026-11-08T16:00:00Z'),
  timezone: 'America/Chicago',
  endsAt: new Date('2026-11-09T19:17:45Z'),
  source: 'referral',
  periodDays: 7,
  trialAvailable: true,
  usage: null,
  firstName: 'Asael',
  ...over,
});

describe('card + push copy', () => {
  it('default expiring copy: trial / no trial / usage variants', () => {
    const a = renderCardCopy(DEFAULT_CONFIG.states.pro_expiring.copy, input());
    expect(a).toEqual({ copy: expect.objectContaining({ title: 'Your free Pro week ends tomorrow', cta: 'Start 3-day free trial', usedUsage: false }) });
    const b = renderCardCopy(DEFAULT_CONFIG.states.pro_expiring.copy, input({ trialAvailable: false, usage: { aiMeals: 5, meals: 6, fitzyChats: 0, plans: 0 } }));
    expect(b).toEqual({ copy: expect.objectContaining({ cta: 'Keep Pro', body: 'So far with Pro: 5 meals analyzed by AI. Keep the momentum going.', usedUsage: true }) });
  });
  it('no-trial copy never promises "free"', () => {
    for (const state of ['pro_expiring', 'pro_expired'] as const) {
      const c = renderCardCopy(DEFAULT_CONFIG.states[state].copy, input({ state, trialAvailable: false, endsAt: new Date('2026-11-07T19:17:45Z') }));
      expect('copy' in c && c.copy.cta).not.toMatch(/free/i);
      const p = renderPushCopy(DEFAULT_CONFIG.states[state].push, input({ state, trialAvailable: false }));
      expect('body' in p && p.body).not.toMatch(/free trial/i);
    }
  });
  it('a usage body too long once filled falls back to the value-prop body', () => {
    const copy = { ...DEFAULT_CONFIG.states.pro_expired.copy, usageBody: `${'x'.repeat(100)} {{usage}}` };
    const out = renderCardCopy(copy, input({ state: 'pro_expired', usage: { aiMeals: 12, meals: 12, fitzyChats: 4, plans: 0 } }));
    expect(out).toEqual({ copy: expect.objectContaining({ usedUsage: false, body: DEFAULT_CONFIG.states.pro_expired.copy.body }) });
  });
  it('rejects a title that overflows once filled, and unknown placeholders', () => {
    expect(renderCardCopy({ ...DEFAULT_CONFIG.states.pro_expiring.copy, title: 'Hey {{first_name}}, your {{period}} ends {{ends}} for real' }, input())).toEqual({ error: expect.stringMatching(/title is \d+ characters/) });
    expect(fill('Hi {{nope}}', {})).toBeNull();
    expect(fill('Hi {{ first_name }}', { first_name: 'Ana' })).toBe('Hi Ana');
  });
});

describe('config validation + versioning', () => {
  it('defaults validate; trial push cannot be turned on; usageBody needs {{usage}}', () => {
    expect(validateConfig(DEFAULT_CONFIG).issues).toEqual([]);
    const bad = structuredClone(DEFAULT_CONFIG);
    bad.states.trial_expiring.push.enabled = true;
    bad.states.pro_expired.copy.usageBody = 'No placeholder';
    bad.states.pro_expiring.hoursBefore = 500;
    const paths = validateConfig(bad).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['states.trial_expiring.push.enabled', 'states.pro_expired.copy.usageBody', 'states.pro_expiring.hoursBefore']));
  });
  it('version is content-addressed (switch + config); diff lists changed paths', () => {
    const next = structuredClone(DEFAULT_CONFIG);
    next.states.pro_expired.snoozeDays = 5;
    expect(configVersion(true, DEFAULT_CONFIG)).toBe(configVersion(true, structuredClone(DEFAULT_CONFIG)));
    expect(configVersion(false, DEFAULT_CONFIG)).not.toBe(configVersion(true, DEFAULT_CONFIG));
    expect(diffConfigs(DEFAULT_CONFIG, next)).toEqual([{ path: 'states.pro_expired.snoozeDays', before: 3, after: 5 }]);
  });
});

describe('push timing', () => {
  // The three referral users today (Nov 2026; CST = UTC−6, EST = UTC−5).
  it('10:00 local the day before', () => {
    expect(expiringPushAt(new Date('2026-11-09T19:17:45Z'), 'America/Chicago').toISOString()).toBe('2026-11-08T16:00:00.000Z');
    expect(expiringPushAt(new Date('2026-11-10T12:41:57Z'), 'America/Toronto').toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });
  it('an early-morning end (< 14 h after 10:00) moves to 10:00 two days before', () => {
    // Ends 11:30 PM Mon (Chicago): 10:00 Mon is only 13.5 h before, so the reminder goes 10:00 Sun.
    expect(expiringPushAt(new Date('2026-11-10T05:30:00Z'), 'America/Chicago').toISOString()).toBe('2026-11-08T16:00:00.000Z');
  });
  it('before → not_yet; after → send; late grant → send now; < 1 h left → too_late; quiet hours defer', () => {
    const endsAt = new Date('2026-11-09T19:17:45Z');
    expect(decideExpiringPush({ now: new Date('2026-11-08T15:00:00Z'), endsAt, timezone: 'America/Chicago', inQuietHours: false })).toMatchObject({ send: false, skip: 'not_yet' });
    expect(decideExpiringPush({ now: new Date('2026-11-08T16:25:00Z'), endsAt, timezone: 'America/Chicago', inQuietHours: false })).toMatchObject({ send: true });
    expect(decideExpiringPush({ now: new Date('2026-11-09T12:00:00Z'), endsAt, timezone: 'America/Chicago', inQuietHours: false })).toMatchObject({ send: true });
    expect(decideExpiringPush({ now: new Date('2026-11-09T18:30:00Z'), endsAt, timezone: 'America/Chicago', inQuietHours: false })).toMatchObject({ send: false, skip: 'too_late' });
    expect(decideExpiringPush({ now: new Date('2026-11-09T04:25:00Z'), endsAt, timezone: 'America/Chicago', inQuietHours: true })).toMatchObject({ send: false, skip: 'quiet_hours' });
  });
  it('expired: right away, quiet hours defer, given up after 36 h', () => {
    const endedAt = new Date('2026-11-09T19:17:45Z');
    expect(decideExpiredPush({ now: new Date('2026-11-09T19:20:00Z'), endedAt, inQuietHours: false })).toMatchObject({ send: true });
    expect(decideExpiredPush({ now: new Date('2026-11-10T04:20:00Z'), endedAt, inQuietHours: true })).toMatchObject({ send: false, skip: 'quiet_hours' });
    expect(decideExpiredPush({ now: new Date('2026-11-11T08:00:00Z'), endedAt, inQuietHours: false })).toMatchObject({ send: false, skip: 'too_late' });
  });
  it('dedupe key changes when the end moves (renewed referral = new reminder)', () => {
    expect(lifecyclePushDedupeKey('pro_expiring_reminder', 'u', '2026-11-09T19:17:45.000Z')).not.toBe(lifecyclePushDedupeKey('pro_expiring_reminder', 'u', '2026-11-16T19:17:45.000Z'));
  });
});

describe('card props (promo@1 wire)', () => {
  const result = (over: Partial<LifecycleResult> = {}): LifecycleResult => ({
    state: 'pro_expiring',
    reason: null,
    endsAt: '2026-11-09T19:17:45.000Z',
    startedAt: '2026-11-02T19:17:45.000Z',
    source: 'referral',
    trialAvailable: true,
    periodDays: 7,
    ...over,
  });
  it('expiring hero: hourglass + legacy glyph, local countdown, paywall pro_expiring_card; validates', () => {
    const built = lifecycleCreative('pro_expiring', DEFAULT_CONFIG, { result: result(), usage: null, firstName: 'Asael', timezone: 'America/Chicago' }, new Date('2026-11-08T16:00:00Z'));
    if ('error' in built) throw new Error(built.error);
    const props = buildPromoProps('pro_expiring', built.creative, SHIPPED_ACTIONS)!;
    expect(props).toMatchObject({
      promoId: 'pro_expiring',
      layout: 'hero',
      icon: 'hourglass',
      emoji: '⏳',
      title: 'Your free Pro week ends tomorrow',
      countdown: { endsAt: '2026-11-09T13:17:45', label: 'Pro ends in' },
      primary: { label: 'Start 3-day free trial', action: { type: 'paywall', params: { placement: 'pro_expiring_card' } } },
      dismissible: true,
    });
    expect(promoPropsSchema.safeParse(props).success).toBe(true);
  });
  it('expired: crown, no countdown, pro_expired_card; every layout validates', () => {
    for (const layout of ['hero', 'banner', 'compact'] as const) {
      const cfg = structuredClone(DEFAULT_CONFIG);
      cfg.states.pro_expired.layout = layout;
      const built = lifecycleCreative('pro_expired', cfg, { result: result({ state: 'pro_expired', endsAt: '2026-11-07T19:17:45.000Z' }), usage: null, firstName: null, timezone: 'UTC' }, new Date('2026-11-08T16:00:00Z'));
      if ('error' in built) throw new Error(built.error);
      const props = buildPromoProps('pro_expired', built.creative, SHIPPED_ACTIONS)!;
      expect(props).toMatchObject({ layout, icon: 'crown', primary: { action: { params: { placement: 'pro_expired_card' } } } });
      expect(props.countdown).toBeUndefined();
    }
  });
  it('a client without paywall@1 gets no card (primary unresolvable)', () => {
    const built = lifecycleCreative('pro_expired', DEFAULT_CONFIG, { result: result({ state: 'pro_expired' }), usage: null, firstName: null, timezone: 'UTC' }, new Date('2026-11-10T16:00:00Z'));
    if ('error' in built) throw new Error(built.error);
    expect(buildPromoProps('pro_expired', built.creative, parseClientActions('open_screen@1,dismiss@1'))).toBeNull();
  });
  it('localWallTime across DST (Nov 1 2026 US) and a half-hour zone', () => {
    expect(localWallTime(new Date('2026-10-31T19:00:00Z'), 'America/Chicago')).toBe('2026-10-31T14:00:00');
    expect(localWallTime(new Date('2026-11-02T19:00:00Z'), 'America/Chicago')).toBe('2026-11-02T13:00:00');
    expect(localWallTime(new Date('2026-11-02T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-03T00:30:00');
  });
  it('personas land inside their windows and render', () => {
    for (const state of ['pro_expiring', 'pro_expired', 'trial_expiring'] as const) {
      const p = personaLifecycle(state, new Date('2026-11-08T16:00:00Z'), 'America/Los_Angeles', DEFAULT_CONFIG);
      expect(p.input.result.state).toBe(state);
    }
  });
});

describe('one CTA treatment for every lifecycle card', () => {
  it('all states × trial/no-trial: hero, light foreground, no accent → the same white pill on iOS and Android', () => {
    const now = new Date('2026-11-08T16:00:00Z');
    for (const state of ['pro_expiring', 'pro_expired', 'trial_expiring'] as const) {
      for (const trialAvailable of [true, false]) {
        const p = personaLifecycle(state, now, 'America/Chicago', DEFAULT_CONFIG, { trialAvailable, usage: 'none' });
        const built = lifecycleCreative(state, DEFAULT_CONFIG, p.input, now);
        if ('error' in built) throw new Error(built.error);
        const props = buildPromoProps(state, built.creative, SHIPPED_ACTIONS)!;
        expect(props.layout).toBe('hero');
        expect(props.theme.foreground).toBe('light');
        expect(props.theme.accent).toBeUndefined();
        expect(props.secondary).toBeUndefined();
      }
    }
  });
});
