import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }));

import { ChallengeError } from '@/lib/services/circle-challenge-service';
import { unhandledChallengeError } from '@/lib/http/circle-challenge-errors';
import { failFrom } from '@/lib/referrals/http';

import {
  GENERIC_ERROR_MESSAGE,
  errorMessageOf,
  isDatabaseError,
  isDeliberateError,
  isNotFoundDatabaseError,
  logIgnoredQueryError,
  reportRouteError,
} from '../route-errors';

const relationshipError = {
  code: 'PGRST200',
  details: "Searched for a foreign key relationship between 'challenge_participants' and 'profiles'",
  hint: null,
  message: "Could not find a relationship between 'challenge_participants' and 'profiles' in the schema cache",
};

describe('route-errors', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureException.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('reportRouteError', () => {
    it('5xx: logs the full error with the route label, reports to Sentry, returns the generic message', () => {
      const message = reportRouteError('fitcircles/[id]/challenges GET', relationshipError);

      expect(message).toBe(GENERIC_ERROR_MESSAGE);
      expect(message).not.toContain('relationship');
      expect(errorSpy).toHaveBeenCalledWith('[route] fitcircles/[id]/challenges GET failed (500 PGRST200):', relationshipError);
      expect(captureException).toHaveBeenCalledTimes(1);
      const [err, ctx] = captureException.mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('PostgrestError');
      expect((err as Error).message).toContain('Could not find a relationship');
      expect(ctx.tags).toEqual({ route: 'fitcircles/[id]/challenges GET', code: 'PGRST200' });
      expect(ctx.extra).toMatchObject({ status: 500, db_code: 'PGRST200' });
    });

    it('uses the explicit code tag and passes Error instances through unchanged', () => {
      const boom = new TypeError('x is undefined');
      reportRouteError('mobile/x', boom, { code: 'INTERNAL', status: 502, extra: { k: 1 } });
      const [err, ctx] = captureException.mock.calls[0];
      expect(err).toBe(boom);
      expect(ctx.tags).toEqual({ route: 'mobile/x', code: 'INTERNAL' });
      expect(ctx.extra).toMatchObject({ status: 502, k: 1 });
    });

    it('4xx: warns, does not report to Sentry, returns the error message', () => {
      const message = reportRouteError('mobile/x', new Error('This challenge is invite-only'), { status: 400, code: 'ERROR' });
      expect(message).toBe('This challenge is invite-only');
      expect(warnSpy).toHaveBeenCalledWith('[route] mobile/x → 400 ERROR: This challenge is invite-only');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
    });

    it('never throws when Sentry throws', () => {
      captureException.mockImplementation(() => {
        throw new Error('sentry down');
      });
      expect(reportRouteError('r', new Error('x'))).toBe(GENERIC_ERROR_MESSAGE);
    });

    it('handles non-Error throwables', () => {
      expect(reportRouteError('r', 'plain string')).toBe(GENERIC_ERROR_MESSAGE);
      expect((captureException.mock.calls[0][0] as Error).name).toBe('NonErrorThrown');
      expect(reportRouteError('r', undefined)).toBe(GENERIC_ERROR_MESSAGE);
    });
  });

  describe('classifiers', () => {
    it('isDatabaseError recognises PostgREST shapes but not app errors', () => {
      expect(isDatabaseError(relationshipError)).toBe(true);
      expect(isDatabaseError({ code: '23505', message: 'dup' })).toBe(true);
      expect(isDatabaseError(new Error('Only the creator can cancel this challenge'))).toBe(false);
      expect(isDatabaseError(new ChallengeError('NOT_FOUND', 'Challenge not found', 404))).toBe(false);
      expect(isDatabaseError({ code: 'ERROR', message: 'x' })).toBe(false);
      expect(isDatabaseError(null)).toBe(false);
    });

    it('isDeliberateError: plain/typed Errors yes; DB errors, runtime bugs, empty messages no', () => {
      expect(isDeliberateError(new Error('This challenge is invite-only'))).toBe(true);
      expect(isDeliberateError(new ChallengeError('FORBIDDEN', 'nope', 403))).toBe(true);
      expect(isDeliberateError(relationshipError)).toBe(false);
      expect(isDeliberateError(Object.assign(new Error('dup'), { code: '23505', details: 'x' }))).toBe(false);
      expect(isDeliberateError(new TypeError('fetch failed'))).toBe(false);
      expect(isDeliberateError(new Error(''))).toBe(false);
    });

    it('isNotFoundDatabaseError: PGRST116 and 22P02 only', () => {
      expect(isNotFoundDatabaseError({ code: 'PGRST116', message: 'no rows', details: null, hint: null })).toBe(true);
      expect(isNotFoundDatabaseError({ code: '22P02', message: 'invalid uuid', details: null, hint: null })).toBe(true);
      expect(isNotFoundDatabaseError(relationshipError)).toBe(false);
    });

    it('errorMessageOf', () => {
      expect(errorMessageOf(new Error('a'))).toBe('a');
      expect(errorMessageOf({ message: 'b' })).toBe('b');
      expect(errorMessageOf('c')).toBe('c');
      expect(errorMessageOf(42)).toBe('unknown error');
    });
  });

  describe('logIgnoredQueryError', () => {
    it('logs a tolerated query error, skips null and PGRST116', () => {
      logIgnoredQueryError('Svc.method', null);
      logIgnoredQueryError('Svc.method', { code: 'PGRST116', message: 'no rows' });
      expect(errorSpy).not.toHaveBeenCalled();
      logIgnoredQueryError('Svc.method', relationshipError);
      expect(errorSpy).toHaveBeenCalledWith('[service] Svc.method query failed (ignored):', relationshipError);
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe('mappers built on it', () => {
    it('unhandledChallengeError keeps deliberate messages at 400 and hides DB text behind a 500', async () => {
      const deliberate = unhandledChallengeError(new Error('This challenge is invite-only'), 'r');
      expect(deliberate.status).toBe(400);
      expect(await deliberate.json()).toEqual({
        success: false,
        data: null,
        error: { code: 'ERROR', message: 'This challenge is invite-only' },
      });

      const notFound = unhandledChallengeError({ code: 'PGRST116', message: 'JSON object requested', details: null, hint: null }, 'r');
      expect(notFound.status).toBe(400);
      expect((await notFound.json()).error).toEqual({ code: 'ERROR', message: 'Not found' });

      const db = unhandledChallengeError(relationshipError, 'r');
      expect(db.status).toBe(500);
      expect(await db.json()).toEqual({
        success: false,
        data: null,
        error: { code: 'INTERNAL_SERVER_ERROR', message: GENERIC_ERROR_MESSAGE },
      });
      expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('failFrom reports unexpected errors and keeps its envelope', async () => {
      const res = failFrom(relationshipError, 'campaigns/admin-list');
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred');
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException.mock.calls[0][1].tags.route).toBe('campaigns/admin-list');
    });
  });
});
