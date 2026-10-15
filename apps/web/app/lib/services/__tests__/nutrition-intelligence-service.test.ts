import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeAssumptions, textParseResultSchema } from '../../types/nutrition';
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

describe('normalizeAssumptions / textParseResultSchema.assumptions', () => {
  it('missing, null or garbage → []', () => {
    for (const bad of [undefined, null, 7, {}, { a: 1 }, true]) {
      expect(normalizeAssumptions(bad)).toEqual([]);
    }
    const parsed = textParseResultSchema.parse({ items: [parsedItem], overallConfidence: 0.9 });
    expect(parsed.assumptions).toEqual([]);
    expect(textParseResultSchema.parse({ items: [], overallConfidence: 0.2, assumptions: 'nope' as unknown }).assumptions)
      .toEqual(['nope']);
  });

  it('keeps strings only, trims bullets, drops blanks and duplicates, caps at 3', () => {
    expect(
      normalizeAssumptions(['- 2 large eggs', '', 5, null, '2 large eggs', '• Scrambled in 1 tsp butter', 'Whole milk', 'Extra']),
    ).toEqual(['2 large eggs', 'Scrambled in 1 tsp butter', 'Whole milk']);
  });

  it('cuts anything over 60 chars at a word boundary with an ellipsis', () => {
    const long = 'One standard restaurant plate of chicken biryani with raita and salan on the side';
    const [out] = normalizeAssumptions([long]);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });
});

describe('NutritionIntelligenceService.parseVoice', () => {
  afterEach(() => vi.restoreAllMocks());

  const stub = (assumptions?: unknown) => {
    const service = NutritionIntelligenceService as any;
    vi.spyOn(UsageService, 'assertFoodAiQuota').mockResolvedValue(undefined);
    vi.spyOn(service, 'recordParseLog').mockResolvedValue(undefined);
    vi.spyOn(service, 'groundItemsByMode').mockImplementation(async (...args: unknown[]) => ({
      items: (args[1] as any[]).map((it) => ({ ...it, matchedFoodId: null, itemSource: 'llm_vision', unitOptions: [] })),
    }));
    const parsed = textParseResultSchema.parse({
      items: [parsedItem],
      overallConfidence: 0.8,
      notes: null,
      ...(assumptions === undefined ? {} : { assumptions }),
    });
    return vi.spyOn(service, 'callVoiceModel').mockResolvedValue(parsed);
  };

  it('defaults to the voice prompt and returns [] assumptions when the model gave none', async () => {
    const call = stub();
    const draft = await NutritionIntelligenceService.parseVoice('user-1', 'chicken biryani');
    expect(call).toHaveBeenCalledWith('anthropic/claude-sonnet-4.6', 'user-1', 'chicken biryani', 15_000, 'voice');
    expect(draft.assumptions).toEqual([]);
    expect(draft.inputMethod).toBe('voice');
    expect(draft.nutritionSource).toBe('llm_voice');
  });

  it('passes source "text" through and returns the (capped) assumptions', async () => {
    const call = stub(['1 restaurant plate (~400 g)', 'Bone-in chicken', 'Cooked in 1 tbsp ghee', 'Fourth']);
    const draft = await NutritionIntelligenceService.parseVoice('user-1', 'chicken biryani', { source: 'text' });
    expect(call.mock.calls[0][4]).toBe('text');
    expect(draft.assumptions).toEqual(['1 restaurant plate (~400 g)', 'Bone-in chicken', 'Cooked in 1 tbsp ghee']);
    // Envelope shape is unchanged apart from the additive field.
    expect(draft.inputMethod).toBe('voice');
    expect(typeof draft.parseHash).toBe('string');
  });

  it('falls back to the second model with the same source', async () => {
    const call = stub([]);
    call.mockRejectedValueOnce(new Error('primary timeout'));
    await NutritionIntelligenceService.parseVoice('user-1', 'latte', { source: 'text' });
    expect(call).toHaveBeenNthCalledWith(2, 'google/gemini-3-flash', 'user-1', 'latte', 20_000, 'text');
  });

  it('the typed-text prompt talks about a description, not a transcript or speech', () => {
    const text = NutritionIntelligenceService.textParsePrompt('text');
    const voice = NutritionIntelligenceService.textParsePrompt('voice');
    expect(text).not.toMatch(/transcri|spoke|spoken/i);
    expect(text).toMatch(/typed/);
    expect(voice).toMatch(/transcript/);
    for (const p of [text, voice]) {
      expect(p).toMatch(/assumptions/);
      expect(p).toMatch(/"eggs", means 2/);
    }
  });

  it('repairTextJson rescues a near-miss reply and reads assumptions leniently', () => {
    const repaired = NutritionIntelligenceService.repairTextJson(
      '```json\n{"foods":[{"foodName":"eggs","quantity":2,"grams":100,"kcal":180}],"assumptions":["2 large eggs", 3]}\n```',
    );
    expect(repaired?.items[0].name).toBe('eggs');
    expect(repaired?.assumptions).toEqual(['2 large eggs']);
    expect(NutritionIntelligenceService.repairTextJson('[{"name":"latte","calories":190}]')?.assumptions).toEqual([]);
  });
});
