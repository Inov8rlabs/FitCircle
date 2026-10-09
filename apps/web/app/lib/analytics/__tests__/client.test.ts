import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsClient, splitUserProperties } from '../client';
import { AnalyticsEvents, type AnalyticsEventPayload } from '../events.generated';
import type { AnalyticsGlobalProperties, AnalyticsProvider } from '../types';

const globals: AnalyticsGlobalProperties = { platform_app: 'web', environment: 'development', app_build: 'abc1234' };

function fakeProvider(name = 'fake') {
  return {
    name,
    start: vi.fn(),
    track: vi.fn(),
    identify: vi.fn(),
    setUserProperties: vi.fn(),
    reset: vi.fn(),
    flush: vi.fn(),
    setOptOut: vi.fn(),
  } satisfies AnalyticsProvider;
}

function setup(opts: { consent?: boolean; browser?: boolean; providers?: AnalyticsProvider[] } = {}) {
  const providers = opts.providers ?? [fakeProvider('a'), fakeProvider('b')];
  const createProviders = vi.fn(() => providers);
  let consent = opts.consent ?? true;
  const client = new AnalyticsClient({
    createProviders,
    globals,
    readConsent: () => consent,
    isBrowser: () => opts.browser ?? true,
  });
  return {
    client,
    providers: providers as ReturnType<typeof fakeProvider>[],
    createProviders,
    setStoredConsent: (v: boolean) => (consent = v),
  };
}

describe('AnalyticsClient fan-out', () => {
  it('sends every event to every provider with the global properties', () => {
    const { client, providers } = setup();
    client.track(AnalyticsEvents.mealLogged({ method: 'manual', is_edit: false, meal_type: 'lunch' }));

    for (const p of providers) {
      expect(p.start).toHaveBeenCalledTimes(1);
      expect(p.track).toHaveBeenCalledWith('Meal Logged', {
        method: 'manual',
        is_edit: false,
        meal_type: 'lunch',
        platform_app: 'web',
        environment: 'development',
        app_build: 'abc1234',
      });
    }
  });

  it('keeps fanning out when one provider throws', () => {
    const broken = fakeProvider('broken');
    broken.track.mockImplementation(() => {
      throw new Error('boom');
    });
    const healthy = fakeProvider('healthy');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = setup({ providers: [broken, healthy] });

    client.track(AnalyticsEvents.leaderboardViewed());

    expect(healthy.track).toHaveBeenCalledWith('Leaderboard Viewed', expect.any(Object));
    warn.mockRestore();
  });

  it('forwards reset, flush and identify', () => {
    const { client, providers } = setup();
    client.identify('user-1', { plan: 'free' });
    client.flush();
    client.reset();
    for (const p of providers) {
      expect(p.identify).toHaveBeenCalledWith('user-1', { plan: 'free' }, {});
      expect(p.flush).toHaveBeenCalled();
      expect(p.reset).toHaveBeenCalled();
    }
    expect(client.userId).toBeNull();
  });
});

describe('consent gating', () => {
  it('creates no provider and drops events before consent', () => {
    const { client, providers, createProviders } = setup({ consent: false });
    client.track(AnalyticsEvents.signUpStarted({ method: 'email' }));
    client.setUserProperties({ plan: 'free' });

    expect(createProviders).not.toHaveBeenCalled();
    for (const p of providers) {
      expect(p.start).not.toHaveBeenCalled();
      expect(p.track).not.toHaveBeenCalled();
    }
  });

  it('does not replay pre-consent events once consent is granted', () => {
    const { client, providers } = setup({ consent: false });
    client.track(AnalyticsEvents.pricingViewed({ source: 'landing' }));

    client.setOptOut(false); // banner: accept
    client.track(AnalyticsEvents.paywallViewed({ source: 'landing' }));

    for (const p of providers) {
      expect(p.start).toHaveBeenCalledTimes(1);
      expect(p.track).toHaveBeenCalledTimes(1);
      expect(p.track).toHaveBeenCalledWith('Paywall Viewed', expect.any(Object));
    }
  });

  it('applies the in-memory identity when consent arrives mid-session', () => {
    const { client, providers } = setup({ consent: false });
    client.identify('user-9', { plan: 'pro', signup_method: 'email' });
    expect(providers[0].identify).not.toHaveBeenCalled();

    client.setOptOut(false);
    expect(providers[0].identify).toHaveBeenCalledWith('user-9', { plan: 'pro' }, { signup_method: 'email' });
  });

  it('opts every provider out on revoke and drops later events', () => {
    const { client, providers } = setup({ consent: true });
    client.track(AnalyticsEvents.chatOpened());

    client.setOptOut(true);
    client.track(AnalyticsEvents.chatOpened());

    for (const p of providers) {
      expect(p.setOptOut).toHaveBeenCalledWith(true);
      expect(p.track).toHaveBeenCalledTimes(1);
    }

    client.setOptOut(false);
    for (const p of providers) {
      expect(p.setOptOut).toHaveBeenLastCalledWith(false);
      expect(p.start).toHaveBeenCalledTimes(1); // not re-created
    }
  });

  it('reads stored consent lazily on first use', () => {
    const { client, createProviders, setStoredConsent } = setup({ consent: false });
    setStoredConsent(true);
    client.init();
    expect(createProviders).toHaveBeenCalledTimes(1);
    expect(client.hasConsent).toBe(true);
  });
});

describe('privacy backstop', () => {
  it('drops blocked keys and email-looking values from events', () => {
    const { client, providers } = setup();
    const payload: AnalyticsEventPayload = {
      name: 'Weight Logged',
      properties: { source: 'form', weight_kg: 82.5, email: 'a@b.co', note: 'hi', label: 'x@y.io' },
    };
    client.track(payload);
    expect(providers[0].track).toHaveBeenCalledWith('Weight Logged', { source: 'form', ...globals });
  });

  it('keeps plan keys that merely resemble blocked ones', () => {
    const { client, providers } = setup();
    client.track(AnalyticsEvents.onboardingStepViewed({ step_name: 'goals', step_number: 2 }));
    client.track(AnalyticsEvents.checkInCompleted({ is_backfill: false, has_weight: true, streak_day: 4 }));
    expect(providers[0].track).toHaveBeenNthCalledWith(1, 'Onboarding Step Viewed', expect.objectContaining({ step_name: 'goals' }));
    expect(providers[0].track).toHaveBeenNthCalledWith(2, 'Check-in Completed', expect.objectContaining({ has_weight: true }));
  });

  it('globals cannot be overridden by event properties', () => {
    const { client, providers } = setup();
    client.track({ name: 'Logout', properties: { reason: 'user', platform_app: 'ios' } });
    expect(providers[0].track).toHaveBeenCalledWith('Logout', expect.objectContaining({ platform_app: 'web' }));
  });

  it('logs (does not throw) for events missing from the plan in debug mode', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new AnalyticsClient({
      createProviders: () => [],
      globals,
      readConsent: () => true,
      isBrowser: () => true,
      debug: true,
    });
    client.track({ name: 'Made Up' as never, properties: {} });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Made Up'));
    error.mockRestore();
  });
});

describe('user properties', () => {
  it('splits setOnce keys from set keys', () => {
    expect(
      splitUserProperties({
        plan: 'free',
        signup_method: 'email',
        signup_platform: 'web',
        account_created_date: '2026-10-09',
        circles_count: 2,
      })
    ).toEqual({
      set: { plan: 'free', circles_count: 2 },
      setOnce: { signup_method: 'email', signup_platform: 'web', account_created_date: '2026-10-09' },
    });
  });

  it('routes setOnce through identify and setUserProperties', () => {
    const { client, providers } = setup();
    client.identify('u1', { signup_method: 'email', onboarding_completed: false });
    client.setUserProperties({ units_system: 'metric', account_created_date: '2026-10-09' });
    expect(providers[0].identify).toHaveBeenCalledWith('u1', { onboarding_completed: false }, { signup_method: 'email' });
    expect(providers[0].setUserProperties).toHaveBeenCalledWith(
      { units_system: 'metric' },
      { account_created_date: '2026-10-09' }
    );
  });
});

describe('SSR', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('is a no-op on the server', () => {
    const { client, providers, createProviders } = setup({ browser: false, consent: true });
    client.init();
    client.track(AnalyticsEvents.leaderboardViewed());
    client.identify('u1', { plan: 'pro' });
    client.setOptOut(false);
    client.reset();
    expect(createProviders).not.toHaveBeenCalled();
    expect(providers[0].track).not.toHaveBeenCalled();
    expect(client.userId).toBeNull();
  });
});
