import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { FoodDTO, FoodPortionDTO } from '../../types/foods';
import type { ParsedFoodItem } from '../../types/nutrition';
import { FoodsService } from '../foods-service';
import { NutritionGroundingService } from '../nutrition-grounding-service';

const item = (over: Partial<ParsedFoodItem> = {}): ParsedFoodItem => ({
  name: 'fresh banana',
  quantity: 1,
  quantityRange: null,
  servingUnit: 'medium banana',
  grams: 118,
  gramsPerUnit: 118,
  calories: 105,
  proteinG: 1.3,
  carbsG: 27,
  fatG: 0.4,
  fiberG: 3.1,
  sugarG: 14,
  sodiumMg: 1,
  confidence: 0.9,
  ...over,
});

const food = (over: Partial<FoodDTO> & { name: string }): FoodDTO => ({
  id: over.id ?? `id-${over.name}`,
  source: 'usda',
  brand: null,
  barcode: null,
  servingSizeG: null,
  servingUnit: null,
  per100g: { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6, sugarG: 12.2, sodiumMg: 1 },
  locale: 'en-US',
  isCustom: false,
  dataType: 'sr_legacy',
  category: 'Fruits and Fruit Juices',
  ...over,
});

const portion = (unit: string, gramWeight: number, amount = 1): FoodPortionDTO => ({
  id: Math.random(),
  foodId: 'x',
  amount,
  unit,
  description: `${amount} ${unit}`,
  gramWeight,
});

describe('NutritionGroundingService.portionPrior', () => {
  it('uses the median weight when USDA lists several rows for one unit', () => {
    const toast = item({ name: 'toast', servingUnit: 'slice', quantity: 1, gramsPerUnit: 60, grams: 60 });
    const rows = [portion('slice', 15), portion('slice', 28), portion('slice', 38)];
    expect(NutritionGroundingService.portionPrior(toast, rows)).toEqual({ grams: 28, gramsPerUnit: 28, quantity: 1, corrected: true });
  });

  it('keeps the model grams when the unit is unknown to USDA or within 50% of the USDA weight', () => {
    const it1 = item({ servingUnit: 'cup', quantity: 1, gramsPerUnit: 200, grams: 200 });
    expect(NutritionGroundingService.portionPrior(it1, []).corrected).toBe(false);
    expect(NutritionGroundingService.portionPrior(it1, [portion('cup', 158)])).toMatchObject({ grams: 200, corrected: false });
    // The classic "cup = 240 g for everything" habit is corrected for cooked rice (158 g).
    const it2 = item({ servingUnit: 'cup', quantity: 1, gramsPerUnit: 240, grams: 240 });
    expect(NutritionGroundingService.portionPrior(it2, [portion('cup', 158)])).toEqual({ grams: 158, gramsPerUnit: 158, quantity: 1, corrected: true });
  });

  it('corrects a wildly wrong unit weight to the USDA weight, keeping the quantity', () => {
    // "1 cup" of cooked rice called 400 g by the model; USDA says 158 g.
    const rice = item({ name: 'white rice', servingUnit: 'cup', quantity: 1.5, gramsPerUnit: 400, grams: 600 });
    const p = NutritionGroundingService.portionPrior(rice, [portion('cup', 158)]);
    expect(p).toEqual({ grams: 237, gramsPerUnit: 158, quantity: 1.5, corrected: true });
  });

  it('maps natural units ("medium banana", "slices") onto USDA unit labels', () => {
    expect(NutritionGroundingService.normalizeUnit('medium banana')).toBe('medium');
    expect(NutritionGroundingService.normalizeUnit('Slices')).toBe('slice');
    expect(NutritionGroundingService.normalizeUnit('Tablespoons')).toBe('tbsp');
    expect(NutritionGroundingService.normalizeUnit('katori')).toBeNull();
    expect(NutritionGroundingService.normalizeUnit('g')).toBe('g');
  });

  it('never applies a prior to gram units or zero quantities', () => {
    const g = item({ servingUnit: 'g', quantity: 500, gramsPerUnit: 1, grams: 500 });
    expect(NutritionGroundingService.portionPrior(g, [portion('g', 1)]).corrected).toBe(false);
    const z = item({ servingUnit: 'cup', quantity: 0, gramsPerUnit: 0, grams: 80 });
    expect(NutritionGroundingService.portionPrior(z, [portion('cup', 158)])).toMatchObject({ grams: 80, corrected: false });
  });
});

describe('NutritionGroundingService.apply', () => {
  it('keeps the model macros when its density is plausible, attaches the row and USDA units', () => {
    const banana = food({ name: 'Banana, raw', id: 'banana' });
    const out = NutritionGroundingService.apply(item(), banana, [portion('medium', 118), portion('cup', 150)]);
    expect(out.matchedFoodId).toBe('banana');
    expect(out.itemSource).toBe('foods_db');
    expect(out.calories).toBe(105); // model's own (89 kcal/100 g vs row 89 → within clamp)
    expect(out.proteinG).toBe(1.3);
    expect(out.sodiumMg).toBe(1);
    expect(out.confidence).toBe(0.9);
    expect(out.unitOptions.map((u) => u.label)).toEqual(['medium banana', 'g', 'oz', 'medium', 'cup']);
  });

  it('replaces the macros with the row density when the model density is >2× off', () => {
    const banana = food({ name: 'Banana, raw', id: 'banana' });
    const hallucinated = item({ calories: 490, proteinG: 8.4, sodiumMg: 0 }); // 415 kcal/100 g for a banana
    const out = NutritionGroundingService.apply(hallucinated, banana, []);
    expect(out.calories).toBe(105); // 89 × 1.18
    expect(out.proteinG).toBe(1.3); // 1.1 × 1.18
    expect(out.sodiumMg).toBe(1.2);
    expect(out.confidence).toBe(0.6);
  });

  it('fills sodium from the row only when the model gave none', () => {
    const banana = food({ name: 'Banana, raw', id: 'banana' });
    expect(NutritionGroundingService.apply(item({ sodiumMg: 0 }), banana, []).sodiumMg).toBe(1.2);
    const noSodiumRow = food({ name: 'Banana, raw', per100g: { calories: 89, proteinG: 1, carbsG: 22, fatG: 0.3, fiberG: 2.6, sugarG: 12 } });
    expect(NutritionGroundingService.apply(item({ sodiumMg: 7 }), noSodiumRow, []).sodiumMg).toBe(7);
  });

  it('applies the portion prior only when enabled', () => {
    const rice = food({ name: 'Rice, white, cooked', id: 'rice', per100g: { calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: 0.4, sugarG: 0, sodiumMg: 1 } });
    const it240 = item({ name: 'white rice', servingUnit: 'cup', quantity: 1, gramsPerUnit: 240, grams: 240, calories: 312, proteinG: 6.5, sodiumMg: 2 });
    const off = NutritionGroundingService.apply(it240, rice, [portion('cup', 158)]);
    expect(off.grams).toBe(240);
    expect(off.calories).toBe(312);
    const on = NutritionGroundingService.apply(it240, rice, [portion('cup', 158)], { portionPrior: true });
    expect(on.grams).toBe(158);
    expect(on.calories).toBe(205.4); // model macros rescaled to the corrected grams (312 × 158/240)
    expect(on.unitOptions[0]).toEqual({ label: 'cup', gramsPerUnit: 158 });
  });
});

describe('NutritionGroundingService.pickLexically (picker fallback)', () => {
  it('only accepts a near-exact token match, so "banana" never lands on "banana nut muffin"', () => {
    const picks = NutritionGroundingService.pickLexically(
      [item({ name: 'raw banana' }), item({ name: 'cherry tomatoes' })],
      [[food({ name: 'Banana nut muffin' }), food({ name: 'Banana, raw' })], [food({ name: 'Tomatoes, sun-dried' })]],
    );
    expect(picks).toEqual([1, null]);
  });
});

describe('NutritionGroundingService.ground', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('grounds with the picker, applies portions, and leaves unpicked items on the model numbers', async () => {
    const banana = food({ name: 'Banana, raw', id: 'banana' });
    vi.spyOn(FoodsService, 'searchGeneric').mockImplementation(async (_u, q) =>
      q.includes('banana') ? [food({ name: 'Banana nut muffin', id: 'muffin', per100g: { calories: 416, proteinG: 7, carbsG: 50, fatG: 20, fiberG: 1, sugarG: 30 } }), banana] : [],
    );
    vi.spyOn(FoodsService, 'portionsFor').mockResolvedValue(new Map([['banana', [portion('medium', 118)]]]));
    const pick = vi.fn(async () => [1, null]);
    const { items, stats } = await NutritionGroundingService.ground('u', [item(), item({ name: 'mystery curry', grams: 150, calories: 300 })], { mode: 'generic', pick });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(items[0]).toMatchObject({ matchedFoodId: 'banana', itemSource: 'foods_db', calories: 105 });
    expect(items[1]).toMatchObject({ matchedFoodId: null, itemSource: 'llm_vision', calories: 300 });
    expect(stats).toMatchObject({ mode: 'generic', candidates: 2, grounded: 1, replaced: 0, pickerUsed: true, pickerFailed: false, dbKcalPer100g: [89, null] });
  });

  it('falls back to strict lexical picking when the picker throws', async () => {
    vi.spyOn(FoodsService, 'searchGeneric').mockResolvedValue([food({ name: 'Banana, raw', id: 'banana' })]);
    vi.spyOn(FoodsService, 'portionsFor').mockResolvedValue(new Map());
    const { items, stats } = await NutritionGroundingService.ground('u', [item({ name: 'banana raw' })], {
      mode: 'generic',
      pick: async () => { throw new Error('gateway down'); },
    });
    expect(stats.pickerFailed).toBe(true);
    expect(items[0].matchedFoodId).toBe('banana');
  });

  it('mode off returns the model numbers without touching the DB', async () => {
    const search = vi.spyOn(FoodsService, 'searchGeneric');
    const { items, stats } = await NutritionGroundingService.ground('u', [item()], { mode: 'off' });
    expect(search).not.toHaveBeenCalled();
    expect(items[0]).toMatchObject({ matchedFoodId: null, itemSource: 'llm_vision', calories: 105 });
    expect(stats.grounded).toBe(0);
  });
});

describe('FoodsService.contentTokens (retrieval stems)', () => {
  it('stems plurals so query and USDA names agree, and drops filler/size words', () => {
    expect(FoodsService.contentTokens('Scrambled eggs with hot sauce')).toEqual(['scrambled', 'egg', 'hot', 'sauce']);
    expect(FoodsService.contentTokens('Tomatoes, cherry, raw')).toEqual(['tomato', 'cherry', 'raw']);
    expect(FoodsService.contentTokens('cherries, raw')).toEqual(['cherry', 'raw']);
    expect(FoodsService.contentTokens('2 medium slices of fresh bread')).toEqual(['bread']);
    expect(FoodsService.contentTokens('Rice, white, cooked, NS as to fat')).toEqual(['rice', 'white', 'cooked', 'fat']);
  });
});
