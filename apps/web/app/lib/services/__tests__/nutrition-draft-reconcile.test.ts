import { describe, expect, it } from 'vitest';

import {
  diffDraftAndFinal,
  nameSimilarity,
  normalizeItems,
  normalizeTotals,
} from '../nutrition-draft-reconcile';

// Draft items come from the server (camelCase NutritionDraftItem); final items are what the
// apps echo back in nutrition_data.items (snake_case SavedFoodItem / SavedFoodItemData).
const draft = [
  { name: 'grilled chicken breast', grams: 120, calories: 198, proteinG: 37 },
  { name: 'white rice', grams: 160, calories: 208, proteinG: 4 },
  { name: 'sour cream or yogurt', grams: 30, calories: 60, proteinG: 1 },
];

describe('normalizeItems / normalizeTotals', () => {
  it('reads both the draft shape and the client snake_case shape', () => {
    expect(normalizeItems(draft)[0]).toEqual({ name: 'grilled chicken breast', grams: 120, calories: 198 });
    expect(
      normalizeItems([{ name: 'White rice', serving_unit: 'cup', grams: '150', calories: 195, protein_g: 4 }]),
    ).toEqual([{ name: 'White rice', grams: 150, calories: 195 }]);
    expect(normalizeItems([{ quantity: 1 }, null, 'x', { name: '  ' }])).toEqual([]);
    expect(normalizeItems(undefined)).toEqual([]);
  });

  it('reads draft totals (proteinG) and entry totals (protein_g) alike', () => {
    expect(normalizeTotals({ calories: 466, proteinG: 42, carbsG: 50, fatG: 9 })).toEqual({
      calories: 466, protein_g: 42, carbs_g: 50, fat_g: 9,
    });
    expect(normalizeTotals({ calories: 400, protein_g: 30 })).toEqual({
      calories: 400, protein_g: 30, carbs_g: null, fat_g: null,
    });
    expect(normalizeTotals(null).calories).toBeNull();
  });
});

describe('nameSimilarity', () => {
  it('is token Dice, ignoring case, punctuation and short tokens', () => {
    expect(nameSimilarity('White Rice', 'white rice')).toBe(1);
    expect(nameSimilarity('grilled chicken breast', 'chicken breast')).toBeCloseTo(0.8);
    expect(nameSimilarity('eggplant', 'stuffed bitter gourd')).toBe(0);
    expect(nameSimilarity('', 'rice')).toBe(0);
  });
});

describe('diffDraftAndFinal', () => {
  const draftTotals = normalizeTotals({ calories: 466, proteinG: 42 });
  const d = normalizeItems(draft);

  it('accepted as-is: same items, same totals → not edited', () => {
    const final = normalizeItems([
      { name: 'grilled chicken breast', grams: 120, calories: 198 },
      { name: 'white rice', grams: 160, calories: 208 },
      { name: 'sour cream or yogurt', grams: 30, calories: 60 },
    ]);
    const diff = diffDraftAndFinal(d, final, draftTotals, normalizeTotals({ calories: 466 }));
    expect(diff).toEqual({
      itemsMatched: 3, itemsAdded: 0, itemsRemoved: 0, itemsRenamed: 0,
      kcalDeltaPct: 0, gramsDeltaPct: 0, wasEdited: false,
    });
  });

  it('counts added, removed, renamed and the portion / kcal deltas', () => {
    const final = normalizeItems([
      { name: 'Chicken breast', grams: 90, calories: 150 },          // matched (0.8), renamed, −25 % grams
      { name: 'white rice', grams: 160, calories: 208 },             // matched exactly
      { name: 'naan', grams: 80, calories: 260 },                    // added
      // 'sour cream or yogurt' removed
    ]);
    const diff = diffDraftAndFinal(d, final, draftTotals, normalizeTotals({ calories: 618 }));
    expect(diff.itemsMatched).toBe(2);
    expect(diff.itemsAdded).toBe(1);
    expect(diff.itemsRemoved).toBe(1);
    expect(diff.itemsRenamed).toBe(1);
    expect(diff.gramsDeltaPct).toBeCloseTo(12.5, 1); // mean of 25 % and 0 %
    expect(diff.kcalDeltaPct).toBeCloseTo(32.6, 1);
    expect(diff.wasEdited).toBe(true);
  });

  it('a kcal change within ±2 % is still "accepted" (rounding noise)', () => {
    const final = normalizeItems([
      { name: 'grilled chicken breast', grams: 120, calories: 200 },
      { name: 'white rice', grams: 160, calories: 210 },
      { name: 'sour cream or yogurt', grams: 30, calories: 61 },
    ]);
    const diff = diffDraftAndFinal(d, final, draftTotals, normalizeTotals({ calories: 471 }));
    expect(diff.kcalDeltaPct).toBeCloseTo(1.1, 1);
    expect(diff.wasEdited).toBe(false);
  });

  it('matches one-to-one: a duplicated final item counts as added, not double-matched', () => {
    const final = normalizeItems([
      { name: 'white rice', grams: 160 },
      { name: 'white rice', grams: 160 },
    ]);
    const diff = diffDraftAndFinal(normalizeItems([draft[1]]), final, draftTotals, normalizeTotals({}));
    expect(diff.itemsMatched).toBe(1);
    expect(diff.itemsAdded).toBe(1);
    expect(diff.kcalDeltaPct).toBeNull();
  });

  it('totals-only reconciliation (no item breakdown) scores the kcal delta', () => {
    const diff = diffDraftAndFinal(d, [], draftTotals, normalizeTotals({ calories: 350 }));
    expect(diff.itemsRemoved).toBe(3);
    expect(diff.kcalDeltaPct).toBeCloseTo(-24.9, 1);
    expect(diff.gramsDeltaPct).toBeNull();
    expect(diff.wasEdited).toBe(true);
  });
});
