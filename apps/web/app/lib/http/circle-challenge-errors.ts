import { NextResponse } from 'next/server';
import { z } from 'zod';

import { GENERIC_ERROR_MESSAGE, isDeliberateError, isNotFoundDatabaseError, reportRouteError } from '@/lib/api/route-errors';
import { ChallengeError } from '@/lib/services/circle-challenge-service';
import { validationMessage } from '@/lib/validation/lenient-parse';

export { readJsonBody } from './lenient-json-body';

/**
 * Error → response mapper for the circle-challenge activity-log routes.
 *
 * Envelope is the one the sibling challenge routes already use and that iOS
 * (`ChallengeAPIResponse`), Android (`ApiResponse`) and the web app decode:
 * `{ success: false, data: null, error: { code, message } }`.
 * `error.code` and `error.message` are ALWAYS strings (Android requires both).
 */
export function challengeErrorResponse(error: unknown, context: string): NextResponse {
  const message = error instanceof Error ? error.message : undefined;

  if (message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
      { status: 401 }
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: validationMessage(error),
          details: error.errors.reduce((acc: Record<string, string>, issue) => {
            acc[issue.path.join('.') || 'request'] = issue.message;
            return acc;
          }, {}),
        },
      },
      { status: 400 }
    );
  }

  if (error instanceof ChallengeError) {
    if (error.status >= 500) reportRouteError(`challenges/${context}`, error, { status: error.status, code: error.code });
    return NextResponse.json(
      { success: false, data: null, error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  // Unexpected (database, programming) error: log the reason, never echo it.
  reportRouteError(`challenges/${context}`, error, { code: 'INTERNAL_SERVER_ERROR' });
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again.' },
    },
    { status: 500 }
  );
}

/**
 * Catch-all for the older circle-challenge / challenge-template / circle-quest
 * routes, whose last branch used to be `400 { code: 'ERROR', message: error.message }`
 * for ANYTHING, which echoed raw PostgREST text to the client and logged nothing.
 *
 * Envelope unchanged: `{ success: false, data: null, error: { code, message } }`.
 *  - A message the service throws on purpose (`throw new Error('This challenge is
 *    invite-only')`, `ChallengeError`) → 400 ERROR with that message, as before.
 *  - "No such row" / malformed id DB errors (PGRST116, 22P02) → 400 ERROR "Not found"
 *    (same status as before, no DB text).
 *  - Anything else (DB/schema errors, runtime bugs, network) → 500
 *    INTERNAL_SERVER_ERROR with a generic message, logged + reported to Sentry.
 */
export function unhandledChallengeError(error: unknown, route: string): NextResponse {
  if (isDeliberateError(error)) {
    reportRouteError(route, error, { status: 400, code: 'ERROR' });
    return NextResponse.json({ success: false, data: null, error: { code: 'ERROR', message: error.message } }, { status: 400 });
  }
  if (isNotFoundDatabaseError(error)) {
    reportRouteError(route, error, { status: 400, code: 'ERROR' });
    return NextResponse.json({ success: false, data: null, error: { code: 'ERROR', message: 'Not found' } }, { status: 400 });
  }
  reportRouteError(route, error, { code: 'INTERNAL_SERVER_ERROR' });
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: GENERIC_ERROR_MESSAGE } },
    { status: 500 }
  );
}

/** Path ids arrive UPPERCASE from iOS; Postgres stores and returns them lowercase. */
export function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}
