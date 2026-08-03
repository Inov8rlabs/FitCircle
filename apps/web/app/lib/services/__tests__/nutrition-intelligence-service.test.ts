import { afterEach, describe, expect, it, vi } from 'vitest';

import { NutritionIntelligenceService } from '../nutrition-intelligence-service';
import { UsageService } from '../usage-service';

const parsedItem = {
  name: 'Chicken biryani',
  quantity: 2,
  quantityRange: null,
  servingUnit: 'cup',
  grams: 480,
  gramsPerUnit: 240,
  calories: 720,
  proteinG: 36,
  carbsG: 96,
  fatG: 24,
  fiberG: 6,
  sugarG: 4,
  sodiumMg: 1_200,
  confidence: 0.9,
};

describe('NutritionIntelligenceService.resolveItemPortion', () => {
  it('repairs the contradictory cup payload produced by older iOS clients', () => {
    expect(NutritionIntelligenceService.resolveItemPortion(2, 2, 'cup')).toEqual({
      grams: 480,
      quantity: 2,
      servingUnit: 'cup',
    });
  });

  it('preserves a plausible food-density conversion supplied by the client', () => {
    expect(NutritionIntelligenceService.resolveItemPortion(320, 2, 'cups')).toEqual({
      grams: 320,
      quantity: 2,
      servingUnit: 'cups',
    });
  });

  it('normalizes common units when grams are absent', () => {
    expect(NutritionIntelligenceService.resolveItemPortion(undefined, 3, 'tbsp')).toEqual({
      grams: 45,
      quantity: 3,
      servingUnit: 'tbsp',
    });
  });

  it('leaves count-based portions for the model to weigh', () => {
    expect(NutritionIntelligenceService.resolveItemPortion(undefined, 2, 'pieces')).toEqual({
      grams: undefined,
      quantity: 2,
      servingUnit: 'pieces',
    });
  });
});

describe('NutritionIntelligenceService.estimateItem', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses a bounded fallback when the primary model times out', async () => {
    const service = NutritionIntelligenceService as any;
    vi.spyOn(service, 'getCachedResult').mockResolvedValue(null);
    vi.spyOn(UsageService, 'assertFoodAiQuota').mockResolvedValue(undefined);
    vi.spyOn(service, 'recordParse').mockResolvedValue(undefined);
    vi.spyOn(service, 'finalizeEstimatedItem').mockResolvedValue(parsedItem);
    const callModel = vi
      .spyOn(service, 'callItemModel')
      .mockRejectedValueOnce(new Error('primary timeout'))
      .mockResolvedValueOnce(parsedItem);

    await NutritionIntelligenceService.estimateItem('user-1', 'Chicken biryani', 2, 2, 'cup');

    expect(callModel).toHaveBeenNthCalledWith(
      1,
      'anthropic/claude-haiku-4.5',
      'user-1',
      'Chicken biryani',
      '2 cup, 480 g total',
      15_000,
    );
    expect(callModel).toHaveBeenNthCalledWith(
      2,
      'google/gemini-3-flash',
      'user-1',
      'Chicken biryani',
      '2 cup, 480 g total',
      20_000,
    );
  });
});
