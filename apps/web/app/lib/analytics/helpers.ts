/**
 * Small mappers from app state to plan enums. Nothing here reads raw values
 * into events: they only bucket or classify.
 */
import type { DurationBand, ErrorKind, Plan } from './events.generated';

const CODE_KINDS: Record<string, ErrorKind> = {
  UNAUTHORIZED: 'forbidden',
  FORBIDDEN: 'forbidden',
  UPGRADE_REQUIRED: 'forbidden',
  PREMIUM_REQUIRED: 'forbidden',
  NOT_FOUND: 'not_found',
  USER_NOT_FOUND: 'not_found',
  VALIDATION_ERROR: 'validation',
  BAD_REQUEST: 'validation',
  INVALID_JOIN: 'validation',
  RATE_LIMITED: 'rate_limited',
  INTERNAL_SERVER_ERROR: 'server',
  FETCH_FAILED: 'network',
  FETCH_ERROR: 'network',
  // Supabase Auth error codes
  INVALID_CREDENTIALS: 'invalid_credentials',
  USER_ALREADY_EXISTS: 'account_exists',
  EMAIL_EXISTS: 'account_exists',
  EMAIL_NOT_CONFIRMED: 'forbidden',
  OVER_EMAIL_SEND_RATE_LIMIT: 'rate_limited',
  OVER_REQUEST_RATE_LIMIT: 'rate_limited',
  WEAK_PASSWORD: 'validation',
  VALIDATION_FAILED: 'validation',
};

function codeOf(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code.toUpperCase() : undefined;
}

/** True when an API error is the free-tier paywall (`UPGRADE_REQUIRED` / `PREMIUM_REQUIRED`). */
export function isUpgradeRequired(error: unknown): boolean {
  const code = codeOf(error);
  return code === 'UPGRADE_REQUIRED' || code === 'PREMIUM_REQUIRED';
}

/** Classifies an error (and optional HTTP status) into the plan's `error_kind`. */
export function toErrorKind(error: unknown, status?: number): ErrorKind {
  const code = codeOf(error);
  if (code && CODE_KINDS[code]) return CODE_KINDS[code];
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status === 400 || status === 422) return 'validation';
    if (status >= 500) return 'server';
  }
  const name = error instanceof Error ? error.name : '';
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').toLowerCase();
  if (name === 'AbortError' || message.includes('cancel')) return 'cancelled';
  if (message.includes('invalid login') || message.includes('invalid credentials') || message.includes('invalid email or password')) {
    return 'invalid_credentials';
  }
  if (message.includes('already registered') || message.includes('already exists') || message.includes('already been registered')) {
    return 'account_exists';
  }
  if (message.includes('rate limit') || message.includes('too many')) return 'rate_limited';
  if (name === 'TypeError' && (message.includes('fetch') || message.includes('network'))) return 'network';
  if (message.includes('network') || message.includes('failed to fetch') || message.includes('offline')) return 'network';
  if (message.includes('not found')) return 'not_found';
  if (message.includes('unauthorized') || message.includes('forbidden')) return 'forbidden';
  if (message.includes('invalid') || message.includes('required') || message.includes('must be')) return 'validation';
  return 'unknown';
}

/** Buckets a workout duration so minutes are never sent. */
export function durationBand(minutes: number | null | undefined): DurationBand | undefined {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  if (minutes < 15) return 'lt_15';
  if (minutes < 30) return '15_30';
  if (minutes < 60) return '30_60';
  return '60_plus';
}

/** Web billing products are identified by plan; product_id mirrors the plan key. */
export function planFromProductId(value: string | null | undefined): Plan | undefined {
  if (value === 'monthly' || value === 'annual' || value === 'lifetime') return value;
  return undefined;
}
