// Sentry initialization for the browser (web frontend). Next.js loads this on the
// client automatically. Session Replay is intentionally NOT enabled — Amplitude
// already provides replay, so this avoids duplicate cost and bundle weight.
import * as Sentry from '@sentry/nextjs';

import { WEB_SENTRY_DSN } from './sentry.dsn';

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

// Instrument App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
