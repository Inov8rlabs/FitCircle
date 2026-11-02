/**
 * Route error reporting — the one place an API route (or a per-module error
 * mapper such as `failFrom`, `fitzyFail`, `challengeErrorResponse`) sends a
 * caught error to the logs and to Sentry.
 *
 * Why: a caught error that is turned into a response without being logged never
 * reaches Vercel runtime logs or Sentry (2026-11-02: a PostgREST "Could not find
 * a relationship" error was returned to the client and nobody saw it). Every
 * route catch block must either call `reportRouteError`, delegate to a mapper
 * that does, or be listed in the allowlist of
 * `app/lib/api/__tests__/route-catch-logging.test.ts`.
 *
 * Rules:
 *  - 5xx / unexpected: `console.error('[route] <label> …', error)` (full error
 *    object, so PostgREST code/details/hint show in Vercel logs) + Sentry
 *    `captureException` tagged `route` and `code`. The client gets
 *    `GENERIC_ERROR_MESSAGE`, never raw DB text.
 *  - 4xx / expected (auth, validation, not found, deliberate business-rule
 *    messages): `console.warn` only, no Sentry; the message is passed through.
 *
 * This module never builds a response: envelopes differ across the API
 * (`{ success, data, error: { code, message }, meta }` vs `{ error: '...' }`)
 * and the mobile apps decode them, so each route keeps its own shape.
 */
import * as Sentry from '@sentry/nextjs';

/** Client-facing message for any unexpected (5xx) failure. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export interface RouteErrorOptions {
  /** HTTP status the route answers with. Default 500. < 500 → warn only, no Sentry. */
  status?: number;
  /** Error code returned to the client (Sentry `code` tag). Defaults to the DB code or INTERNAL_SERVER_ERROR. */
  code?: string;
  /** Extra non-PII context attached to the Sentry event. */
  extra?: Record<string, unknown>;
}

/** Best-effort message of anything thrown (Error, PostgREST plain object, string). */
export function errorMessageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : 'unknown error';
}

// PostgREST codes (PGRST116) and Postgres SQLSTATEs (23505, 22P02, 42P01, P0001, XX000).
const PG_CODE = /^(PGRST\d+|\d[0-9A-Z]{4}|P0\d{3}|XX\d{3})$/;

/**
 * True for a Supabase/PostgREST error: `PostgrestError`, or the plain
 * `{ message, code, details, hint }` object that `const { error } = await
 * supabase.from(...)` hands back and services rethrow with `if (error) throw error`.
 */
export function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  if (e.name === 'PostgrestError') return true;
  if ('details' in e || 'hint' in e) return true;
  return typeof e.code === 'string' && PG_CODE.test(e.code);
}

/** "No row" / malformed-id DB errors (PGRST116 from `.single()`, 22P02 invalid uuid). */
export function isNotFoundDatabaseError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return isDatabaseError(error) && (code === 'PGRST116' || code === '22P02');
}

/**
 * True when the error is a message a service throws ON PURPOSE for the user
 * (`throw new Error('This challenge is invite-only')`, or a typed subclass such
 * as `ChallengeError`), as opposed to a DB error, a runtime bug (TypeError,
 * ReferenceError, …) or a network failure.
 */
export function isDeliberateError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (isDatabaseError(error)) return false;
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    error instanceof SyntaxError ||
    error instanceof EvalError ||
    error instanceof URIError
  ) {
    return false;
  }
  return error.message.trim().length > 0;
}

function toSentryError(error: unknown): Error {
  if (error instanceof Error) return error;
  const wrapped = new Error(errorMessageOf(error));
  wrapped.name = isDatabaseError(error) ? 'PostgrestError' : 'NonErrorThrown';
  return wrapped;
}

function dbContext(error: unknown): Record<string, unknown> {
  if (!isDatabaseError(error)) return {};
  const e = error as Record<string, unknown>;
  return { db_code: e.code ?? null, db_details: e.details ?? null, db_hint: e.hint ?? null };
}

/**
 * Log (and, for 5xx, Sentry-report) an error a route caught. Returns the
 * message that is safe to send to the client: the error's own message for
 * 4xx, `GENERIC_ERROR_MESSAGE` for 5xx. Never throws.
 */
export function reportRouteError(route: string, error: unknown, options: RouteErrorOptions = {}): string {
  const status = options.status ?? 500;
  const message = errorMessageOf(error);

  try {
    if (status < 500) {
      console.warn(`[route] ${route} → ${status}${options.code ? ` ${options.code}` : ''}: ${message}`);
      return message;
    }

    const dbCode = isDatabaseError(error) ? (error as { code?: unknown }).code : undefined;
    const code = options.code ?? (typeof dbCode === 'string' && dbCode ? dbCode : 'INTERNAL_SERVER_ERROR');
    console.error(`[route] ${route} failed (${status} ${code}):`, error);

    try {
      Sentry.captureException(toSentryError(error), {
        tags: { route, code },
        extra: { status, ...dbContext(error), ...(options.extra ?? {}) },
      });
    } catch {
      // Sentry must never take a route down.
    }
  } catch {
    // Logging must never take a route down either.
  }
  return status < 500 ? message : GENERIC_ERROR_MESSAGE;
}

/**
 * Log a Supabase query error a service tolerates (it carries on with a fallback
 * instead of throwing). Behaviour is unchanged; the failure is just no longer
 * invisible. Console only, no Sentry: these are degraded reads/writes.
 * PGRST116 ("`.single()` found no row") is an expected outcome of existence
 * checks and is not logged.
 */
export function logIgnoredQueryError(where: string, error: unknown): void {
  if (!error) return;
  if ((error as { code?: unknown }).code === 'PGRST116') return;
  try {
    console.error(`[service] ${where} query failed (ignored):`, error);
  } catch {
    // never throw from logging
  }
}
