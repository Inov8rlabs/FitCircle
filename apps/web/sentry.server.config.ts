// Sentry initialization for the Node.js server runtime (API routes, server
// components, cron). Imported by instrumentation.ts when NEXT_RUNTIME === 'nodejs'.
//
// Fully inert until SENTRY_DSN is set (e.g. in Vercel env vars): with no DSN the
// SDK is disabled and every capture call is a no-op, so this is safe to ship
// before the Sentry project exists.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  // Prefer Vercel's per-deployment environment (production/preview/development).
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  // Errors are always captured; sample performance traces lightly in prod.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // We attach our own userId where useful; don't auto-send IP/cookies/headers.
  sendDefaultPii: false,
});
