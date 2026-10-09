import type { PostHog } from 'posthog-js';

import type { AnalyticsGlobalProperties, AnalyticsProperties } from '../types';

import { DeferredProvider } from './deferred';

export interface PostHogProviderOptions {
  apiKey: string;
  apiHost: string;
  globals: AnalyticsGlobalProperties;
}

/**
 * PostHog product analytics. The facade only registers this provider when
 * NEXT_PUBLIC_POSTHOG_KEY is set, and posthog-js is fetched with a dynamic
 * import after consent, so it is never in the bundle path otherwise.
 * Autocapture, session recording, surveys and heatmaps are off: events come
 * from the tracking plan only (plus page views, mirroring Amplitude).
 */
export class PostHogProvider extends DeferredProvider<PostHog> {
  readonly name = 'posthog';

  constructor(private readonly options: PostHogProviderOptions) {
    super();
  }

  protected async load(): Promise<PostHog> {
    const { default: posthog } = await import('posthog-js');
    posthog.init(this.options.apiKey, {
      api_host: this.options.apiHost,
      autocapture: false,
      capture_pageview: 'history_change',
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      enable_heatmaps: false,
      rageclick: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      person_profiles: 'identified_only',
    });
    posthog.register(this.options.globals);
    return posthog;
  }

  track(name: string, properties: AnalyticsProperties): void {
    this.run((ph) => {
      ph.capture(name, properties);
    });
  }

  identify(userId: string, set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    // identify(distinctId, $set, $set_once)
    this.run((ph) => ph.identify(userId, set, setOnce));
  }

  setUserProperties(set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    if (Object.keys(set).length + Object.keys(setOnce).length === 0) return;
    this.run((ph) => ph.setPersonProperties(set, setOnce));
  }

  reset(): void {
    this.run((ph) => {
      ph.reset();
      // reset() clears super properties; restore the global stamp.
      ph.register(this.options.globals);
    });
  }

  flush(): void {
    // posthog-js batches and flushes on unload itself; nothing to force here.
  }

  setOptOut(optOut: boolean): void {
    this.run((ph) => (optOut ? ph.opt_out_capturing() : ph.opt_in_capturing()));
  }
}
