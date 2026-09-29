import { describe, expect, it } from 'vitest';

import { parseLenient, safeParseLenient } from '../../validation/lenient-parse';
import { createGroupMealSchema, normalizeGroupMealBody } from '../group-meal';

const CIRCLE = '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23';
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const base = { fitcircleId: CIRCLE, name: 'Team lunch', mealType: 'lunch' };

const parse = (body: unknown) => parseLenient(createGroupMealSchema, normalizeGroupMealBody(body));

describe('group meal — flat macro keys (iOS + older Android builds)', () => {
  it('folds flat calories/proteinG/carbsG/fatG into the nested macros object', () => {
    const parsed = parse({ ...base, calories: 650, proteinG: 40, carbsG: 55, fatG: 22 });
    expect(parsed.macros).toEqual({ calories: 650, proteinG: 40, carbsG: 55, fatG: 22 });
  });

  it('keeps the macros the user did fill in when the others are null', () => {
    const parsed = parse({ ...base, calories: 650, proteinG: null, carbsG: null, fatG: null });
    expect(parsed.macros).toEqual({ calories: 650 });
  });

  it('a nested macros object always wins over flat keys', () => {
    const parsed = parse({
      ...base,
      calories: 1,
      macros: { calories: 500, proteinG: 30, carbsG: 40, fatG: 10 },
    });
    expect(parsed.macros).toEqual({ calories: 500, proteinG: 30, carbsG: 40, fatG: 10 });
  });

  it('uses the flat keys when macros is an explicit null', () => {
    const parsed = parse({ ...base, macros: null, calories: 300, proteinG: 10, carbsG: 20, fatG: 5 });
    expect(parsed.macros).toEqual({ calories: 300, proteinG: 10, carbsG: 20, fatG: 5 });
  });

  it('ignores unusable flat values instead of failing a request that used to succeed', () => {
    const parsed = parse({ ...base, calories: -5, proteinG: '40', carbsG: NaN, fatG: null });
    expect(parsed.macros).toBeUndefined();
    const mixed = parse({ ...base, calories: 400, proteinG: -1 });
    expect(mixed.macros).toEqual({ calories: 400 });
  });

  it('leaves a body without flat macros untouched (same object back)', () => {
    expect(normalizeGroupMealBody(base)).toBe(base);
    expect(normalizeGroupMealBody(null)).toBeNull();
    expect(normalizeGroupMealBody('x')).toBe('x');
  });
});

describe('group meal — request shapes accepted before still behave the same', () => {
  it('nested macros with all four values (web + current Android)', () => {
    const parsed = parse({
      ...base,
      restaurantName: 'Nopa',
      macros: { calories: 500, proteinG: 30, carbsG: 40, fatG: 10 },
      taggedUserIds: [USER],
    });
    expect(parsed).toEqual({
      ...base,
      restaurantName: 'Nopa',
      macros: { calories: 500, proteinG: 30, carbsG: 40, fatG: 10 },
      taggedUserIds: [USER],
    });
  });

  it('a tag-only meal without macros', () => {
    expect(parse(base)).toEqual({ ...base, taggedUserIds: [] });
  });

  it('still rejects negative nested macros, a bad circle id and a missing name', () => {
    expect(
      safeParseLenient(createGroupMealSchema, { ...base, macros: { calories: -1 } }).success
    ).toBe(false);
    expect(safeParseLenient(createGroupMealSchema, { ...base, fitcircleId: 'nope' }).success).toBe(
      false
    );
    expect(
      safeParseLenient(createGroupMealSchema, { fitcircleId: CIRCLE, mealType: 'lunch' }).success
    ).toBe(false);
  });
});

describe('group meal — explicit nulls', () => {
  it('treats null optional fields as "not sent"', () => {
    const parsed = parse({
      ...base,
      restaurantName: null,
      photoUrl: null,
      macros: null,
      taggedUserIds: null,
    });
    expect(parsed).toEqual({ ...base, taggedUserIds: [] });
  });

  it('accepts a partial nested macros object with nulls', () => {
    const parsed = parse({ ...base, macros: { calories: 420, proteinG: null } });
    expect(parsed.macros).toEqual({ calories: 420, proteinG: null });
  });
});
