// Sentry initialization for the Edge runtime (middleware, edge route handlers).
// Imported by instrumentation.ts when NEXT_RUNTIME === 'edge'. Inert until
// SENTRY_DSN is set — see sentry.server.config.ts.
import * as Sentry from '@sentry/nextjs';

import { WEB_SENTRY_DSN } from './sentry.dsn';

const dsn = WEB_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && process.env.NODE_ENV !== 'development',
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0,
  sendDefaultPii: false,
});
