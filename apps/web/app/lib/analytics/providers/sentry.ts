import * as Sentry from '@sentry/nextjs';

import type { AnalyticsProvider } from '../types';

/**
 * Records the event NAME (never properties) as a Sentry breadcrumb so crash
 * reports show what the user just did. Identity stays with Sentry's own scope.
 */
export class SentryBreadcrumbProvider implements AnalyticsProvider {
  readonly name = 'sentry';
  private optedOut = false;

  start(): void {}

  track(name: string): void {
    if (this.optedOut) return;
    Sentry.addBreadcrumb({ category: 'analytics', message: name, level: 'info' });
  }

  identify(): void {}
  setUserProperties(): void {}
  reset(): void {}
  flush(): void {}

  setOptOut(optOut: boolean): void {
    this.optedOut = optOut;
  }
}
