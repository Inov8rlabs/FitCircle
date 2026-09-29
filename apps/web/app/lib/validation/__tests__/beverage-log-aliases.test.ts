import { describe, expect, it } from 'vitest';

import {
  CreateBeverageLogSchema,
  UpdateBeverageLogSchema,
  toClientBeverageCustomizations,
  toClientBeverageEntry,
} from '../beverage-log-validation';
import { parseLenient, safeParseLenient } from '../lenient-parse';

const base = { category: 'coffee', beverage_type: 'latte', volume_ml: 590 };

describe('beverage customisation enums — both spellings accepted', () => {
  it('accepts the spellings the mobile apps send: extraLarge / room / cream', () => {
    const parsed = parseLenient(CreateBeverageLogSchema, {
      ...base,
      customizations: { size: 'extraLarge', temperature: 'room', milk_type: 'cream' },
    });
    expect(parsed.customizations).toEqual({
      size: 'extraLarge',
      temperature: 'room',
      milk_type: 'cream',
    });
  });

  it('still accepts the backend spellings: extra_large / room_temp (old request shape)', () => {
    const parsed = parseLenient(CreateBeverageLogSchema, {
      ...base,
      customizations: { size: 'extra_large', temperature: 'room_temp', milk_type: '2_percent' },
    });
    expect(parsed.customizations).toEqual({
      size: 'extra_large',
      temperature: 'room_temp',
      milk_type: '2_percent',
    });
  });

  it('accepts both spellings on update too', () => {
    expect(
      parseLenient(UpdateBeverageLogSchema, { customizations: { size: 'extraLarge' } }).customizations
    ).toEqual({ size: 'extraLarge' });
    expect(
      parseLenient(UpdateBeverageLogSchema, { customizations: { temperature: 'room_temp' } })
        .customizations
    ).toEqual({ temperature: 'room_temp' });
    expect(
      parseLenient(UpdateBeverageLogSchema, { customizations: { milk_type: 'cream' } }).customizations
    ).toEqual({ milk_type: 'cream' });
  });

  it('every previously valid value is still valid', () => {
    for (const size of ['small', 'medium', 'large', 'extra_large']) {
      expect(
        safeParseLenient(CreateBeverageLogSchema, { ...base, customizations: { size } }).success
      ).toBe(true);
    }
    for (const temperature of ['hot', 'cold', 'iced', 'room_temp']) {
      expect(
        safeParseLenient(CreateBeverageLogSchema, { ...base, customizations: { temperature } }).success
      ).toBe(true);
    }
    for (const milk_type of ['whole', 'skim', '2_percent', 'oat', 'almond', 'soy', 'coconut', 'none']) {
      expect(
        safeParseLenient(CreateBeverageLogSchema, { ...base, customizations: { milk_type } }).success
      ).toBe(true);
    }
  });

  it('still rejects values that are in neither spelling', () => {
    expect(
      safeParseLenient(CreateBeverageLogSchema, { ...base, customizations: { size: 'huge' } }).success
    ).toBe(false);
    expect(
      safeParseLenient(CreateBeverageLogSchema, { ...base, customizations: { temperature: 'warm' } })
        .success
    ).toBe(false);
    expect(
      safeParseLenient(CreateBeverageLogSchema, { ...base, customizations: { milk_type: 'goat' } })
        .success
    ).toBe(false);
  });

  it('accepts the exact body the submitted iOS build posts', () => {
    const parsed = parseLenient(CreateBeverageLogSchema, {
      category: 'coffee',
      beverage_type: 'latte',
      customizations: {
        size: 'extraLarge',
        milk_type: 'cream',
        sweetener: 'sugar1',
        temperature: 'room',
        shots: 2,
      },
      volume_ml: 590,
      calories: 310,
      caffeine_mg: 312,
      sugar_g: 4,
      is_favorite: false,
      is_private: true,
      logged_at: '2026-09-28T10:00:00Z',
    });
    expect(parsed.customizations?.size).toBe('extraLarge');
    expect(parsed.volume_ml).toBe(590);
  });

  it('treats explicit nulls on optional fields as "not sent"', () => {
    const parsed = parseLenient(CreateBeverageLogSchema, {
      ...base,
      notes: null,
      favorite_name: null,
      calories: null,
      customizations: { size: 'large', shots: null, alcohol_type: null, brand: null },
    });
    expect(parsed).toEqual({ ...base, customizations: { size: 'large' } });
  });
});

describe('toClientBeverageCustomizations — the spelling stored and returned', () => {
  it('maps the backend spellings to the ones iOS and Android decode', () => {
    expect(
      toClientBeverageCustomizations({ size: 'extra_large', temperature: 'room_temp', shots: 1 })
    ).toEqual({ size: 'extraLarge', temperature: 'room', shots: 1 });
  });

  it('returns the same object when nothing needs mapping', () => {
    const c = { size: 'extraLarge', temperature: 'room', milk_type: 'cream', brand: 'x' };
    expect(toClientBeverageCustomizations(c)).toBe(c);
    const empty = {};
    expect(toClientBeverageCustomizations(empty)).toBe(empty);
  });

  it('passes unknown keys, other values and non-objects through untouched', () => {
    expect(
      toClientBeverageCustomizations({ size: 'large', temperature: 'cold', custom_key: [1, 2] })
    ).toEqual({ size: 'large', temperature: 'cold', custom_key: [1, 2] });
    expect(toClientBeverageCustomizations(null)).toBeNull();
    expect(toClientBeverageCustomizations(undefined)).toBeUndefined();
    expect(toClientBeverageCustomizations('x')).toBe('x');
    expect(toClientBeverageCustomizations({ size: 7 })).toEqual({ size: 7 });
  });

  it('never returns a spelling the mobile enums cannot decode for size / room temperature', () => {
    const iosSizes = ['small', 'medium', 'large', 'extraLarge'];
    for (const size of ['small', 'medium', 'large', 'extra_large', 'extraLarge']) {
      const out = toClientBeverageCustomizations({ size }) as { size: string };
      expect(iosSizes).toContain(out.size);
    }
    expect((toClientBeverageCustomizations({ temperature: 'room_temp' }) as any).temperature).toBe(
      'room'
    );
  });
});

describe('toClientBeverageEntry', () => {
  it('rewrites only the customizations of a row', () => {
    const row = {
      id: 'b1',
      category: 'tea',
      beverage_type: 'green_tea',
      customizations: { size: 'extra_large' },
      volume_ml: 590,
    };
    expect(toClientBeverageEntry(row)).toEqual({
      ...row,
      customizations: { size: 'extraLarge' },
    });
  });

  it('returns rows that need no change, and null, as they are', () => {
    const row = { id: 'b1', customizations: { size: 'small' } };
    expect(toClientBeverageEntry(row)).toBe(row);
    const bare = { id: 'b2' };
    expect(toClientBeverageEntry(bare)).toBe(bare);
    expect(toClientBeverageEntry(null)).toBeNull();
  });
});
