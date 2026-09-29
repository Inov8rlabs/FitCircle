import { describe, expect, it } from 'vitest';

import {
  CreateFoodLogEntrySchema,
  UpdateFoodLogEntrySchema,
  normalizeFoodLogEntryAliases,
} from '../food-log-validation';
import { parseLenient, safeParseLenient } from '../lenient-parse';

const create = (body: unknown) =>
  parseLenient(CreateFoodLogEntrySchema, normalizeFoodLogEntryAliases(body));
const update = (body: unknown) =>
  parseLenient(UpdateFoodLogEntrySchema, normalizeFoodLogEntryAliases(body));

describe('food-log entry_type "snack" alias', () => {
  it('iOS 1.0 manual Snack (entry_type snack, no meal_type) becomes food + meal_type snack', () => {
    const parsed = create({
      entry_type: 'snack',
      notes: 'Apple',
      is_private: false,
      logged_at: '2026-09-28T10:00:00Z',
    });
    expect(parsed.entry_type).toBe('food');
    expect(parsed.meal_type).toBe('snack');
    expect(parsed.notes).toBe('Apple');
  });

  it('keeps another meal_type the client sent with entry_type snack', () => {
    const parsed = create({ entry_type: 'snack', meal_type: 'lunch' });
    expect(parsed).toMatchObject({ entry_type: 'food', meal_type: 'lunch' });
  });

  it('treats a null or blank meal_type as "not sent"', () => {
    expect(create({ entry_type: 'snack', meal_type: null }).meal_type).toBe('snack');
    expect(create({ entry_type: 'snack', meal_type: '' }).meal_type).toBe('snack');
  });

  it('never stores or returns the value "snack" as entry_type', () => {
    const result = safeParseLenient(CreateFoodLogEntrySchema, { entry_type: 'snack' });
    // Without the alias the schema itself still has no `snack` entry type.
    expect(result.success).toBe(false);
    expect(create({ entry_type: 'snack' }).entry_type).toBe('food');
  });

  it('on update sets meal_type snack and sends no entry_type to the service', () => {
    const parsed = update({ entry_type: 'snack', notes: 'Trail mix' });
    expect(parsed).toEqual({ meal_type: 'snack', notes: 'Trail mix' });
    expect(update({ entry_type: 'snack', meal_type: 'dinner' })).toEqual({ meal_type: 'dinner' });
  });

  it('leaves every other body untouched (same object back)', () => {
    const food = { entry_type: 'food', meal_type: 'breakfast' };
    expect(normalizeFoodLogEntryAliases(food)).toBe(food);
    const water = { entry_type: 'water', water_ml: 250 };
    expect(normalizeFoodLogEntryAliases(water)).toBe(water);
    expect(normalizeFoodLogEntryAliases(null)).toBeNull();
    expect(normalizeFoodLogEntryAliases('snack')).toBe('snack');
    expect(normalizeFoodLogEntryAliases([{ entry_type: 'snack' }])).toEqual([{ entry_type: 'snack' }]);
  });
});

describe('food-log request shapes accepted before still behave the same', () => {
  it('create: food / water / supplement', () => {
    expect(create({ entry_type: 'food', meal_type: 'dinner', notes: 'Pasta' })).toEqual({
      entry_type: 'food',
      meal_type: 'dinner',
      notes: 'Pasta',
    });
    expect(create({ entry_type: 'water', water_ml: 500 })).toEqual({
      entry_type: 'water',
      water_ml: 500,
    });
    expect(create({ entry_type: 'supplement', supplement_name: 'Vitamin D' })).toEqual({
      entry_type: 'supplement',
      supplement_name: 'Vitamin D',
    });
  });

  it('update: entry_type food is ignored exactly as before', () => {
    expect(update({ entry_type: 'food', meal_type: 'lunch', notes: 'x' })).toEqual({
      meal_type: 'lunch',
      notes: 'x',
    });
    expect(update({ notes: 'only notes' })).toEqual({ notes: 'only notes' });
  });

  it('still rejects what was rejected: food without meal_type, unknown entry types', () => {
    expect(safeParseLenient(CreateFoodLogEntrySchema, { entry_type: 'food' }).success).toBe(false);
    expect(
      safeParseLenient(
        CreateFoodLogEntrySchema,
        normalizeFoodLogEntryAliases({ entry_type: 'dessert', meal_type: 'snack' })
      ).success
    ).toBe(false);
    expect(
      safeParseLenient(
        CreateFoodLogEntrySchema,
        normalizeFoodLogEntryAliases({ entry_type: 'water' })
      ).success
    ).toBe(false);
  });
});

describe('food-log explicit nulls', () => {
  it('create accepts nulls on optional fields (older Android builds encode them)', () => {
    const parsed = create({
      entry_type: 'water',
      water_ml: 330,
      meal_type: null,
      notes: null,
      nutrition_data: null,
      supplement_name: null,
      supplement_dosage: null,
    });
    expect(parsed).toEqual({ entry_type: 'water', water_ml: 330 });
  });

  it('create drops nulls inside nutrition_data but keeps the breakdown', () => {
    const parsed = create({
      entry_type: 'food',
      meal_type: 'lunch',
      nutrition_data: { calories: 400, protein_g: null, items: [{ name: 'Rice', grams: 150 }] },
    });
    expect(parsed.nutrition_data).toEqual({ calories: 400, items: [{ name: 'Rice', grams: 150 }] });
  });

  it('update treats a null as "field not sent"', () => {
    expect(update({ notes: null, meal_type: 'dinner' })).toEqual({ meal_type: 'dinner' });
  });
});
