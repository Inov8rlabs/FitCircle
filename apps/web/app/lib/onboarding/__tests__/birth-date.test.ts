import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { birthDateFields, birthDateUpdate, ESTIMATE_KEY, parseBirthDate, refineBirthDate } from '../birth-date';

const NOW = new Date('2026-10-28T12:00:00Z');
const schema = z.object(birthDateFields).superRefine((v, ctx) => refineBirthDate(v, ctx, NOW));

describe('validation', () => {
  it('birthYear: age 13–100 this year', () => {
    expect(schema.safeParse({ birthYear: 1990 }).success).toBe(true);
    expect(schema.safeParse({ birthYear: 2013 }).success).toBe(true); // 13
    expect(schema.safeParse({ birthYear: 2014 }).success).toBe(false); // 12
    expect(schema.safeParse({ birthYear: 1926 }).success).toBe(true); // 100
    expect(schema.safeParse({ birthYear: 1925 }).success).toBe(false);
    expect(schema.safeParse({ birthYear: 1990.5 }).success).toBe(false);
    expect(schema.safeParse({ birthYear: '1990' }).success).toBe(false);
  });

  it('dateOfBirth: a real YYYY-MM-DD, age 13–100 today', () => {
    expect(schema.safeParse({ dateOfBirth: '1990-02-28' }).success).toBe(true);
    expect(schema.safeParse({ dateOfBirth: '1990-02-30' }).success).toBe(false);
    expect(schema.safeParse({ dateOfBirth: '1990-02-28T00:00:00Z' }).success).toBe(false);
    expect(schema.safeParse({ dateOfBirth: '2013-10-29' }).success).toBe(false); // 12 until tomorrow
    expect(schema.safeParse({ dateOfBirth: '2013-10-28' }).success).toBe(true);
  });

  it('absent / null is fine', () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.safeParse({ birthYear: null, dateOfBirth: null }).success).toBe(true);
  });
});

describe('parseBirthDate', () => {
  it('year → YYYY-07-01; full date wins when both are sent', () => {
    expect(parseBirthDate({ birthYear: 1990 })).toEqual({ date: '1990-07-01', precision: 'year' });
    expect(parseBirthDate({ birthYear: 1990, dateOfBirth: '1990-03-04' })).toEqual({ date: '1990-03-04', precision: 'day' });
    expect(parseBirthDate({})).toBeNull();
  });
});

describe('birthDateUpdate', () => {
  const year = { date: '1990-07-01', precision: 'year' as const };
  const full = { date: '1990-03-04', precision: 'day' as const };

  it('year onto an empty profile: stored with the estimate marker', () => {
    expect(birthDateUpdate({ date_of_birth: null, preferences: { a: 1 } }, year)).toEqual({
      date_of_birth: '1990-07-01',
      preferences: { a: 1, [ESTIMATE_KEY]: { from: 'birth_year', date: '1990-07-01' } },
    });
  });

  it('a year never overwrites a full date', () => {
    expect(birthDateUpdate({ date_of_birth: '1985-11-12', preferences: {} }, year)).toBeNull();
    // A stored 07-01 the user entered as a full date (no marker) is a full date too.
    expect(birthDateUpdate({ date_of_birth: '1985-07-01', preferences: {} }, year)).toBeNull();
    // Marker stale: the date was changed elsewhere (PUT /profile) after the estimate.
    expect(birthDateUpdate({ date_of_birth: '1985-11-12', preferences: { [ESTIMATE_KEY]: { from: 'birth_year', date: '1985-07-01' } } }, year)).toBeNull();
  });

  it('a year replaces an earlier year estimate; unchanged writes nothing', () => {
    const prior = { date_of_birth: '1989-07-01', preferences: { [ESTIMATE_KEY]: { from: 'birth_year', date: '1989-07-01' } } };
    expect(birthDateUpdate(prior, year)?.date_of_birth).toBe('1990-07-01');
    const same = { date_of_birth: '1990-07-01T00:00:00+00:00', preferences: { [ESTIMATE_KEY]: { from: 'birth_year', date: '1990-07-01' } } };
    expect(birthDateUpdate(same, year)).toBeNull();
  });

  it('a full date always wins and clears the marker', () => {
    const prior = { date_of_birth: '1990-07-01', preferences: { x: 1, [ESTIMATE_KEY]: { from: 'birth_year', date: '1990-07-01' } } };
    expect(birthDateUpdate(prior, full)).toEqual({ date_of_birth: '1990-03-04', preferences: { x: 1 } });
    expect(birthDateUpdate({ date_of_birth: '1980-01-01', preferences: {} }, full)?.date_of_birth).toBe('1990-03-04');
    expect(birthDateUpdate({ date_of_birth: '1990-03-04', preferences: {} }, full)).toBeNull();
    // Same day as a year estimate (born 1 July): confirm it as a full date.
    expect(birthDateUpdate(prior, { date: '1990-07-01', precision: 'day' })).toEqual({ date_of_birth: '1990-07-01', preferences: { x: 1 } });
  });
});
