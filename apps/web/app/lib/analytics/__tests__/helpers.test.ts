import { afterEach, describe, expect, it, vi } from 'vitest';

import { firstTimeFor, paywallSource, rememberCheckout, takeCheckout, webProductId } from '../checkout';
import { readAnalyticsConfig } from '../config';
import { durationBand, isUpgradeRequired, toErrorKind } from '../helpers';
import { proPlanOf, primaryGoalOf, signupUserProperties, userPropertiesFor } from '../user-properties';

describe('toErrorKind', () => {
  it('maps API envelope codes, HTTP status and messages', () => {
    expect(toErrorKind({ code: 'UPGRADE_REQUIRED' })).toBe('forbidden');
    expect(toErrorKind({ code: 'invalid_credentials' })).toBe('invalid_credentials');
    expect(toErrorKind(null, 429)).toBe('rate_limited');
    expect(toErrorKind(null, 503)).toBe('server');
    expect(toErrorKind(new Error('User already registered'))).toBe('account_exists');
    expect(toErrorKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(toErrorKind('weird')).toBe('unknown');
  });

  it('detects the paywall code', () => {
    expect(isUpgradeRequired({ code: 'UPGRADE_REQUIRED' })).toBe(true);
    expect(isUpgradeRequired(new Error('x'))).toBe(false);
  });
});

describe('durationBand', () => {
  it('buckets minutes', () => {
    expect(durationBand(10)).toBe('lt_15');
    expect(durationBand(15)).toBe('15_30');
    expect(durationBand(45)).toBe('30_60');
    expect(durationBand(90)).toBe('60_plus');
    expect(durationBand(0)).toBeUndefined();
  });
});

describe('user properties', () => {
  it('derives canonical properties without identity or health values', () => {
    const props = userPropertiesFor({
      isPremium: true,
      goals: ['weight_loss'],
      onboardingCompleted: true,
      preferences: { units: { weight: 'kg' } },
    });
    expect(props).toEqual({ plan: 'pro', units_system: 'metric', primary_goal: 'weight_loss', onboarding_completed: true });
  });

  it('rejects free-text goals', () => {
    expect(primaryGoalOf(['I want to lose 10kg'])).toBeUndefined();
  });

  it('stamps setOnce signup properties', () => {
    expect(signupUserProperties('email', new Date('2026-10-09T23:00:00Z'))).toEqual({
      signup_method: 'email',
      signup_platform: 'web',
      account_created_date: '2026-10-09',
    });
  });

  it('maps product ids to pro_plan', () => {
    expect(proPlanOf(false, 'whatever')).toBe('none');
    expect(proPlanOf(true, 'fitcircle_pro_annual')).toBe('annual');
    expect(proPlanOf(true, 'stripe_pro_lifetime')).toBe('lifetime');
    expect(proPlanOf(true, 'pro_monthly')).toBe('monthly');
  });
});

describe('checkout context', () => {
  afterEach(() => sessionStorage.clear());

  it('round-trips plan and source, URL plan wins', () => {
    rememberCheckout({ plan: 'annual', source: 'streak_shield' });
    expect(takeCheckout('monthly')).toEqual({ plan: 'monthly', source: 'streak_shield' });
    expect(takeCheckout(null)).toBeNull(); // consumed
  });

  it('falls back to pricing_page without stored context', () => {
    expect(takeCheckout('lifetime')).toEqual({ plan: 'lifetime', source: 'pricing_page' });
  });

  it('dedupes per Stripe session', () => {
    expect(firstTimeFor('cs_1')).toBe(true);
    expect(firstTimeFor('cs_1')).toBe(false);
  });

  it('normalises sources and names products', () => {
    expect(paywallSource('Landing')).toBe('landing');
    expect(paywallSource('<script>')).toBe('pricing_page');
    expect(webProductId('annual')).toBe('stripe_pro_annual');
  });
});

describe('readAnalyticsConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stamps globals from Vercel env', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', '0123456789abcdef');
    const config = readAnalyticsConfig();
    expect(config.globals).toEqual({ platform_app: 'web', environment: 'production', app_build: '0123456' });
    expect(config.replaySampleRate).toBe(0);
  });

  it('treats previews as development', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_REPLAY_SAMPLE_RATE', '5');
    const config = readAnalyticsConfig();
    expect(config.globals.environment).toBe('development');
    expect(config.replaySampleRate).toBe(1);
  });
});
