import type * as AmplitudeModule from '@amplitude/analytics-browser';

import type { AnalyticsGlobalProperties, AnalyticsProperties } from '../types';

import { DeferredProvider } from './deferred';

type AmplitudeSDK = typeof AmplitudeModule;

export interface AmplitudeProviderOptions {
  apiKey: string;
  appBuild: string;
  globals: AnalyticsGlobalProperties;
  /** 0 disables Session Replay entirely (the plugin is never loaded). */
  replaySampleRate: number;
}

/**
 * Amplitude Browser SDK 2.x. Loaded only after analytics consent.
 *
 * Quota (Starter, 2M events/month): autocapture is limited to sessions, page
 * views and attribution, and remote config is not fetched so the dashboard
 * cannot silently switch on click/form capture.
 */
export class AmplitudeProvider extends DeferredProvider<AmplitudeSDK> {
  readonly name = 'amplitude';

  constructor(private readonly options: AmplitudeProviderOptions) {
    super();
  }

  protected async load(): Promise<AmplitudeSDK> {
    const amplitude = await import('@amplitude/analytics-browser');
    const { apiKey, appBuild, globals, replaySampleRate } = this.options;

    // Stamp the global properties on autocaptured events too (page views, sessions).
    await amplitude.add({
      name: 'fitcircle-global-properties',
      type: 'enrichment',
      execute: (event) => {
        event.event_properties = { ...globals, ...(event.event_properties ?? {}) };
        return Promise.resolve(event);
      },
    }).promise;

    if (replaySampleRate > 0) {
      const { sessionReplayPlugin } = await import('@amplitude/plugin-session-replay-browser');
      // FitCircle screens show health data: always mask conservatively.
      await amplitude.add(
        sessionReplayPlugin({
          sampleRate: replaySampleRate,
          privacyConfig: { defaultMaskLevel: 'conservative' },
        })
      ).promise;
    }

    await amplitude.init(apiKey, undefined, {
      appVersion: appBuild,
      autocapture: {
        sessions: true,
        pageViews: true,
        attribution: true,
        elementInteractions: false,
        formInteractions: false,
        fileDownloads: false,
        frustrationInteractions: false,
        networkTracking: false,
        webVitals: false,
      },
      fetchRemoteConfig: false,
      logLevel: amplitude.Types.LogLevel.Warn,
    }).promise;

    return amplitude;
  }

  track(name: string, properties: AnalyticsProperties): void {
    this.run((amp) => {
      amp.track(name, properties);
    });
  }

  identify(userId: string, set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    this.run((amp) => {
      amp.setUserId(userId);
      this.sendIdentify(amp, set, setOnce);
    });
  }

  setUserProperties(set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    this.run((amp) => this.sendIdentify(amp, set, setOnce));
  }

  private sendIdentify(amp: AmplitudeSDK, set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    const keys = Object.keys(set).length + Object.keys(setOnce).length;
    if (keys === 0) return;
    const identify = new amp.Identify();
    for (const [key, value] of Object.entries(set)) identify.set(key, value);
    for (const [key, value] of Object.entries(setOnce)) identify.setOnce(key, value);
    amp.identify(identify);
  }

  reset(): void {
    this.run((amp) => amp.reset());
  }

  flush(): void {
    this.run((amp) => {
      void amp.flush().promise;
    });
  }

  setOptOut(optOut: boolean): void {
    this.run((amp) => amp.setOptOut(optOut));
  }
}
