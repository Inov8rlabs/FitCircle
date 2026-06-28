// Sentry initialization for the Node.js server runtime (API routes, server
// components, cron). Imported by instrumentation.ts when NEXT_RUNTIME === 'nodejs'.
//
// Fully inert until SENTRY_DSN is set (e.g. in Vercel env vars): with no DSN the
// SDK is disabled and every capture call is a no-op, so this is safe to ship
// before the Sentry project exists.
import * as Sentry from '@sentry/nextjs';

import { WEB_SENTRY_DSN } from './sentry.dsn';

const dsn = WEB_SENTRY_DSN;

Sentry.init({
  dsn,
  // Active on Vercel (preview + production); off in local `next dev` to avoid noise.
  enabled: Boolean(dsn) && process.env.NODE_ENV !== 'development',
  // Prefer Vercel's per-deployment environment (production/preview/development).
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  // Errors are always captured; sample performance traces lightly in prod.
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0,
  // Pipe structured logs to Sentry (Logs product). The console integration
  // forwards existing console.* calls so the heavy service-layer logging shows
  // up in Sentry without a rewrite. Narrow `levels` if volume/cost is a concern.
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ['info', 'warn', 'error'] }),
  ],
  // We attach our own userId where useful; don't auto-send IP/cookies/headers.
  sendDefaultPii: false,
});
