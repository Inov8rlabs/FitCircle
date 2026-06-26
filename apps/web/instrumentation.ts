// Next.js instrumentation hook. Initializes Sentry per runtime and wires the
// App Router's request-error hook so uncaught errors in route handlers / server
// components are reported. Handled errors (e.g. the nutrition parse fallbacks)
// are captured explicitly in the service layer.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
