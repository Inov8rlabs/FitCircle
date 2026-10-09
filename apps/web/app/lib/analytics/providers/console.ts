import type { AnalyticsProperties, AnalyticsProvider } from '../types';

/** Development-only: prints every call so instrumentation can be checked locally. */
export class ConsoleProvider implements AnalyticsProvider {
  readonly name = 'console';

  start(): void {
    this.log('start');
  }

  track(name: string, properties: AnalyticsProperties): void {
    this.log('track', name, properties);
  }

  identify(userId: string, set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    this.log('identify', userId, { set, setOnce });
  }

  setUserProperties(set: AnalyticsProperties, setOnce: AnalyticsProperties): void {
    this.log('setUserProperties', { set, setOnce });
  }

  reset(): void {
    this.log('reset');
  }

  flush(): void {
    this.log('flush');
  }

  setOptOut(optOut: boolean): void {
    this.log('setOptOut', optOut);
  }

  private log(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.debug('[analytics]', ...args);
  }
}
