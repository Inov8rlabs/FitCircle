/**
 * Provider contract for the analytics facade (see analytics/README.md).
 *
 * A provider is a thin adapter over one vendor SDK. The facade owns consent,
 * enrichment, the privacy backstop and identity bookkeeping; providers only
 * forward what they are given.
 */

export type AnalyticsPropertyValue = string | number | boolean;
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;

export interface AnalyticsProvider {
  /** Short stable id, used in debug logs and tests. */
  readonly name: string;
  /** Called once, only after analytics consent has been granted. */
  start(): void;
  track(name: string, properties: AnalyticsProperties): void;
  identify(userId: string, set: AnalyticsProperties, setOnce: AnalyticsProperties): void;
  setUserProperties(set: AnalyticsProperties, setOnce: AnalyticsProperties): void;
  /** Clear the user id and rotate the anonymous device id. */
  reset(): void;
  flush(): Promise<void> | void;
  setOptOut(optOut: boolean): void;
}

/** Stamped on every event by the facade (and on autocaptured events by providers that support it). */
export interface AnalyticsGlobalProperties extends AnalyticsProperties {
  platform_app: 'web';
  environment: 'production' | 'development';
  app_build: string;
}
