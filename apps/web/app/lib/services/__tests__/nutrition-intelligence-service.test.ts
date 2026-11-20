import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAssumptions, textParseResultSchema } from '../../types/nutrition';
import { NutritionIntelligenceService } from '../nutrition-intelligence-service';
import { UpgradeRequiredError, UsageService } from '../usage-service';

// No repeat of a counted analysis unless a test says so (and never a real DB read).
beforeEach(() => {
  vi.spyOn(UsageService, 'recentFoodAiCredit').mockResolvedValue(null);
});

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
    vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release: vi.fn() });
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

  let releaseSpy = vi.fn();
  const stub = (assumptions?: unknown) => {
    releaseSpy = vi.fn();
    const service = NutritionIntelligenceService as any;
    vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release: releaseSpy });
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

  it('success keeps the reserved credit; both models failing releases it (success-only counting)', async () => {
    const call = stub([]);
    await NutritionIntelligenceService.parseVoice('user-1', 'latte');
    expect(UsageService.reserveFoodAi).toHaveBeenCalledWith('user-1', expect.any(String), { jobId: undefined });
    expect(releaseSpy).not.toHaveBeenCalled();

    call.mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b'));
    await expect(NutritionIntelligenceService.parseVoice('user-1', 'latte')).rejects.toThrow('ParseFailed');
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('refused (free allowance used) → no model call at all', async () => {
    const call = stub([]);
    vi.mocked(UsageService.reserveFoodAi).mockRejectedValueOnce(new UpgradeRequiredError('food_ai_unlimited', 5, 5, true));
    await expect(NutritionIntelligenceService.parseVoice('user-1', 'latte')).rejects.toBeInstanceOf(UpgradeRequiredError);
    expect(call).not.toHaveBeenCalled();
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

describe('NutritionIntelligenceService.parsePhoto — lifetime free allowance (TRIAL_FIRST_SPEC §5)', () => {
  afterEach(() => vi.restoreAllMocks());
  const img = [{ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' }];
  const setup = () => {
    const service = NutritionIntelligenceService as any;
    const release = vi.fn();
    vi.spyOn(UsageService, 'assertFoodAiQuota').mockResolvedValue(undefined);
    const reserve = vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release });
    vi.spyOn(service, 'getCachedResult').mockResolvedValue(null);
    const record = vi.spyOn(service, 'recordParse').mockResolvedValue(undefined);
    vi.spyOn(service, 'toDraft').mockResolvedValue({ items: [], dbKcalPer100g: undefined });
    const model = vi.spyOn(service, 'callPhotoModel').mockResolvedValue({ result: { items: [parsedItem], overallConfidence: 0.9, notes: null }, usage: {} });
    return { service, release, reserve, record, model };
  };

  it('success: the reserved credit is kept and not logged twice', async () => {
    const { release, reserve, record } = setup();
    await NutritionIntelligenceService.parsePhoto('user-1', img, null);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith('user-1', expect.any(String), expect.anything(), { logged: true });
  });

  it('both models fail → credit released, ParseFailed (the route then saves the photo)', async () => {
    const { release, model } = setup();
    model.mockRejectedValue(new Error('down'));
    await expect(NutritionIntelligenceService.parsePhoto('user-1', img, null)).rejects.toThrow('ParseFailed');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('over the allowance: refused even for a cached result, and no model call', async () => {
    const { service, model, reserve } = setup();
    vi.mocked(UsageService.assertFoodAiQuota).mockRejectedValue(new UpgradeRequiredError('food_ai_unlimited', 5, 5, true));
    const cached = vi.mocked(service.getCachedResult);
    cached.mockResolvedValue({ items: [parsedItem], overallConfidence: 0.9, notes: null });
    await expect(NutritionIntelligenceService.parsePhoto('user-1', img, null)).rejects.toBeInstanceOf(UpgradeRequiredError);
    expect(cached).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('a "Fix" (refine) is a real analysis: reserved and kept', async () => {
    const { reserve, release, record } = setup();
    vi.spyOn(NutritionIntelligenceService as any, 'refinePromptBlock').mockReturnValue('fix');
    await NutritionIntelligenceService.parsePhoto('user-1', img, null, { refine: { correction: 'it was tofu', items: [] } as any });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled(); // never cached
  });
});

describe('NutritionIntelligenceService.estimateItem — allowance', () => {
  afterEach(() => vi.restoreAllMocks());
  it('both models fail → released; over allowance → refused before the cache', async () => {
    const service = NutritionIntelligenceService as any;
    const release = vi.fn();
    const assert = vi.spyOn(UsageService, 'assertFoodAiQuota').mockResolvedValue(undefined);
    vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release });
    const cache = vi.spyOn(service, 'getCachedResult').mockResolvedValue(null);
    vi.spyOn(service, 'callItemModel').mockRejectedValue(new Error('down'));
    await expect(NutritionIntelligenceService.estimateItem('user-1', 'Rice', 100)).rejects.toThrow('ParseFailed');
    expect(release).toHaveBeenCalledTimes(1);

    assert.mockRejectedValue(new UpgradeRequiredError('food_ai_unlimited', 5, 5, false));
    cache.mockClear();
    await expect(NutritionIntelligenceService.estimateItem('user-1', 'Rice', 100)).rejects.toBeInstanceOf(UpgradeRequiredError);
    expect(cache).not.toHaveBeenCalled();
  });
});

describe('repeat analyses are never counted twice (ENGAGEMENT_115_SPEC §14.4 item 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    (NutritionIntelligenceService as any).repeatWaitMs = 6_000;
  });
  const img = [{ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' }];
  const otherBytes = [{ bytes: Buffer.from([9, 9, 9]), mimeType: 'image/jpeg' }];
  const cachedResult = { items: [parsedItem], overallConfidence: 0.9, notes: null };
  const setup = () => {
    const service = NutritionIntelligenceService as any;
    const release = vi.fn();
    const assert = vi.spyOn(UsageService, 'assertFoodAiQuota').mockResolvedValue(undefined);
    const reserve = vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release });
    const cache = vi.spyOn(service, 'getCachedResult').mockResolvedValue(null);
    const record = vi.spyOn(service, 'recordParse').mockResolvedValue(undefined);
    vi.spyOn(service, 'toDraft').mockResolvedValue({ items: [], dbKcalPer100g: undefined });
    const model = vi.spyOn(service, 'callPhotoModel').mockResolvedValue({ result: cachedResult, usage: {} });
    const recent = vi.mocked(UsageService.recentFoodAiCredit);
    return { service, release, assert, reserve, cache, record, model, recent };
  };
  const justNow = () => new Date(Date.now() - 2_000).toISOString();

  it('photo: the job id is passed through to the credit', async () => {
    const { reserve, recent } = setup();
    await NutritionIntelligenceService.parsePhoto('user-1', img, null, { jobId: 'job-12345678' });
    expect(recent).toHaveBeenCalledWith('user-1', expect.any(String), 'job-12345678');
    expect(reserve).toHaveBeenCalledWith('user-1', expect.any(String), { jobId: 'job-12345678' });
  });

  it('photo: same job, re-encoded bytes, first result cached → that result, no credit, no paywall check', async () => {
    const { cache, reserve, model, assert, recent } = setup();
    recent.mockResolvedValue({ contentHash: 'firsthash', countedAt: justNow(), matchedBy: 'job' });
    cache.mockImplementation(async (...a: unknown[]) => (a[0] === "firsthash" ? cachedResult : null));
    const draft = await NutritionIntelligenceService.parsePhoto('user-1', otherBytes, null, { jobId: 'job-12345678' });
    expect(draft.parseHash).toBe('firsthash');
    expect(reserve).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(assert).not.toHaveBeenCalled();
  });

  it('photo: same job, different bytes, no cached first result → counted as a new analysis (a job id never unlocks free content)', async () => {
    const { reserve, model, recent, service } = setup();
    service.repeatWaitMs = 0;
    recent.mockResolvedValue({ contentHash: 'firsthash', countedAt: justNow(), matchedBy: 'job' });
    await NutritionIntelligenceService.parsePhoto('user-1', otherBytes, null, { jobId: 'job-12345678' });
    expect(model).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('photo: identical bytes while the first is still in flight → waits for its result (no second model call)', async () => {
    const { cache, reserve, model, recent, service } = setup();
    service.repeatWaitMs = 200;
    service.repeatPollMs = 10;
    let calls = 0;
    recent.mockImplementation(async (_u: string, hash: string) => ({ contentHash: hash, countedAt: justNow(), matchedBy: 'content' }));
    cache.mockImplementation(async () => (++calls >= 3 ? cachedResult : null));
    await NutritionIntelligenceService.parsePhoto('user-1', img, null);
    expect(model).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('photo: identical bytes, result never arrives → model runs again but uncounted (no reserve, no extra log row)', async () => {
    const { reserve, model, recent, record, service } = setup();
    service.repeatWaitMs = 0;
    recent.mockImplementation(async (_u: string, hash: string) => ({ contentHash: hash, countedAt: justNow(), matchedBy: 'content' }));
    await NutritionIntelligenceService.parsePhoto('user-1', img, null);
    expect(model).toHaveBeenCalledTimes(1);
    expect(reserve).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith('user-1', expect.any(String), expect.anything(), { logged: true });
  });

  it('photo: a Fix never matches a job and is always counted', async () => {
    const { reserve, recent } = setup();
    vi.spyOn(NutritionIntelligenceService as any, 'refinePromptBlock').mockReturnValue('fix');
    await NutritionIntelligenceService.parsePhoto('user-1', img, null, { refine: { correction: 'tofu', items: [] } as any, jobId: 'job-12345678' } as any);
    expect(recent).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('voice/text: the same transcript counted in the last 10 min → analysed, not charged', async () => {
    const service = NutritionIntelligenceService as any;
    const reserve = vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release: vi.fn() });
    vi.spyOn(service, 'groundItemsByMode').mockImplementation(async (...args: unknown[]) => ({
      items: (args[1] as any[]).map((it) => ({ ...it, matchedFoodId: null, itemSource: 'llm_vision', unitOptions: [] })),
    }));
    vi.spyOn(service, 'callVoiceModel').mockResolvedValue({ items: [parsedItem], overallConfidence: 0.9, notes: null, assumptions: [] });
    vi.mocked(UsageService.recentFoodAiCredit).mockResolvedValueOnce({ contentHash: 'h', countedAt: justNow(), matchedBy: 'content' });
    await NutritionIntelligenceService.parseVoice('user-1', 'banana and oatmeal', { source: 'text' });
    expect(reserve).not.toHaveBeenCalled();
    await NutritionIntelligenceService.parseVoice('user-1', 'banana and oatmeal', { source: 'text', jobId: 'job-12345678' });
    expect(reserve).toHaveBeenCalledWith('user-1', expect.any(String), { jobId: 'job-12345678' });
  });

  it('estimate-item: a counted repeat skips the paywall check and the credit', async () => {
    const service = NutritionIntelligenceService as any;
    const assert = vi.spyOn(UsageService, 'assertFoodAiQuota').mockResolvedValue(undefined);
    const reserve = vi.spyOn(UsageService, 'reserveFoodAi').mockResolvedValue({ id: 'r1', release: vi.fn() });
    vi.spyOn(service, 'getCachedResult').mockResolvedValue(cachedResult);
    vi.spyOn(service, 'finalizeEstimatedItem').mockResolvedValue(parsedItem);
    vi.mocked(UsageService.recentFoodAiCredit).mockResolvedValueOnce({ contentHash: 'h', countedAt: justNow(), matchedBy: 'content' });
    await NutritionIntelligenceService.estimateItem('user-1', 'Rice', 100);
    expect(assert).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
});
