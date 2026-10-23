import { describe, expect, it } from 'vitest';

import {
  applyFilter,
  cardTitle,
  entryKind,
  entryMacros,
  formatWater,
  groupByDay,
  itemLines,
  type FeedEntry,
} from '../feed-model';

const NOW = new Date(2026, 9, 22, 18, 0); // Thu Oct 22 2026, local

const food = (id: string, date: string, time: string, extra: Partial<FeedEntry> = {}): FeedEntry => ({
  id,
  entry_type: 'food',
  entry_date: date,
  logged_at: `${date}T${time}:00`,
  meal_type: 'lunch',
  ...extra,
});
const water = (id: string, date: string, time: string, ml: number): FeedEntry => ({
  id,
  entry_type: 'water',
  entry_date: date,
  logged_at: `${date}T${time}:00`,
  water_ml: ml,
});
const bevWater = (id: string, date: string, ml: number, time = '11:00'): FeedEntry => ({
  id,
  category: 'water',
  entry_date: date,
  logged_at: `${date}T${time}:00`,
  volume_ml: ml,
});
const coffee = (id: string, date: string): FeedEntry => ({
  id,
  category: 'coffee',
  beverage_type: 'latte',
  entry_date: date,
  logged_at: `${date}T08:00:00`,
  volume_ml: 240,
});

describe('entryKind', () => {
  it('tells food-log rows from beverage rows', () => {
    expect(entryKind(food('a', '2026-10-22', '12:00'))).toBe('food');
    expect(entryKind({ id: 's', entry_type: 'supplement' })).toBe('food');
    expect(entryKind(water('w', '2026-10-22', '10:00', 250))).toBe('water');
    expect(entryKind(bevWater('b', '2026-10-22', 500))).toBe('water');
    expect(entryKind(coffee('c', '2026-10-22'))).toBe('beverage');
  });
});

describe('groupByDay', () => {
  const entries = [
    food('old', '2026-10-20', '12:00'),
    food('lunch', '2026-10-22', '12:30'),
    food('dinner', '2026-10-22', '19:30', { meal_type: 'dinner' }),
    water('w1', '2026-10-22', '09:00', 250),
    bevWater('w2', '2026-10-22', 500),
    water('w3', '2026-10-22', '15:00', 250),
    coffee('c', '2026-10-22'),
  ];

  it('orders days newest first and rows newest first within a day', () => {
    const groups = groupByDay(entries);
    expect(groups.map((g) => g.key)).toEqual(['2026-10-22', '2026-10-20']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['dinner', 'lunch', 'c']);
  });

  it("folds every water log of a day (food-log and beverage rows) into one card", () => {
    const [today] = groupByDay(entries);
    expect(today.water.map((w) => w.id)).toEqual(['w3', 'w2', 'w1']);
    expect(today.waterTotalMl).toBe(1000);
    expect(today.rows.some((r) => entryKind(r) === 'water')).toBe(false);
  });
});

describe('applyFilter', () => {
  const entries = [
    food('today', '2026-10-22', '12:00'),
    food('sixDaysAgo', '2026-10-16', '12:00'),
    food('lastMonth', '2026-09-30', '12:00'),
    food('older', '2026-08-01', '12:00'),
    water('w', '2026-10-22', '09:00', 250),
  ];
  const ids = (f: Parameters<typeof applyFilter>[1]) => applyFilter(entries, f, NOW).map((e) => e.id);

  it('filters by period', () => {
    expect(ids('all')).toHaveLength(5);
    expect(ids('today')).toEqual(['today', 'w']);
    expect(ids('week')).toEqual(['today', 'sixDaysAgo', 'w']);
    expect(ids('month')).toEqual(['today', 'sixDaysAgo', 'lastMonth', 'w']);
  });

  it('Meals Only drops water; Water keeps only water', () => {
    expect(ids('meals')).not.toContain('w');
    expect(ids('water')).toEqual(['w']);
  });
});

describe('meal card text', () => {
  it('uses the meal type as the title and the dish as detail', () => {
    expect(cardTitle(food('a', '2026-10-22', '12:00', { meal_type: 'dinner', title: 'Pad Thai' }))).toEqual({
      title: 'Dinner',
      detail: 'Pad Thai',
    });
    expect(cardTitle(coffee('c', '2026-10-22')).title).toBe('Latte');
  });

  it('builds iOS item lines with fractions and kcal, capped with a "+N more"', () => {
    const e = food('a', '2026-10-22', '12:00', {
      nutrition_data: {
        items: [
          { name: 'Veg tofu pad Thai', quantity: 0.75, serving_unit: 'cup', calories: 195.4 },
          { name: 'Metkut bhaat', quantity: 0.75, serving_unit: 'cup', calories: 181 },
          { name: 'Lime', quantity: 1, serving_unit: 'serving', calories: 2 },
        ],
      },
    });
    expect(itemLines(e)).toEqual({
      lines: ['¾ cup Veg tofu pad Thai (195 kcal)', '¾ cup Metkut bhaat (181 kcal)'],
      more: 1,
    });
  });

  it('reads macros from nutrition_data with top-level fallbacks', () => {
    expect(entryMacros(food('a', '2026-10-22', '12:00', { nutrition_data: { calories: 610, protein_g: 22 } }))).toMatchObject({
      kcal: 610,
      protein: 22,
    });
    expect(entryMacros(food('b', '2026-10-22', '12:00', { calories: 532, fat_g: 16 }))).toMatchObject({ kcal: 532, fat: 16 });
  });

  it('formats water like WaterDayCard', () => {
    expect(formatWater(250)).toBe('250 ml');
    expect(formatWater(1000)).toBe('1 L');
    expect(formatWater(1750)).toBe('1.75 L');
    expect(formatWater(2500)).toBe('2.5 L');
  });
});
