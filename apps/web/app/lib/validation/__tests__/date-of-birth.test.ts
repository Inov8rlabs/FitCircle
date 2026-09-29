import { describe, expect, it } from 'vitest';

import { isCalendarDate, isDateOfBirthInput, isFutureCalendarDate, normalizeDateOfBirth } from '../date-of-birth';

describe('normalizeDateOfBirth', () => {
  describe('rule 1: calendar date (what Android sends, and the only format accepted before)', () => {
    it('returns the date unchanged, whatever the zone or stored value', () => {
      expect(normalizeDateOfBirth('1984-09-26')).toBe('1984-09-26');
      expect(normalizeDateOfBirth('1984-09-26', { timeZone: 'Pacific/Honolulu' })).toBe('1984-09-26');
      expect(normalizeDateOfBirth('1984-09-26', { timeZone: 'Pacific/Kiritimati', storedDate: '1990-01-01' })).toBe(
        '1984-09-26'
      );
    });

    it('rejects a date that does not exist', () => {
      expect(normalizeDateOfBirth('2000-02-30')).toBeNull();
      expect(normalizeDateOfBirth('2000-13-01')).toBeNull();
      expect(normalizeDateOfBirth('2000-02-29')).toBe('2000-02-29'); // leap year
      expect(normalizeDateOfBirth('1900-02-29')).toBeNull(); // not a leap year
    });
  });

  describe('rule 2: datetime with its own offset, or no zone', () => {
    it('uses the date part of the string: it is the local wall-clock date', () => {
      expect(normalizeDateOfBirth('2000-05-14T00:00:00+05:30')).toBe('2000-05-14');
      expect(normalizeDateOfBirth('2000-05-14T00:00:00-07:00')).toBe('2000-05-14');
      expect(normalizeDateOfBirth('2000-05-14T23:30:00-0700')).toBe('2000-05-14');
      expect(normalizeDateOfBirth('2000-05-14T00:00:00')).toBe('2000-05-14');
    });

    it('is not moved by the client zone header', () => {
      expect(normalizeDateOfBirth('2000-05-14T00:00:00+05:30', { timeZone: 'America/Los_Angeles' })).toBe(
        '2000-05-14'
      );
    });
  });

  describe('rule 3b: UTC instant + the zone the date was picked in (the iOS request)', () => {
    it('UTC-negative: midnight in Los Angeles (UTC-7) is 07:00Z the SAME day', () => {
      expect(normalizeDateOfBirth('2000-05-14T07:00:00Z', { timeZone: 'America/Los_Angeles' })).toBe('2000-05-14');
    });

    it('UTC-negative, winter offset: midnight PST (UTC-8) is 08:00Z', () => {
      expect(normalizeDateOfBirth('1990-01-15T08:00:00Z', { timeZone: 'America/Los_Angeles' })).toBe('1990-01-15');
    });

    it('UTC-negative, picked in the evening: 18:00 in Los Angeles is already the next day in UTC', () => {
      // The string's own date part (15) would be wrong here.
      expect(normalizeDateOfBirth('2000-05-15T01:00:00Z', { timeZone: 'America/Los_Angeles' })).toBe('2000-05-14');
    });

    it('UTC-negative, far west: midnight in Honolulu (UTC-10)', () => {
      expect(normalizeDateOfBirth('1984-09-26T10:00:00Z', { timeZone: 'Pacific/Honolulu' })).toBe('1984-09-26');
    });

    it('UTC-positive: midnight in Kolkata (UTC+5:30) is 18:30Z the PREVIOUS day', () => {
      // The string's own date part (13) would be wrong here.
      expect(normalizeDateOfBirth('2000-05-13T18:30:00Z', { timeZone: 'Asia/Kolkata' })).toBe('2000-05-14');
    });

    it('UTC-positive, far east: midnight in Kiritimati (UTC+14)', () => {
      expect(normalizeDateOfBirth('2000-05-13T10:00:00Z', { timeZone: 'Pacific/Kiritimati' })).toBe('2000-05-14');
    });

    it('uses the offset the zone had on that date, like the device calendar does', () => {
      // Kiritimati was UTC-10:40 until 1994: midnight on 1984-09-26 was 10:40Z the same day.
      expect(normalizeDateOfBirth('1984-09-26T10:40:00Z', { timeZone: 'Pacific/Kiritimati' })).toBe('1984-09-26');
    });

    it('UTC itself', () => {
      expect(normalizeDateOfBirth('2000-05-14T00:00:00Z', { timeZone: 'UTC' })).toBe('2000-05-14');
      expect(normalizeDateOfBirth('2000-05-14T00:00:00Z', { timeZone: 'Europe/London' })).toBe('2000-05-14'); // BST, 01:00 local
    });

    it('accepts fractional seconds and +00:00', () => {
      expect(normalizeDateOfBirth('2000-05-14T07:00:00.000Z', { timeZone: 'America/Los_Angeles' })).toBe(
        '2000-05-14'
      );
      expect(normalizeDateOfBirth('2000-05-13T18:30:00+00:00', { timeZone: 'Asia/Kolkata' })).toBe('2000-05-14');
    });

    it('round trip: what GET /profile returns comes back as the same date, in every zone', () => {
      // iOS decodes "YYYY-MM-DD" as local midnight and encodes that instant in UTC.
      const cases: Array<[zone: string, sent: string]> = [
        ['America/Los_Angeles', '1984-09-26T07:00:00Z'],
        ['America/New_York', '1984-09-26T04:00:00Z'],
        ['America/Sao_Paulo', '1984-09-26T03:00:00Z'],
        ['Europe/Berlin', '1984-09-25T23:00:00Z'],
        ['Asia/Kolkata', '1984-09-25T18:30:00Z'],
        ['Asia/Tokyo', '1984-09-25T15:00:00Z'],
        ['Australia/Sydney', '1984-09-25T14:00:00Z'],
      ];
      for (const [timeZone, sent] of cases) {
        expect(normalizeDateOfBirth(sent, { timeZone, storedDate: '1984-09-26' }), timeZone).toBe('1984-09-26');
      }
    });
  });

  describe('rule 3a: exactly 00:00:00Z that equals the stored date (echo of the auth responses)', () => {
    it('does not shift the date for a user behind UTC', () => {
      // login/session return date_of_birth as "2000-05-14T00:00:00.000Z".
      expect(
        normalizeDateOfBirth('2000-05-14T00:00:00Z', { timeZone: 'America/Los_Angeles', storedDate: '2000-05-14' })
      ).toBe('2000-05-14');
    });

    it('only applies to the stored date: a new pick is read in the client zone', () => {
      expect(
        normalizeDateOfBirth('2000-05-21T00:00:00Z', { timeZone: 'America/Los_Angeles', storedDate: '2000-05-14' })
      ).toBe('2000-05-20');
    });

    it('only applies to exact UTC midnight', () => {
      // Kolkata user moving the date forward by one day: stored 13, picked 14.
      expect(
        normalizeDateOfBirth('2000-05-13T18:30:00Z', { timeZone: 'Asia/Kolkata', storedDate: '2000-05-13' })
      ).toBe('2000-05-14');
    });
  });

  describe('rule 3c/3d: UTC instant, zone unknown', () => {
    it('UTC-negative local midnight (<= 12:00Z): the date part of the string', () => {
      expect(normalizeDateOfBirth('2000-05-14T07:00:00Z')).toBe('2000-05-14'); // Los Angeles
      expect(normalizeDateOfBirth('2000-05-14T03:30:00Z')).toBe('2000-05-14'); // Newfoundland (UTC-3:30)
      expect(normalizeDateOfBirth('2000-05-14T00:00:00Z')).toBe('2000-05-14'); // UTC
    });

    it('UTC-positive local midnight (> 12:00Z): the next day', () => {
      expect(normalizeDateOfBirth('2000-05-13T18:30:00Z')).toBe('2000-05-14'); // Kolkata
      expect(normalizeDateOfBirth('2000-05-13T22:00:00Z')).toBe('2000-05-14'); // Berlin (summer)
      expect(normalizeDateOfBirth('2000-12-31T23:00:00Z')).toBe('2001-01-01'); // year boundary
    });

    it('an invalid zone header is treated as unknown', () => {
      expect(normalizeDateOfBirth('2000-05-13T18:30:00Z', { timeZone: 'Not/AZone' })).toBe('2000-05-14');
    });

    it('not a local midnight: the date part of the string', () => {
      expect(normalizeDateOfBirth('2000-05-14T18:41:07Z')).toBe('2000-05-14');
    });
  });

  it('rejects anything that is not a date or datetime', () => {
    for (const bad of ['', 'yesterday', '14/05/2000', '2000-5-14', '2000-05-14T25:00:00Z', '2000-02-30T00:00:00Z', '2000-05-14T00:00:00+99:00']) {
      expect(normalizeDateOfBirth(bad), bad).toBeNull();
      expect(isDateOfBirthInput(bad), bad).toBe(false);
    }
  });
});

describe('isCalendarDate / isFutureCalendarDate', () => {
  it('validates real dates', () => {
    expect(isCalendarDate('1984-09-26')).toBe(true);
    expect(isCalendarDate('1984-09-31')).toBe(false);
    expect(isCalendarDate('1984-9-26')).toBe(false);
  });

  it('compares against now as UTC midnight, like the route always did', () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    expect(isFutureCalendarDate('2026-09-28', now)).toBe(false);
    expect(isFutureCalendarDate('2026-09-29', now)).toBe(true);
    expect(isFutureCalendarDate('1984-09-26', now)).toBe(false);
  });
});
