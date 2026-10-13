import { describe, expect, it } from 'vitest';

import { toClientBeverageEntry } from '@/lib/validation/beverage-log-validation';

import { toClientActivityType } from '../engagement-streak-service';

describe('toClientActivityType', () => {
  it('passes the types the apps know', () => {
    for (const type of ['weight_log', 'steps_log', 'streak_freeze', 'streak_checkin', 'freeze_earned']) {
      expect(toClientActivityType(type)).toBe(type);
    }
  });

  it('maps the types iOS cannot decode', () => {
    expect(toClientActivityType('freeze_used')).toBe('streak_freeze');
    expect(toClientActivityType('exercise_log')).toBe('streak_checkin');
    expect(toClientActivityType('something_new')).toBe('streak_checkin');
  });
});

describe('toClientBeverageEntry', () => {
  it('sends 0 for missing nutrition numbers and {} for null customizations', () => {
    expect(
      toClientBeverageEntry({ id: 'b1', calories: null, caffeine_mg: null, sugar_g: null, customizations: null })
    ).toEqual({ id: 'b1', calories: 0, caffeine_mg: 0, sugar_g: 0, customizations: {} });
  });

  it('returns a complete row unchanged', () => {
    const row = { id: 'b1', calories: 5, caffeine_mg: 95, sugar_g: 0, customizations: { shots: 2 } };
    expect(toClientBeverageEntry(row)).toBe(row);
  });
});
