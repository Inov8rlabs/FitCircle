import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPauseRequest } from '../pause-request';
import { readJsonBody } from '../request-body';

// 2026-09-28 23:30 in Los Angeles is already 2026-09-29 in UTC.
const NOW = new Date('2026-09-29T06:30:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('readPauseRequest', () => {
  it('reads the date-only resume_date Android sends', () => {
    expect(readPauseRequest({ resume_date: '2026-10-06' }, 'UTC')).toEqual({
      ok: true,
      resumeDate: '2026-10-06',
      source: 'resume_date',
    });
  });

  it('reads the ISO-8601 instant iOS sends as the day the user picked', () => {
    // Picked 5 October, 23:30 local; the instant is already 6 October in UTC.
    const body = { resume_date: '2026-10-06T06:30:00Z' };
    expect(readPauseRequest(body, 'America/Los_Angeles')).toMatchObject({
      ok: true,
      resumeDate: '2026-10-05',
    });
  });

  it('keeps the historical reading (date part of the string) without a timezone', () => {
    expect(readPauseRequest({ resume_date: '2026-10-06T06:30:00Z' })).toMatchObject({
      ok: true,
      resumeDate: '2026-10-06',
    });
    expect(readPauseRequest({ resume_date: '2026-10-06T06:30:00Z' }, 'Not/AZone')).toMatchObject({
      ok: true,
      resumeDate: '2026-10-06',
    });
  });

  it('falls back to the date part when the local reading would refuse a request that used to pass', () => {
    // 28 September 09:00 in Los Angeles; the picker held "today, 23:30".
    vi.setSystemTime(new Date('2026-09-28T16:00:00Z'));
    expect(
      readPauseRequest({ resume_date: '2026-09-29T06:30:00Z' }, 'America/Los_Angeles')
    ).toEqual({ ok: true, resumeDate: '2026-09-29', source: 'resume_date' });
  });

  it('computes the resume date from the old Android `days` field', () => {
    expect(readPauseRequest({ days: 7 }, 'UTC')).toEqual({
      ok: true,
      resumeDate: '2026-10-06',
      source: 'days',
    });
    // The user's today is still 28 September in Los Angeles.
    expect(readPauseRequest({ days: 7 }, 'America/Los_Angeles')).toMatchObject({
      resumeDate: '2026-10-05',
    });
    expect(readPauseRequest({ days: '14' }, 'UTC')).toMatchObject({ resumeDate: '2026-10-13' });
  });

  it('caps `days` at 90', () => {
    expect(readPauseRequest({ days: 365 }, 'UTC')).toMatchObject({
      ok: true,
      resumeDate: '2026-12-28',
      source: 'days',
    });
  });

  it('prefers resume_date over days', () => {
    expect(readPauseRequest({ resume_date: '2026-10-01', days: 30 }, 'UTC')).toMatchObject({
      resumeDate: '2026-10-01',
      source: 'resume_date',
    });
  });

  it('uses days when resume_date is null or empty', () => {
    expect(readPauseRequest({ resume_date: null, days: 3 }, 'UTC')).toMatchObject({
      resumeDate: '2026-10-02',
      source: 'days',
    });
    expect(readPauseRequest({ resume_date: '', days: 3 }, 'UTC')).toMatchObject({ source: 'days' });
  });

  it('ignores a `days` value that is not a whole number of days, as before', () => {
    for (const days of [0, -3, 'soon', null, true, {}, Number.NaN]) {
      expect(readPauseRequest({ days }, 'UTC')).toEqual({
        ok: true,
        resumeDate: undefined,
        source: 'default',
      });
    }
  });

  it('has no resume date for an empty body', () => {
    expect(readPauseRequest({}, 'UTC')).toEqual({ ok: true, resumeDate: undefined, source: 'default' });
    expect(readPauseRequest({ reason: 'Injury' }, 'UTC')).toMatchObject({ source: 'default' });
  });

  it('refuses today, the past, more than 90 days and unreadable dates', () => {
    expect(readPauseRequest({ resume_date: '2026-09-29' }, 'UTC')).toMatchObject({
      ok: false,
      code: 'RESUME_DATE_NOT_IN_FUTURE',
      error: 'Resume date must be in the future',
    });
    expect(readPauseRequest({ resume_date: '2026-09-01' }, 'UTC')).toMatchObject({
      code: 'RESUME_DATE_NOT_IN_FUTURE',
    });
    expect(readPauseRequest({ resume_date: '2026-12-29' }, 'UTC')).toMatchObject({
      ok: false,
      code: 'PAUSE_TOO_LONG',
      error: 'Resume date cannot be more than 90 days in the future',
    });
    expect(readPauseRequest({ resume_date: '2026-12-28' }, 'UTC')).toMatchObject({ ok: true });
    expect(readPauseRequest({ resume_date: 'next week' }, 'UTC')).toMatchObject({
      ok: false,
      code: 'INVALID_RESUME_DATE',
    });
    expect(readPauseRequest({ resume_date: 20261006 }, 'UTC')).toMatchObject({
      code: 'INVALID_RESUME_DATE',
    });
  });
});

describe('readJsonBody', () => {
  const post = (body?: string) =>
    new Request('http://localhost/x', { method: 'POST', body });

  it('reads an object', async () => {
    expect(await readJsonBody(post('{"a":1,"b":null}'))).toEqual({ a: 1, b: null });
  });

  it('reads an absent, empty, malformed or non-object body as {}', async () => {
    expect(await readJsonBody(post())).toEqual({});
    expect(await readJsonBody(post(''))).toEqual({});
    expect(await readJsonBody(post('   '))).toEqual({});
    expect(await readJsonBody(post('{not json'))).toEqual({});
    expect(await readJsonBody(post('[1,2]'))).toEqual({});
    expect(await readJsonBody(post('"text"'))).toEqual({});
    expect(await readJsonBody(post('null'))).toEqual({});
  });
});
