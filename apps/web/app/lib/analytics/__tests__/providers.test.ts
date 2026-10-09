import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = {
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  setPersonProperties: vi.fn(),
  reset: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
};
const posthogFactory = vi.fn(() => ({ default: posthog }));
vi.mock('posthog-js', () => posthogFactory());

const amplitude = {
  add: vi.fn(() => ({ promise: Promise.resolve() })),
  init: vi.fn(() => ({ promise: Promise.resolve() })),
  track: vi.fn(),
  setUserId: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  flush: vi.fn(() => ({ promise: Promise.resolve() })),
  setOptOut: vi.fn(),
  Identify: class {
    set = vi.fn(() => this);
    setOnce = vi.fn(() => this);
  },
  Types: { LogLevel: { Warn: 2 } },
};
vi.mock('@amplitude/analytics-browser', () => amplitude);
const sessionReplayPlugin = vi.fn(() => ({ name: 'replay' }));
vi.mock('@amplitude/plugin-session-replay-browser', () => ({ sessionReplayPlugin }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadFacade(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  const mod = await import('../index');
  return mod;
}

describe('provider registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = 'fc_consent=; max-age=0; path=/';
  });
  afterEach(() => vi.unstubAllEnvs());

  it('never loads posthog-js when NEXT_PUBLIC_POSTHOG_KEY is unset', async () => {
    const { analytics, AnalyticsEvents } = await loadFacade({ NEXT_PUBLIC_POSTHOG_KEY: '' });
    analytics.setOptOut(false);
    analytics.track(AnalyticsEvents.leaderboardViewed());
    await flush();
    expect(posthogFactory).not.toHaveBeenCalled();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('starts nothing before consent even with every key set', async () => {
    const { analytics, AnalyticsEvents } = await loadFacade({
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_test',
      NEXT_PUBLIC_VERCEL_ENV: 'production',
    });
    analytics.track(AnalyticsEvents.leaderboardViewed());
    await flush();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(amplitude.init).not.toHaveBeenCalled();
  });

  it('loads PostHog after consent with autocapture and recording off', async () => {
    const { analytics, AnalyticsEvents } = await loadFacade({
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_test',
      NEXT_PUBLIC_POSTHOG_HOST: '',
    });
    analytics.setOptOut(false);
    analytics.identify('user-1', { plan: 'free', signup_method: 'email' });
    analytics.track(AnalyticsEvents.chatOpened());
    await flush();

    expect(posthog.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
        autocapture: false,
        disable_session_recording: true,
      })
    );
    expect(posthog.register).toHaveBeenCalledWith(expect.objectContaining({ platform_app: 'web' }));
    expect(posthog.identify).toHaveBeenCalledWith('user-1', { plan: 'free' }, { signup_method: 'email' });
    expect(posthog.capture).toHaveBeenCalledWith('Chat Opened', expect.objectContaining({ platform_app: 'web' }));

    analytics.setOptOut(true);
    expect(posthog.opt_out_capturing).toHaveBeenCalled();
  });

  it('uses the production Amplitude key only in production, with limited autocapture', async () => {
    const { analytics } = await loadFacade({ NEXT_PUBLIC_VERCEL_ENV: 'production', NEXT_PUBLIC_AMPLITUDE_API_KEY: '' });
    analytics.setOptOut(false);
    await flush();
    expect(amplitude.init).toHaveBeenCalledWith(
      'd0229f4c11c291cb0cb2204620bc9657',
      undefined,
      expect.objectContaining({
        autocapture: expect.objectContaining({
          sessions: true,
          pageViews: true,
          attribution: true,
          elementInteractions: false,
          formInteractions: false,
          fileDownloads: false,
          frustrationInteractions: false,
        }),
        remoteConfig: { fetchRemoteConfig: false },
      })
    );
    expect(sessionReplayPlugin).not.toHaveBeenCalled();
  });

  it('uses the FitCircle Dev key outside production and enables masked replay only when sampled', async () => {
    const { analytics } = await loadFacade({
      NEXT_PUBLIC_VERCEL_ENV: 'preview',
      NEXT_PUBLIC_AMPLITUDE_DEV_API_KEY: '',
      NEXT_PUBLIC_AMPLITUDE_REPLAY_SAMPLE_RATE: '0.1',
    });
    analytics.setOptOut(false);
    await flush();
    expect(amplitude.init).toHaveBeenCalledWith('e03771b97db31e206aa90890ad502122', undefined, expect.any(Object));
    expect(sessionReplayPlugin).toHaveBeenCalledWith({
      sampleRate: 0.1,
      privacyConfig: { defaultMaskLevel: 'conservative' },
    });
  });

  it('turns Amplitude off when the key override is "off"', async () => {
    const { analytics } = await loadFacade({ NEXT_PUBLIC_VERCEL_ENV: 'preview', NEXT_PUBLIC_AMPLITUDE_DEV_API_KEY: 'off' });
    analytics.setOptOut(false);
    await flush();
    expect(amplitude.init).not.toHaveBeenCalled();
  });
});
