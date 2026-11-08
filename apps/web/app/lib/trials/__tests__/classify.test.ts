import { describe, expect, it } from 'vitest';

import {
  bestCountry,
  classifyTrialStatus,
  countTrials,
  isPaidCharge,
  isTrialStartEvent,
  parseTrialsQuery,
  planOf,
  rangeStart,
  resolveTrial,
  testFlags,
  visible,
  type SubEventRow,
  type TrialProfileRow,
} from '../classify';

const NOW = new Date('2026-11-08T12:00:00Z');
const ms = (iso: string) => Date.parse(iso);

const profile = (p: Partial<TrialProfileRow> = {}): TrialProfileRow => ({
  id: 'u1',
  email: 'real@yahoo.com',
  email_canonical: 'real@yahoo.com',
  display_name: 'Real',
  username: 'real',
  created_at: '2026-11-07T15:00:00Z',
  is_admin: false,
  metadata: {},
  country_code: null,
  subscription_tier: 'premium',
  subscription_status: 'trialing',
  subscription_platform: 'app_store',
  subscription_product_id: 'com.inov8rlabs.fitcircle.pro.monthly',
  subscription_expires_at: '2026-11-10T15:54:39Z',
  subscription_will_renew: true,
  trial_started_at: '2026-11-07T15:54:39Z',
  trial_ends_at: '2026-11-10T15:54:39Z',
  trial_converted_at: null,
  ...p,
});

const ev = (e: Partial<SubEventRow> & { raw?: Record<string, any> }): SubEventRow => ({
  id: e.id ?? `e-${Math.random()}`,
  user_id: 'u1',
  type: e.type ?? 'INITIAL_PURCHASE',
  store: e.store ?? 'APP_STORE',
  environment: e.environment ?? 'PRODUCTION',
  event_timestamp: e.event_timestamp ?? '2026-11-07T15:54:47Z',
  raw: {
    period_type: 'TRIAL',
    price: 0,
    product_id: 'com.inov8rlabs.fitcircle.pro.monthly',
    purchased_at_ms: ms('2026-11-07T15:54:39Z'),
    expiration_at_ms: ms('2026-11-10T15:54:39Z'),
    country_code: 'US',
    store: e.store ?? 'APP_STORE',
    ...(e.raw ?? {}),
  },
});

describe('trial detection', () => {
  it('a TRIAL INITIAL_PURCHASE from a real store is a trial start', () => {
    expect(isTrialStartEvent(ev({}))).toBe(true);
    expect(isTrialStartEvent(ev({ store: 'PLAY_STORE' }))).toBe(true);
    expect(isTrialStartEvent(ev({ store: 'STRIPE' }))).toBe(true);
  });
  it('NORMAL purchases, promotional store, renewals and Stripe-native copies are not', () => {
    expect(isTrialStartEvent(ev({ raw: { period_type: 'NORMAL', price: 9.99 } }))).toBe(false);
    expect(isTrialStartEvent(ev({ store: 'PROMOTIONAL' }))).toBe(false);
    expect(isTrialStartEvent(ev({ type: 'RENEWAL' }))).toBe(false);
    expect(isTrialStartEvent(ev({ id: 'stripe:evt_1', store: 'STRIPE' }))).toBe(false);
  });
  it('promotional grants are never trials, even with trial dates set', () => {
    expect(resolveTrial(profile({ subscription_platform: 'promotional', subscription_product_id: 'complimentary' }), [], NOW)).toBeNull();
  });
  it('a profile with no trial and no trial event is not a trial', () => {
    expect(resolveTrial(profile({ trial_started_at: null, trial_ends_at: null }), [ev({ raw: { period_type: 'NORMAL', price: 9.99 } })], NOW)).toBeNull();
  });
  it('profile-only trials (webhook gap) have environment unknown', () => {
    const t = resolveTrial(profile(), [], NOW)!;
    expect(t.environment).toBe('unknown');
    expect(t.platform).toBe('app_store');
    expect(t.status).toBe('trialing');
  });
  it('takes platform, environment and product from the trial event', () => {
    const t = resolveTrial(
      profile({ subscription_platform: 'promotional' }),
      [ev({ store: 'PLAY_STORE', environment: 'SANDBOX', raw: { product_id: 'com.inov8rlabs.fitcircle.pro.annual:annual' } })],
      NOW
    )!;
    expect(t.platform).toBe('play_store');
    expect(t.environment).toBe('sandbox');
    expect(t.productId).toBe('com.inov8rlabs.fitcircle.pro.annual:annual');
  });
});

describe('status', () => {
  const base = {
    convertedAt: null,
    trialEndsAt: '2026-11-10T15:54:39Z',
    subscriptionStatus: 'trialing',
    subscriptionPlatform: 'app_store',
    trialPlatform: 'app_store' as const,
    willRenew: true,
    expiresAt: '2026-11-10T15:54:39Z',
    events: [] as SubEventRow[],
    now: NOW,
  };
  it('trialing inside the window with auto-renew on', () => {
    expect(classifyTrialStatus(base)).toBe('trialing');
  });
  it('cancelled inside the window when auto-renew is off', () => {
    expect(classifyTrialStatus({ ...base, willRenew: false })).toBe('cancelled');
    expect(classifyTrialStatus({ ...base, events: [ev({ type: 'CANCELLATION' })] })).toBe('cancelled');
  });
  it('an UNCANCELLATION after a CANCELLATION puts it back to trialing', () => {
    expect(classifyTrialStatus({ ...base, events: [ev({ type: 'CANCELLATION' }), ev({ type: 'UNCANCELLATION' })] })).toBe('trialing');
  });
  it('converted when a conversion is on record', () => {
    expect(classifyTrialStatus({ ...base, convertedAt: '2026-11-10T16:00:00Z' })).toBe('converted');
  });
  it('expired after the window without a charge', () => {
    expect(classifyTrialStatus({ ...base, now: new Date('2026-11-12T00:00:00Z'), subscriptionStatus: 'cancelled', willRenew: false })).toBe('expired');
  });
  it('after the window, still paid on the same store (missed webhook) counts as converted', () => {
    expect(
      classifyTrialStatus({ ...base, now: new Date('2026-11-12T00:00:00Z'), subscriptionStatus: 'active', expiresAt: '2026-12-10T15:54:39Z' })
    ).toBe('converted');
  });
  it('a first paid RENEWAL converts the trial', () => {
    const renewal = ev({ type: 'RENEWAL', event_timestamp: '2026-11-10T15:55:00Z', raw: { period_type: 'NORMAL', price: 9.99 } });
    expect(isPaidCharge(renewal)).toBe(true);
    const t = resolveTrial(profile({ subscription_status: 'active' }), [ev({}), renewal], new Date('2026-11-11T00:00:00Z'))!;
    expect(t.status).toBe('converted');
    expect(t.convertedAt).toBe('2026-11-10T15:55:00.000Z');
  });
  it('sandbox renewals never convert a production trial', () => {
    const sandboxRenewal = ev({ type: 'RENEWAL', environment: 'SANDBOX', event_timestamp: '2026-11-07T16:00:00Z', raw: { period_type: 'NORMAL', price: 9.99 } });
    const t = resolveTrial(profile(), [ev({}), sandboxRenewal], NOW)!;
    expect(t.status).toBe('trialing');
  });
});

describe('test / QA flags', () => {
  const admins = new Set(['owner@gmail.com']);
  it('a real customer has no flags', () => {
    expect(testFlags({ profile: profile(), attributionIsTest: false, adminCanonicals: admins, env: {} })).toEqual([]);
  });
  it("flags an alias of an admin's mailbox (owner+tag@gmail.com)", () => {
    const f = testFlags({ profile: profile({ email: 'owner+trial@gmail.com', email_canonical: 'owner@gmail.com' }), attributionIsTest: false, adminCanonicals: admins, env: {} });
    expect(f.map((x) => x.reason)).toEqual(['admin_alias']);
  });
  it('derives the canonical email when the column is empty', () => {
    const f = testFlags({ profile: profile({ email: 'owner+x@gmail.com', email_canonical: null }), attributionIsTest: false, adminCanonicals: admins, env: {} });
    expect(f.map((x) => x.reason)).toContain('admin_alias');
  });
  it('flags admins, the reviewer demo account, mock attribution and Test Lab devices', () => {
    expect(testFlags({ profile: profile({ is_admin: true }), attributionIsTest: false, adminCanonicals: admins, env: {} }).map((x) => x.reason)).toEqual(['internal']);
    expect(testFlags({ profile: profile({ email: 'fitcircle.user@gmail.com', email_canonical: null }), attributionIsTest: false, adminCanonicals: admins, env: {} }).map((x) => x.reason)).toEqual(['review']);
    expect(testFlags({ profile: profile(), attributionIsTest: true, adminCanonicals: admins, env: {} }).map((x) => x.reason)).toEqual(['mock_attribution']);
    expect(testFlags({ profile: profile({ metadata: { test_device: { at: 'x' } } }), attributionIsTest: false, adminCanonicals: admins, env: {} }).map((x) => x.reason)).toEqual(['test_device']);
  });
});

describe('toggles (sandbox / test exclusion)', () => {
  const q = { range: 'all' as const, includeSandbox: false, includeTest: false, platform: null };
  it('default view hides sandbox and test trials, keeps unknown-environment ones', () => {
    expect(visible({ environment: 'production', isTest: false, platform: 'app_store' }, q)).toEqual({ show: true, hiddenBy: null });
    expect(visible({ environment: 'sandbox', isTest: false, platform: 'app_store' }, q)).toEqual({ show: false, hiddenBy: 'sandbox' });
    expect(visible({ environment: 'production', isTest: true, platform: 'app_store' }, q)).toEqual({ show: false, hiddenBy: 'test' });
    expect(visible({ environment: 'unknown', isTest: false, platform: 'app_store' }, q).show).toBe(true);
  });
  it('toggles bring them back; platform filters', () => {
    expect(visible({ environment: 'sandbox', isTest: true, platform: 'app_store' }, { ...q, includeSandbox: true, includeTest: true }).show).toBe(true);
    expect(visible({ environment: 'production', isTest: false, platform: 'app_store' }, { ...q, platform: 'play_store' }).hiddenBy).toBe('platform');
  });
});

describe('helpers', () => {
  it('parses the query with safe defaults', () => {
    expect(parseTrialsQuery(new URLSearchParams(''))).toEqual({ range: 'all', includeSandbox: false, includeTest: false, platform: null });
    expect(parseTrialsQuery(new URLSearchParams('range=7d&includeSandbox=1&includeTest=true&platform=play_store'))).toEqual({
      range: '7d',
      includeSandbox: true,
      includeTest: true,
      platform: 'play_store',
    });
    expect(parseTrialsQuery(new URLSearchParams('range=1y&platform=promotional'))).toMatchObject({ range: 'all', platform: null });
  });
  it('range start', () => {
    expect(rangeStart('all', NOW)).toBeNull();
    expect(rangeStart('7d', NOW)!.toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });
  it('plan from product id', () => {
    expect(planOf('com.inov8rlabs.fitcircle.pro.annual:annual')).toBe('annual');
    expect(planOf('com.inov8rlabs.fitcircle.pro.monthly')).toBe('monthly');
    expect(planOf(null)).toBeNull();
  });
  it('country priority: attribution > store > assignment > profile', () => {
    expect(bestCountry({ attribution: null, store: 'us', assignment: 'VI' })).toEqual({ country: 'US', source: 'store' });
    expect(bestCountry({ attribution: 'CA', store: 'US' })).toEqual({ country: 'CA', source: 'attribution' });
    expect(bestCountry({ assignment: 'VI', profile: 'xx1' })).toEqual({ country: 'VI', source: 'experiment_assignment' });
    expect(bestCountry({})).toBeNull();
  });
  it('counts: conversion rate is over ended trials only', () => {
    const c = countTrials([{ status: 'trialing' }, { status: 'cancelled' }, { status: 'converted' }, { status: 'expired' }, { status: 'expired' }]);
    expect(c).toEqual({ total: 5, activeNow: 2, trialing: 1, cancelled: 1, converted: 1, expired: 2, ended: 3, conversionRate: 1 / 3 });
    expect(countTrials([{ status: 'trialing' }]).conversionRate).toBeNull();
  });
});
