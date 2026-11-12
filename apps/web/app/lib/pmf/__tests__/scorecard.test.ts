import { describe, expect, it } from 'vitest';

import type { RevenueEvent } from '../../ads/metrics';
import { KPI_BY_ID, KPI_DEFS } from '../catalog';
import { buildKpis, currentWindow, pmfScore, shift, statusOf, trendBuckets, type PmfFacts, type PmfUser } from '../scorecard';

const NOW = new Date('2026-11-12T17:00:00Z'); // 12:00 New York
const TODAY = '2026-11-12';
const H = 3_600_000;
const D = 24 * H;

function user(id: string, signupAt: string, over: Partial<PmfUser> = {}): PmfUser {
  return {
    userId: id,
    signupAt,
    signupDate: signupAt.slice(0, 10),
    timezone: 'America/New_York',
    platform: 'ios',
    channel: 'organic',
    onboardingCompleted: false,
    reachedPaywall: false,
    firstMealAt: null,
    events: [],
    virality: { invited: false, invitesSent: 0, invitesJoined: 0, friends: 0, sociallyActivated: false },
    ...over,
  };
}

function facts(users: PmfUser[], over: Partial<PmfFacts> = {}): PmfFacts {
  return {
    now: NOW,
    today: TODAY,
    timeZone: 'America/New_York',
    users,
    activity: new Map(),
    meals: new Map(),
    userPlatform: new Map(users.map((u) => [u.userId, u.platform])),
    spend: [],
    eventsByUser: new Map(),
    memberships: [],
    activitySince: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const kpi = (f: PmfFacts, id: string, period: 7 | 28 | 90 = 7) => buildKpis(f, period).find((k) => k.id === id)!;

describe('windows', () => {
  it('activity KPIs end yesterday; cohort KPIs end M+1 days ago; previous = shifted by P', () => {
    expect(currentWindow(TODAY, 7, null)).toEqual({ start: '2026-11-05', end: '2026-11-11' });
    expect(currentWindow(TODAY, 7, 7)).toEqual({ start: '2026-10-29', end: '2026-11-04' });
    expect(currentWindow(TODAY, 28, 1)).toEqual({ start: '2026-10-14', end: '2026-11-10' });
    expect(shift(currentWindow(TODAY, 7, 7), -7)).toEqual({ start: '2026-10-22', end: '2026-10-28' });
    const t = trendBuckets('2026-11-04');
    expect(t).toHaveLength(12);
    expect(t[11]).toEqual({ start: '2026-10-29', end: '2026-11-04' });
    expect(t[0].end).toBe('2026-08-19');
  });
});

describe('status', () => {
  const higher = { direction: 'higher' as const, target: 40, minimum: 25, best: 50, pmfThreshold: null, source: 'pmf_doc' as const, sourceLabel: '' };
  const def = { unit: 'percent' as const };
  it('uses target / minimum, else the 20% band', () => {
    expect(statusOf(def, higher, { value: 41, n: 50, numerator: 20 })).toBe('on_track');
    expect(statusOf(def, higher, { value: 30, n: 50, numerator: 15 })).toBe('at_risk');
    expect(statusOf(def, higher, { value: 20, n: 50, numerator: 10 })).toBe('off_track');
    const noMin = { ...higher, minimum: null };
    expect(statusOf(def, noMin, { value: 33, n: 50, numerator: 1 })).toBe('at_risk');
    expect(statusOf(def, noMin, { value: 31, n: 50, numerator: 1 })).toBe('off_track');
  });
  it('lower-is-better, too few, no data, money with no denominator, not measured', () => {
    const lower = { ...higher, direction: 'lower' as const, target: 25, minimum: null };
    expect(statusOf({ unit: 'usd' }, lower, { value: 20, n: 10, numerator: 200 })).toBe('on_track');
    expect(statusOf({ unit: 'usd' }, lower, { value: 30, n: 10, numerator: 300 })).toBe('at_risk');
    expect(statusOf({ unit: 'usd' }, lower, { value: 40, n: 10, numerator: 400 })).toBe('off_track');
    expect(statusOf({ unit: 'usd' }, lower, { value: null, n: 0, numerator: 120 })).toBe('off_track');
    expect(statusOf(def, higher, { value: 100, n: 3, numerator: 3 })).toBe('too_few');
    expect(statusOf(def, higher, { value: null, n: 0, numerator: null })).toBe('no_data');
    expect(statusOf({ unit: 'score', notMeasured: { reason: 'x', needed: 'y' } }, higher, { value: null, n: 0, numerator: null })).toBe('not_measured');
    expect(statusOf({ unit: 'count' }, null, { value: 9, n: 9, numerator: null })).toBe('no_target');
  });
});

describe('cohort KPIs', () => {
  // Signed up Nov 1 (in the D7 / activation window Oct 29 – Nov 4).
  const a = user('a', '2026-11-01T15:00:00Z', { firstMealAt: '2026-11-01T15:10:00Z', onboardingCompleted: true, platform: 'ios', channel: 'apple_ads' });
  const b = user('b', '2026-11-01T16:00:00Z', { firstMealAt: '2026-11-09T16:00:00Z', platform: 'android', channel: 'google_ads' });
  const c = user('c', '2026-11-02T16:00:00Z', { platform: 'android', channel: 'google_ads' });
  const activity = new Map([
    ['a', [Date.parse('2026-11-02T15:00:00Z'), Date.parse('2026-11-08T15:00:00Z')]],
    ['b', [Date.parse('2026-11-02T20:00:00Z')]],
  ]);

  it('D1 / D7 count activity on the local day after / 7th day after sign-up', () => {
    const f = facts([a, b, c], { activity });
    const d7 = kpi(f, 'd7_retention');
    expect(d7.current).toMatchObject({ n: 3, numerator: 1 });
    expect(d7.current.value).toBe(33.3);
    const d1 = kpi(f, 'd1_retention', 28);
    expect(d1.current).toMatchObject({ n: 3, numerator: 2, value: 66.7 });
    const platform = d1.segments.find((s) => s.dimension === 'platform')!;
    expect(platform.rows.find((r) => r.key === 'android')).toMatchObject({ n: 2, numerator: 1, value: 50 });
  });

  it('retention ignores sign-ups before the activity signal', () => {
    const f = facts([a, b, c], { activity, activitySince: '2026-11-05T00:00:00Z' });
    expect(kpi(f, 'd7_retention').current).toMatchObject({ n: 0, value: null });
    expect(kpi(f, 'd7_retention').status).toBe('no_data');
  });

  it('activation = first meal within 7 × 24 h; time to first meal = median hours of the activated', () => {
    const f = facts([a, b, c]);
    expect(kpi(f, 'activation_first_meal').current).toMatchObject({ n: 3, numerator: 1, value: 33.3 });
    expect(kpi(f, 'time_to_first_meal').current).toMatchObject({ n: 1, value: 0.17 });
  });

  it('virality, organic share and money KPIs', () => {
    const inviter = user('i', '2026-11-01T12:00:00Z', { virality: { invited: true, invitesSent: 2, invitesJoined: 1, friends: 1, sociallyActivated: true } });
    const f = facts([a, b, c, inviter], {
      spend: [
        { date: '2026-11-01', channel: 'apple_ads', spend: 30 },
        { date: '2026-11-02', channel: 'google_ads', spend: 50 },
        { date: '2026-10-01', channel: 'google_ads', spend: 999 },
      ],
    });
    expect(kpi(f, 'k_factor').current).toMatchObject({ n: 4, numerator: 1, value: 0.25 });
    expect(kpi(f, 'invite_rate').current.value).toBe(25);
    expect(kpi(f, 'invite_join_rate').current).toMatchObject({ n: 2, numerator: 1, value: 50 });
    expect(kpi(f, 'social_activation').current.value).toBe(25);
    // Cost per activated: $80 of spend ÷ 1 activated paid user (a); b activated after 7 days.
    const cpa = kpi(f, 'cost_per_activated');
    expect(cpa.current).toMatchObject({ value: 80, n: 1, numerator: 80 });
    expect(cpa.status).toBe('too_few');
    const byChannel = cpa.segments.find((s) => s.dimension === 'channel')!.rows;
    expect(byChannel.find((r) => r.key === 'google_ads')).toMatchObject({ value: null, numerator: 50, n: 0 });
    expect(cpa.segments.some((s) => s.dimension === 'platform')).toBe(false);
  });

  it('organic share counts organic + invite over all sign-ups (window ends yesterday)', () => {
    const f = facts([
      user('o1', '2026-11-10T15:00:00Z', { channel: 'organic' }),
      user('o2', '2026-11-10T15:00:00Z', { channel: 'invite' }),
      user('p1', '2026-11-11T15:00:00Z', { channel: 'apple_ads' }),
      user('p2', '2026-11-12T15:00:00Z', { channel: 'apple_ads' }),
    ]);
    const k = kpi(f, 'organic_share');
    expect(k.current).toMatchObject({ n: 3, numerator: 2, value: 66.7 });
    expect(k.segments.map((s) => s.dimension)).toEqual(['platform']);
  });
});

describe('activity KPIs', () => {
  const at = (d: string) => Date.parse(`${d}T16:00:00Z`);
  it('DAU average, MAU, stickiness and meal-logging days', () => {
    const activity = new Map([
      ['x', ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].map(at)],
      ['y', ['2026-11-11'].map(at)],
      ['z', ['2026-10-20'].map(at)],
    ]);
    const meals = new Map([['x', ['2026-11-05', '2026-11-06', '2026-11-06'].map(at)]]);
    const f = facts([], { activity, meals, userPlatform: new Map([['x', 'ios'], ['y', 'android'], ['z', 'ios']]) });
    expect(kpi(f, 'dau').current).toMatchObject({ value: 1.1, n: 2 });
    expect(kpi(f, 'mau').current).toMatchObject({ value: 3, n: 3 });
    const st = kpi(f, 'stickiness');
    // Six days at 1/2 (x of x,z), Nov 11 at 2/3.
    expect(st.current.value).toBe(Math.round(((6 * 0.5 + 2 / 3) / 7) * 1000) / 10);
    expect(kpi(f, 'meal_logging_frequency').current).toMatchObject({ value: 2, n: 1 });
    expect(kpi(f, 'dau').segments[0].rows.find((r) => r.key === 'android')).toMatchObject({ value: 0.1, n: 1 });
  });

  it('north star counts actives sharing a private circle with another active real user', () => {
    const activity = new Map([
      ['x', [at('2026-11-06')]],
      ['y', [at('2026-11-07')]],
      ['z', [at('2026-11-07')]],
    ]);
    const memberships = [
      { userId: 'x', circleId: 'c1', start: 0, end: Infinity },
      { userId: 'y', circleId: 'c1', start: 0, end: Infinity },
      { userId: 'z', circleId: 'c2', start: 0, end: Infinity },
    ];
    const f = facts([], { activity, memberships });
    expect(kpi(f, 'buddy_wau').current.value).toBe(2);
  });
});

describe('subscriptions', () => {
  const ev = (over: Partial<RevenueEvent> & { raw: Record<string, unknown> }): RevenueEvent =>
    ({ id: `e${Math.random()}`, user_id: 'p', type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: '2026-11-06T12:00:00Z', ...over }) as RevenueEvent;

  it('trial → paid counts ended trials started in the window', () => {
    const trialStart = Date.parse('2026-11-06T12:00:00Z');
    const events = [
      ev({ raw: { period_type: 'TRIAL', price: 0, expiration_at_ms: trialStart + 3 * D, transaction_id: 't1', original_transaction_id: 'o1', product_id: 'monthly' } }),
      ev({ type: 'RENEWAL', event_timestamp: '2026-11-09T12:00:00Z', raw: { period_type: 'NORMAL', price: 9.99, expiration_at_ms: trialStart + 33 * D, transaction_id: 't2', original_transaction_id: 'o1', product_id: 'monthly', takehome_percentage: 0.85 } }),
    ];
    const f = facts([], { eventsByUser: new Map([['p', events]]) });
    const k = kpi(f, 'trial_to_paid');
    expect(k.current).toMatchObject({ n: 1, numerator: 1, value: 100 });
    expect(k.status).toBe('too_few');
    expect(kpi(f, 'subscriber_churn').current).toMatchObject({ value: null, n: 0 });
  });
});

describe('catalog and PMF score', () => {
  it('every KPI has a definition, and a threshold source when it has a threshold', () => {
    for (const d of KPI_DEFS) {
      expect(d.definition.length).toBeGreaterThan(20);
      if (d.threshold) expect(d.threshold.sourceLabel).toBeTruthy();
    }
    expect(KPI_BY_ID.get('d7_retention')!.threshold).toMatchObject({ target: 25, minimum: 15, best: 35 });
    expect(KPI_BY_ID.get('nps')!.notMeasured).toBeTruthy();
  });

  it('is null while NPS is not measured, and lists the measured components', () => {
    const kpis = buildKpis(facts([]), 28);
    const s = pmfScore(kpis);
    expect(s.value).toBeNull();
    expect(s.missing).toContain('Satisfaction');
    expect(s.components.map((c) => c.weight).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('computes the doc formula when every input exists', () => {
    const fake = (id: string, value: number) => ({ id, current: { value } }) as any;
    const s = pmfScore([fake('d30_retention', 15), fake('stickiness', 25), fake('k_factor', 0.5), fake('nps', 0), fake('ltv_cac', 2)]);
    // 0.3×60 + 0.25×50 + 0.2×50 + 0.15×50 + 0.1×40 = 52
    expect(s.value).toBe(52);
    expect(s.band).toMatch(/Weak PMF/);
  });
});
