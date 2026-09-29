import { NextResponse } from 'next/server';
import { z } from 'zod';

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
    return NextResponse.json(
      { success: false, data: null, error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  // Unexpected (database, programming) error: log the reason, never echo it.
  console.error(`[Challenges] ${context} failed:`, message ?? 'unknown error');
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again.' },
    },
    { status: 500 }
  );
}

/** Path ids arrive UPPERCASE from iOS; Postgres stores and returns them lowercase. */
export function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}
