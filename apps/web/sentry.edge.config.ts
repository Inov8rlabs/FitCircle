// Sentry initialization for the Edge runtime (middleware, edge route handlers).
// Imported by instrumentation.ts when NEXT_RUNTIME === 'edge'. Inert until
// SENTRY_DSN is set — see sentry.server.config.ts.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
});
