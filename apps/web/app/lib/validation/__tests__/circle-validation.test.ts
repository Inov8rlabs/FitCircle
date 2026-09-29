import { describe, expect, it } from 'vitest';

import {
  createCircleSchema,
  isFlexibleDate,
  isSameMoment,
  isUuid,
  normalizeCreateCircleBody,
  normalizeId,
  normalizeUpdateCircleBody,
  normalizeVisibility,
  toCalendarDate,
  updateCircleSchema,
} from '../circle-validation';
import { parseLenient, safeParseLenient } from '../lenient-parse';

describe('isFlexibleDate', () => {
  it('accepts YYYY-MM-DD and ISO 8601 datetimes', () => {
    for (const value of [
      '2026-09-28',
      '2026-09-28T19:12:33Z', // Swift JSONEncoder .iso8601
      '2026-09-28T19:12:33.123Z',
      '2026-09-28T19:12:33+00:00', // what Supabase returns
      '2026-09-28T19:12:33.123456+00:00',
      '2026-09-28T12:12:33-07:00',
      '2026-09-28T19:12:33',
    ]) {
      expect(isFlexibleDate(value), value).toBe(true);
    }
  });

  it('rejects what is not a date', () => {
    for (const value of ['', 'tomorrow', '28/09/2026', '2026-13-01', '2026-02-30', '2026-09-28T25:00:00Z', 20260928, null]) {
      expect(isFlexibleDate(value), String(value)).toBe(false);
    }
  });
});

describe('toCalendarDate', () => {
  it('returns a plain date unchanged, whatever the timezone', () => {
    expect(toCalendarDate('2026-09-28', 'America/Los_Angeles')).toBe('2026-09-28');
    expect(toCalendarDate('2026-09-28', null)).toBe('2026-09-28');
  });

  it('uses the date part of a datetime when the client timezone is unknown', () => {
    expect(toCalendarDate('2026-09-29T01:30:00Z', null)).toBe('2026-09-29');
    expect(toCalendarDate('2026-09-28T23:30:00-07:00')).toBe('2026-09-28');
  });

  it("uses the client's local day when the timezone is known", () => {
    // 01:30 UTC on the 29th is still the evening of the 28th in Los Angeles.
    expect(toCalendarDate('2026-09-29T01:30:00Z', 'America/Los_Angeles')).toBe('2026-09-28');
    // ...and already the 29th in Kolkata.
    expect(toCalendarDate('2026-09-28T20:30:00Z', 'Asia/Kolkata')).toBe('2026-09-29');
  });

  it('falls back to the date part for a timezone Intl does not know', () => {
    expect(toCalendarDate('2026-09-29T01:30:00Z', 'Mars/Olympus')).toBe('2026-09-29');
  });
});

describe('isSameMoment', () => {
  it('treats different spellings of one instant as the same', () => {
    expect(isSameMoment('2026-10-01T00:00:00Z', '2026-10-01T00:00:00+00:00')).toBe(true);
    expect(isSameMoment('2026-10-01', '2026-10-01T00:00:00+00:00')).toBe(true);
    expect(isSameMoment('2026-10-01T02:00:00+02:00', '2026-10-01T00:00:00Z')).toBe(true);
  });

  it('ignores the fractional seconds Swift drops when it re-encodes a date', () => {
    expect(isSameMoment('2026-10-01T12:34:56Z', '2026-10-01T12:34:56.789+00:00')).toBe(true);
  });

  it('sees a real change, and never equates unreadable values', () => {
    expect(isSameMoment('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z')).toBe(false);
    expect(isSameMoment('2026-10-01T00:00:01Z', '2026-10-01T00:00:00Z')).toBe(false);
    expect(isSameMoment('2026-10-01T00:00:00Z', null)).toBe(false);
    expect(isSameMoment(undefined, undefined)).toBe(false);
  });
});

describe('normalizeVisibility', () => {
  it('accepts the three stored values in any case', () => {
    expect(normalizeVisibility('private')).toBe('private');
    expect(normalizeVisibility('PUBLIC')).toBe('public');
    expect(normalizeVisibility('invite_only')).toBe('invite_only');
    expect(normalizeVisibility('Invite Only')).toBe('invite_only');
  });

  it('ignores anything else instead of failing', () => {
    for (const value of [undefined, null, '', 'friends_only', 'secret', 3, true, {}]) {
      expect(normalizeVisibility(value), String(value)).toBeUndefined();
    }
  });
});

describe('create circle body', () => {
  const parse = (body: unknown) => parseLenient(createCircleSchema, normalizeCreateCircleBody(body));

  it('OLD SHAPE (Android): camelCase keys and YYYY-MM-DD dates parse exactly as before', () => {
    expect(
      parse({
        name: 'Steps',
        description: 'Walk more',
        type: 'step_count',
        startDate: '2026-10-10',
        endDate: '2026-11-09',
        allowLateJoin: true,
        lateJoinDeadline: 3,
      })
    ).toEqual({
      name: 'Steps',
      description: 'Walk more',
      type: 'step_count',
      startDate: '2026-10-10',
      endDate: '2026-11-09',
      allowLateJoin: true,
      lateJoinDeadline: 3,
    });
  });

  it('iOS SHAPE: snake_case keys and ISO datetimes (CreateCircleRequest)', () => {
    const parsed = parse({
      name: 'Morning Crew',
      type: 'weight_loss',
      visibility: 'private',
      start_date: '2026-09-28T19:12:33Z',
      end_date: '2026-10-28T19:12:33Z',
      min_participants: 2,
    });

    expect(parsed).toMatchObject({
      name: 'Morning Crew',
      type: 'weight_loss',
      visibility: 'private',
      startDate: '2026-09-28T19:12:33Z',
      endDate: '2026-10-28T19:12:33Z',
    });
    expect(parsed).not.toHaveProperty('min_participants');
  });

  it('accepts snake_case late-join fields too', () => {
    expect(
      parse({ name: 'x', startDate: '2026-10-10', endDate: '2026-11-09', allow_late_join: false, late_join_deadline: 5 })
    ).toMatchObject({ allowLateJoin: false, lateJoinDeadline: 5 });
  });

  it('lets the camelCase key win when both spellings are sent', () => {
    expect(
      parse({ name: 'x', startDate: '2026-10-10', start_date: '2026-01-01', endDate: '2026-11-09' }).startDate
    ).toBe('2026-10-10');
  });

  it('maps the legacy iOS ChallengeType values onto the stored enum', () => {
    const base = { name: 'x', startDate: '2026-10-10', endDate: '2026-11-09' };
    expect(parse({ ...base, type: 'weight' }).type).toBe('weight_loss');
    expect(parse({ ...base, type: 'check_in' }).type).toBe('custom');
    expect(parse(base).type).toBeUndefined();
  });

  it('treats explicit nulls on optional fields as not sent', () => {
    const parsed = parse({
      name: 'x',
      description: null,
      type: null,
      visibility: null,
      startDate: '2026-10-10',
      endDate: '2026-11-09',
      allowLateJoin: null,
      lateJoinDeadline: null,
    });
    expect(parsed).toMatchObject({ name: 'x', startDate: '2026-10-10', endDate: '2026-11-09' });
    expect(parsed.description).toBeUndefined();
    expect(parsed.type).toBeUndefined();
    expect(parsed.allowLateJoin).toBeUndefined();
    expect(normalizeVisibility(parsed.visibility)).toBeUndefined();
  });

  it('does not reject an unknown visibility (it used to be dropped silently)', () => {
    const result = safeParseLenient(
      createCircleSchema,
      normalizeCreateCircleBody({ name: 'x', startDate: '2026-10-10', endDate: '2026-11-09', visibility: 'friends_only' })
    );
    expect(result.success).toBe(true);
  });

  it('still requires a name and both dates, and still rejects a bad type', () => {
    const base = { name: 'x', startDate: '2026-10-10', endDate: '2026-11-09' };
    const fails = (body: unknown) =>
      !safeParseLenient(createCircleSchema, normalizeCreateCircleBody(body)).success;

    expect(fails({ ...base, name: '' })).toBe(true);
    expect(fails({ ...base, name: null })).toBe(true);
    expect(fails({ name: 'x', endDate: '2026-11-09' })).toBe(true);
    expect(fails({ ...base, startDate: null })).toBe(true);
    expect(fails({ ...base, endDate: 'soon' })).toBe(true);
    expect(fails({ ...base, type: 'yoga' })).toBe(true);
    expect(fails({ ...base, lateJoinDeadline: 45 })).toBe(true);
  });
});

describe('update circle body', () => {
  const parse = (body: unknown) => parseLenient(updateCircleSchema, normalizeUpdateCircleBody(body));
  const fails = (body: unknown) =>
    !safeParseLenient(updateCircleSchema, normalizeUpdateCircleBody(body)).success;

  it('OLD SHAPE: name, description and an ISO end_date parse as before', () => {
    expect(parse({ name: 'New name', description: 'New', end_date: '2026-11-09T00:00:00Z' })).toEqual({
      name: 'New name',
      description: 'New',
      end_date: '2026-11-09T00:00:00Z',
    });
  });

  it('iOS SHAPE: start_date is read instead of dropped (UpdateCircleRequest)', () => {
    expect(parse({ start_date: '2026-10-01T00:00:00Z', end_date: '2026-11-09T00:00:00Z' })).toEqual({
      start_date: '2026-10-01T00:00:00Z',
      end_date: '2026-11-09T00:00:00Z',
    });
  });

  it('accepts camelCase aliases, plain dates and zone offsets', () => {
    expect(parse({ startDate: '2026-10-01', endDate: '2026-11-09T00:00:00+02:00' })).toMatchObject({
      start_date: '2026-10-01',
      end_date: '2026-11-09T00:00:00+02:00',
    });
  });

  it('keeps an empty description (it means "clear") and drops a null one', () => {
    expect(parse({ description: '' })).toEqual({ description: '' });
    expect(parse({ description: null, name: null, start_date: null, end_date: null })).toEqual({});
  });

  it('still enforces the limits it always had', () => {
    expect(fails({ name: 'ab' })).toBe(true);
    expect(fails({ name: 'x'.repeat(101) })).toBe(true);
    expect(fails({ description: 'x'.repeat(501) })).toBe(true);
    expect(fails({ end_date: 'next week' })).toBe(true);
    expect(fails({ end_date: '' })).toBe(true);
  });
});

describe('ids', () => {
  it('recognises uuids in either case and lowercases them for comparison', () => {
    expect(isUuid('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(true);
    expect(isUuid('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true);
    expect(isUuid('nope')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(normalizeId(' AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA ')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
