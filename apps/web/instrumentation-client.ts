// Sentry initialization for the browser (web frontend). Next.js loads this on the
// client automatically. Session Replay is intentionally NOT enabled here: replay,
// when wanted, is Amplitude's (consent-gated, NEXT_PUBLIC_AMPLITUDE_REPLAY_SAMPLE_RATE).
// Product analytics live in app/lib/analytics (they add event-name breadcrumbs).
import * as Sentry from '@sentry/nextjs';

import { isDeferredSentryPath, runWhenIdleOrInteracted } from './sentry.client-defer';
import { WEB_SENTRY_DSN } from './sentry.dsn';

const initSentry = () =>
  Sentry.init({
    dsn: WEB_SENTRY_DSN,
    // Active on Vercel (preview + production); off in local `next dev` to avoid noise.
    enabled: Boolean(WEB_SENTRY_DSN) && process.env.NODE_ENV !== 'development',
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    // tracesSampleRate enables browser tracing automatically (page loads,
    // navigations, web vitals) — the source of client performance metrics.
    tracesSampleRate: process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? 0.1 : 1.0,
    // Forward warnings/errors logged to the console into Sentry's Logs product.
    // Kept to warn/error on the browser to avoid third-party console noise.
    enableLogs: true,
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
    ],
  });

// Public marketing pages start Sentry after first interaction / idle (see
// sentry.client-defer.ts); the signed-in app initialises immediately, as before.
if (typeof window !== 'undefined' && isDeferredSentryPath(window.location.pathname)) {
  runWhenIdleOrInteracted(initSentry);
} else {
  initSentry();
}

// Instrument App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
