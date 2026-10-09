/**
 * FitCircle web analytics: one facade, any number of providers.
 *
 *   import { analytics, AnalyticsEvents } from '@/lib/analytics';
 *   analytics.track(AnalyticsEvents.mealLogged({ method: 'manual', is_edit: false }));
 *
 * Events, properties and user properties are defined in
 * analytics/tracking-plan.json (see analytics/README.md). Calls on the server
 * and calls before analytics consent are no-ops.
 */
import { AnalyticsClient } from './client';
import { readAnalyticsConfig } from './config';
import { AmplitudeProvider } from './providers/amplitude';
import { ConsoleProvider } from './providers/console';
import { PostHogProvider } from './providers/posthog';
import { SentryBreadcrumbProvider } from './providers/sentry';
import type { AnalyticsProvider } from './types';

const config = readAnalyticsConfig();

function createProviders(): AnalyticsProvider[] {
  const providers: AnalyticsProvider[] = [];
  if (config.amplitudeApiKey) {
    providers.push(
      new AmplitudeProvider({
        apiKey: config.amplitudeApiKey,
        appBuild: config.globals.app_build,
        globals: config.globals,
        replaySampleRate: config.replaySampleRate,
      })
    );
  }
  if (config.posthogKey) {
    providers.push(
      new PostHogProvider({ apiKey: config.posthogKey, apiHost: config.posthogHost, globals: config.globals })
    );
  }
  providers.push(new SentryBreadcrumbProvider());
  if (config.consoleEnabled) providers.push(new ConsoleProvider());
  return providers;
}

export const analytics = new AnalyticsClient({
  createProviders,
  globals: config.globals,
  debug: process.env.NODE_ENV !== 'production',
});

export { AnalyticsClient, splitUserProperties } from './client';
export { readAnalyticsConsent, CONSENT_COOKIE } from './consent';
export { sanitizeProperties, BLOCKED_PROPERTY_KEYS } from './privacy';
export * from './events.generated';
export type { AnalyticsProvider, AnalyticsProperties } from './types';
export { toErrorKind, isUpgradeRequired, durationBand, planFromProductId } from './helpers';
export { userPropertiesFor, signupUserProperties, proPlanOf, unitsSystemOf } from './user-properties';
