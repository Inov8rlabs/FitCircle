import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../config';
import { computeLifecycleState, purchaseHistory } from '../state';
import type { GrantRow, LifecycleFacts, LifecycleProfile } from '../types';

const NOW = new Date('2026-11-08T16:00:00Z');
const H = 3_600_000;
const D = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const promo = (expiresMs: number | null, extra: Partial<LifecycleProfile> = {}): LifecycleProfile => ({
  id: 'u1',
  email: 'friend@gmail.com',
  is_admin: false,
  timezone: 'America/Chicago',
  subscription_tier: 'premium',
  subscription_status: 'active',
  subscription_platform: 'promotional',
  subscription_product_id: 'referral',
  subscription_expires_at: expiresMs === null ? null : at(expiresMs),
  trial_started_at: null,
  ...extra,
});
const referral = (createdMs: number, expiresMs: number | null, extra: Partial<GrantRow> = {}): GrantRow => ({
  granted_by: 'referral-program',
  created_at: at(createdMs),
  expires_at: expiresMs === null ? null : at(expiresMs),
  revoked_at: null,
  ...extra,
});
const facts = (profile: LifecycleProfile, grants: GrantRow[], extra: Partial<LifecycleFacts> = {}): LifecycleFacts => ({ profile, grants, hasPurchased: false, hadTrial: false, ...extra });
const run = (f: LifecycleFacts, now = NOW) => computeLifecycleState(f, now, DEFAULT_CONFIG, {});

describe('computeLifecycleState — pro_expiring', () => {
  it('referral week ending in 27 h → pro_expiring, 7-day period, trial available', () => {
    const r = run(facts(promo(27 * H), [referral(-7 * D + 27 * H, 27 * H)]));
    expect(r).toMatchObject({ state: 'pro_expiring', reason: null, source: 'referral', trialAvailable: true, periodDays: 7, endsAt: at(27 * H) });
  });

  it('outside the 48 h window → not yet', () => {
    expect(run(facts(promo(49 * H), [referral(-5 * D, 49 * H)]))).toMatchObject({ state: null, reason: 'not_ending_soon' });
  });

  it('renewed referral days: the extended expiry counts (a second referral pushes the end out)', () => {
    // One grant row whose expiry extendGrant moved from +20 h to +7 d 20 h.
    const r = run(facts(promo(7 * D + 20 * H), [referral(-6 * D, 7 * D + 20 * H)]));
    expect(r).toMatchObject({ state: null, reason: 'not_ending_soon' });
    // Two time-boxed grants (complimentary + referral): the later one decides.
    const two = run(facts(promo(10 * H), [referral(-6 * D, 10 * H), { granted_by: 'claude', created_at: at(-1 * D), expires_at: at(5 * D), revoked_at: null }]));
    expect(two).toMatchObject({ state: null, reason: 'not_ending_soon' });
  });

  it('an admin "until revoked" grant on top of referral time = lifetime, no prompt', () => {
    const r = run(facts(promo(null, { subscription_product_id: 'complimentary' }), [{ granted_by: 'aniruddh@bajirao.me', created_at: at(-30 * D), expires_at: null, revoked_at: null }, referral(-5 * D, 20 * H)]));
    expect(r).toMatchObject({ state: null, reason: 'lifetime' });
  });

  it('referral lifetime → no prompt', () => {
    expect(run(facts(promo(null), [{ granted_by: 'referral-lifetime', created_at: at(-D), expires_at: null, revoked_at: null }]))).toMatchObject({ state: null, reason: 'lifetime' });
  });

  it('complimentary time-boxed grant → source complimentary, "free Pro" (not a week)', () => {
    const r = run(facts(promo(30 * H, { subscription_product_id: 'complimentary' }), [{ granted_by: 'claude', created_at: at(-14 * D), expires_at: at(30 * H), revoked_at: null }]));
    expect(r).toMatchObject({ state: 'pro_expiring', source: 'complimentary' });
    expect(r.periodDays).toBeGreaterThan(14);
  });

  it('live store subscription wins (banked referral days behind a paid plan) → no prompt', () => {
    const p = promo(30 * D, { subscription_platform: 'app_store', subscription_product_id: 'fitcircle_pro_annual' });
    expect(run(facts(p, [referral(-5 * D, 20 * H)]))).toMatchObject({ state: null, reason: 'store_subscription' });
  });

  it('anyone who paid before is excluded', () => {
    expect(run(facts(promo(20 * H), [referral(-6 * D, 20 * H)], { hasPurchased: true }))).toMatchObject({ state: null, reason: 'purchased' });
  });

  it('internal / test accounts are excluded (domain, admin flag, Play test robots)', () => {
    expect(run(facts(promo(20 * H, { email: 'qa@inov8rlabs.com' }), [referral(-6 * D, 20 * H)]))).toMatchObject({ reason: 'internal_account' });
    expect(run(facts(promo(20 * H, { is_admin: true }), [referral(-6 * D, 20 * H)]))).toMatchObject({ reason: 'internal_account' });
    expect(run(facts(promo(20 * H, { email: 'johnsmith.12345@gmail.com' }), [referral(-6 * D, 20 * H)]))).toMatchObject({ reason: 'internal_account' });
  });

  it('a user who already had a trial → trialAvailable false (copy says "Get Pro", not "free")', () => {
    expect(run(facts(promo(20 * H, { trial_started_at: at(-60 * D) }), [referral(-6 * D, 20 * H)])).trialAvailable).toBe(false);
    expect(run(facts(promo(20 * H), [referral(-6 * D, 20 * H)], { hadTrial: true })).trialAvailable).toBe(false);
  });
});

describe('computeLifecycleState — pro_expired', () => {
  const free = (extra: Partial<LifecycleProfile> = {}) => promo(null, { subscription_tier: 'free', subscription_status: 'cancelled', subscription_platform: null, subscription_product_id: null, ...extra });

  it('ended 3 h ago and downgraded → pro_expired', () => {
    expect(run(facts(free(), [referral(-7 * D - 3 * H, -3 * H)]))).toMatchObject({ state: 'pro_expired', source: 'referral', endsAt: at(-3 * H), periodDays: 7 });
  });

  it('the sync path keeps platform=promotional on a downgraded profile: still pro_expired', () => {
    expect(run(facts(free({ subscription_platform: 'promotional', subscription_product_id: 'referral' }), [referral(-8 * D, -D)])).state).toBe('pro_expired');
  });

  it('ended but not downgraded yet (the hourly cron runs at :20) → awaiting_downgrade, no prompt', () => {
    expect(run(facts(promo(-10 * 60_000), [referral(-7 * D, -10 * 60_000)]))).toMatchObject({ state: null, reason: 'awaiting_downgrade' });
  });

  it('beyond daysAfter (7) → nothing', () => {
    expect(run(facts(free(), [referral(-15 * D, -8 * D)]))).toMatchObject({ state: null, reason: 'ended_too_long_ago' });
  });

  it('revoked grants never produce "Pro ended"', () => {
    expect(run(facts(free(), [referral(-7 * D, -H, { revoked_at: at(-2 * H) })]))).toMatchObject({ state: null, reason: 'revoked' });
  });

  it('a newer active grant hides the ended one (renewed → expiring/not-soon, never "ended")', () => {
    expect(run(facts(promo(5 * D), [referral(-14 * D, -7 * D), referral(-H, 5 * D)])).state).toBeNull();
  });

  it('no grants at all → no_grant', () => {
    expect(run(facts(free(), []))).toMatchObject({ state: null, reason: 'no_grant' });
  });
});

describe('computeLifecycleState — trial_expiring (store trials, card only)', () => {
  const trial = (willRenew: boolean, endsMs: number): LifecycleProfile => ({
    id: 't1',
    email: 'buyer@gmail.com',
    timezone: 'America/New_York',
    subscription_tier: 'premium',
    subscription_status: 'trialing',
    subscription_platform: 'app_store',
    subscription_expires_at: at(endsMs),
    subscription_will_renew: willRenew,
    trial_started_at: at(endsMs - 3 * D),
    trial_ends_at: at(endsMs),
  });

  it('renewal off, ends in 20 h → trial_expiring (no free trial left)', () => {
    expect(run(facts(trial(false, 20 * H), [], { hadTrial: true }))).toMatchObject({ state: 'trial_expiring', source: 'store_trial', trialAvailable: false, periodDays: 3 });
  });

  it('renewing trials are left to the existing trial_ending_reminder', () => {
    expect(run(facts(trial(true, 20 * H), [], { hadTrial: true }))).toMatchObject({ state: null, reason: 'trial_renews' });
  });

  it('outside the 24 h window → not yet', () => {
    expect(run(facts(trial(false, 30 * H), [], { hadTrial: true }))).toMatchObject({ state: null, reason: 'not_ending_soon' });
  });
});

describe('purchaseHistory', () => {
  it('ignores TEST and SANDBOX; TRIAL initial purchase = trial, not a payment', () => {
    expect(purchaseHistory([{ type: 'INITIAL_PURCHASE', environment: 'SANDBOX', raw: { period_type: 'NORMAL' } }, { type: 'TEST', environment: 'PRODUCTION' }], {})).toEqual({ hasPurchased: false, hadTrial: false });
    expect(purchaseHistory([{ type: 'INITIAL_PURCHASE', environment: 'PRODUCTION', raw: { period_type: 'TRIAL' } }], {})).toEqual({ hasPurchased: false, hadTrial: true });
    expect(purchaseHistory([{ type: 'INITIAL_PURCHASE', environment: 'PRODUCTION', raw: { event: { period_type: 'NORMAL' } } }], {})).toEqual({ hasPurchased: true, hadTrial: false });
    expect(purchaseHistory([{ type: 'RENEWAL', environment: 'PRODUCTION', raw: {} }], {})).toEqual({ hasPurchased: true, hadTrial: false });
    expect(purchaseHistory([], { trial_converted_at: '2026-10-01T00:00:00Z', trial_started_at: '2026-09-28T00:00:00Z' })).toEqual({ hasPurchased: true, hadTrial: true });
  });
});
