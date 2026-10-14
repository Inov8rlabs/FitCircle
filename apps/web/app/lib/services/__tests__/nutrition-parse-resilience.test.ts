import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parsedFoodItemSchema, photoParseResultSchema } from '../../types/nutrition';
import { NutritionIntelligenceService } from '../nutrition-intelligence-service';

const item = {
  name: 'breakfast sausages',
  quantity: 2,
  quantityRange: null,
  servingUnit: 'piece',
  gramsPerUnit: 60,
  grams: 120,
  calories: 290,
  proteinG: 13,
  carbsG: 1,
  fatG: 26,
  sodiumMg: 640,
  sugarG: 0,
  fiberG: 0,
  confidence: 0.95,
};

describe('photoParseResultSchema leniency (2026-09-22 production failure)', () => {
  it('accepts a plate whose top-level notes key is missing entirely', () => {
    const parsed = photoParseResultSchema.parse({ items: [item], overallConfidence: 0.9 });
    expect(parsed.notes).toBeNull();
    expect(parsed.items).toHaveLength(1);
  });

  it('coerces a null / blank / non-string servingUnit to "serving" instead of rejecting', () => {
    for (const bad of [null, undefined, '', '   ', 7]) {
      const parsed = parsedFoodItemSchema.parse({ ...item, servingUnit: bad });
      expect(parsed.servingUnit).toBe('serving');
    }
  });

  it('treats a missing or malformed quantityRange as null', () => {
    const { quantityRange: _omit, ...withoutRange } = item;
    expect(parsedFoodItemSchema.parse(withoutRange).quantityRange).toBeNull();
    expect(parsedFoodItemSchema.parse({ ...item, quantityRange: '' }).quantityRange).toBeNull();
    expect(parsedFoodItemSchema.parse({ ...item, quantityRange: { min: 0.5, max: 1 } }).quantityRange).toEqual({
      min: 0.5,
      max: 1,
    });
  });

  it('drops an item the model could not name rather than failing the whole plate', () => {
    const parsed = photoParseResultSchema.parse({
      items: [item, { ...item, name: '' }, { ...item, name: null }],
      overallConfidence: 0.8,
      notes: 'sauce uncertain',
    });
    expect(parsed.items.map((i) => i.name)).toEqual(['breakfast sausages']);
    expect(parsed.notes).toBe('sauce uncertain');
  });

  it('still self-heals glitchy numbers (existing behaviour)', () => {
    const parsed = parsedFoodItemSchema.parse({ ...item, carbsG: -1, confidence: 1.7, fiberG: 'x' });
    expect(parsed.carbsG).toBe(0);
    expect(parsed.confidence).toBe(1);
    expect(parsed.fiberG).toBe(0);
  });
});

describe('NutritionIntelligenceService.modelCallOptions', () => {
  it('gives Gemini minimal thinking, prompt-schema JSON and headroom for thinking tokens', () => {
    const opts = NutritionIntelligenceService.modelCallOptions('google/gemini-3-flash', 2_000);
    expect(opts.maxOutputTokens).toBe(6_000);
    expect(opts.providerOptions).toEqual({
      google: {
        thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false },
        structuredOutputs: false,
      },
    });
  });

  it('uses "low" thinking for Gemini 3.5+ (they reject "minimal")', () => {
    for (const m of ['google/gemini-3.5-flash', 'google/gemini-3.8-flash', 'google/gemini-4-argon']) {
      const opts = NutritionIntelligenceService.modelCallOptions(m, 2_000);
      expect((opts.providerOptions.google as any).thinkingConfig.thinkingLevel).toBe('low');
    }
    expect(
      (NutritionIntelligenceService.modelCallOptions('google/gemini-3.1-flash-lite', 2_000).providerOptions.google as any)
        .thinkingConfig.thinkingLevel,
    ).toBe('minimal');
  });

  it('gives OpenAI reasoning models low effort, non-strict schema and headroom', () => {
    const opts = NutritionIntelligenceService.modelCallOptions('openai/gpt-5.4-mini', 2_000);
    expect(opts.maxOutputTokens).toBe(6_000);
    expect(opts.providerOptions).toEqual({ openai: { reasoningEffort: 'low', strictJsonSchema: false } });
    expect(opts.nativeSchema).toBe(true);
  });

  it('turns default-on reasoning off for Qwen, Kimi, GLM, DeepSeek and StepFun with each vendor switch', () => {
    expect(NutritionIntelligenceService.modelCallOptions('alibaba/qwen3.8-flash', 2_000)).toEqual({
      maxOutputTokens: 6_000,
      nativeSchema: false,
      providerOptions: { alibaba: { enableThinking: false } },
    });
    expect(NutritionIntelligenceService.modelCallOptions('stepfun/step-3.7-flash', 2_000).providerOptions).toEqual({
      stepfun: { enableThinking: false },
    });
    for (const m of ['moonshotai/kimi-k2.6', 'zai/glm-5v-turbo', 'deepseek/deepseek-v4.1-flash']) {
      expect(NutritionIntelligenceService.modelCallOptions(m, 2_000).providerOptions).toEqual({
        [m.split('/')[0]]: { thinking: { type: 'disabled' } },
      });
    }
  });

  it('leaves Anthropic calls exactly as before', () => {
    const opts = NutritionIntelligenceService.modelCallOptions('anthropic/claude-haiku-4.5', 800);
    expect(opts).toEqual({ maxOutputTokens: 800, nativeSchema: true, providerOptions: {} });
  });
});

describe('NutritionIntelligenceService.outputOrThrow', () => {
  it('returns the object when the model stopped normally', () => {
    expect(
      NutritionIntelligenceService.outputOrThrow({ finishReason: 'stop', output: { ok: true } }, 'm'),
    ).toEqual({ ok: true });
  });

  it('throws a diagnosable error (not the SDK blank one) when the answer was cut off', () => {
    const result = {
      finishReason: 'length',
      usage: { outputTokens: 2_000 },
      text: '',
      get output(): never {
        throw new Error('AI_NoOutputGeneratedError should never be reached');
      },
    };
    let caught: any;
    try {
      NutritionIntelligenceService.outputOrThrow(result, 'google/gemini-3-flash');
    } catch (e) {
      caught = e;
    }
    expect(caught.name).toBe('IncompleteOutputError');
    expect(caught.finishReason).toBe('length');
    expect(caught.message).toContain('finishReason=length');
    expect(caught.usage).toEqual({ outputTokens: 2_000 });
  });
});

describe('NutritionIntelligenceService.describeParseError', () => {
  const describeParseError = (e: unknown) => (NutritionIntelligenceService as any).describeParseError(e);

  it('surfaces the failing zod paths from a nested NoObjectGeneratedError', () => {
    const zodError = z.object({ notes: z.string().nullable() }).safeParse({});
    expect(zodError.success).toBe(false);
    const typeValidation = Object.assign(new Error('Type validation failed'), {
      name: 'AI_TypeValidationError',
      cause: (zodError as any).error,
    });
    const noObject = Object.assign(new Error('No object generated: response did not match schema.'), {
      name: 'AI_NoObjectGeneratedError',
      text: '{"items":[]}',
      cause: typeValidation,
    });
    const detail = describeParseError(noObject);
    expect(detail.kind).toBe('no_object_generated');
    expect(detail.issues).toEqual([{ path: 'notes', code: 'invalid_type', message: 'Required' }]);
  });

  it('classifies the finish-reason guard as incomplete_output', () => {
    const err = Object.assign(new Error('cut off'), { name: 'IncompleteOutputError', finishReason: 'length' });
    const detail = describeParseError(err);
    expect(detail.kind).toBe('incomplete_output');
    expect(detail.finishReason).toBe('length');
    expect(detail.issues).toBeUndefined();
  });
});

describe('NutritionIntelligenceService.repairPhotoJson — second chance for near-miss JSON', () => {
  it('wraps a bare item array and maps foodName/snake_case keys onto the schema', () => {
    const text = `\`\`\`json
[
  { "foodName": "Roasted Almonds", "quantity": 0.5, "servingUnit": "cup", "gramsPerUnit": 70, "grams": 35,
    "calories": 203, "protein_g": 7.4, "carbs_g": 7.5, "fat_g": 17.6, "fiber_g": 4.4, "sugar_g": 1.6, "sodium_mg": 0.4,
    "quantityRange": { "min": 0.4, "max": 0.6 }, "confidence": 0.8 },
  { "foodItem": "Cherry Tomatoes", "quantity": 8, "servingUnit": "tomato", "gramsPerUnit": 15, "grams": 120,
    "kcal": 22, "protein": 1.1, "carbs": 4.7, "fat": 0.2, "fiber": 1.4, "sugar": 3.2, "sodium": 6, "confidence": 0.9 }
]
\`\`\``;
    const out = NutritionIntelligenceService.repairPhotoJson(text);
    expect(out).not.toBeNull();
    expect(out!.items).toHaveLength(2);
    expect(out!.items[0].name).toBe('Roasted Almonds');
    expect(out!.items[0].proteinG).toBeCloseTo(7.4);
    expect(out!.items[0].quantityRange).toEqual({ min: 0.4, max: 0.6 });
    expect(out!.items[1].name).toBe('Cherry Tomatoes');
    expect(out!.items[1].calories).toBe(22);
    expect(out!.items[1].sodiumMg).toBe(6);
    expect(out!.overallConfidence).toBeCloseTo(0.85);
    expect(out!.notes).toBeNull();
  });

  it('accepts an object whose items live under "foods"', () => {
    const out = NutritionIntelligenceService.repairPhotoJson(
      '{"foods":[{"name":"banana","quantity":1,"servingUnit":"piece","gramsPerUnit":118,"grams":118,"calories":105,"proteinG":1.3,"carbsG":27,"fatG":0.4,"fiberG":3.1,"sugarG":14.4,"sodiumMg":1,"confidence":0.95}],"overallConfidence":0.95,"notes":"ripe"}',
    );
    expect(out?.items[0].name).toBe('banana');
    expect(out?.notes).toBe('ripe');
  });

  it('returns null for prose, truncated JSON, or items without a name', () => {
    expect(NutritionIntelligenceService.repairPhotoJson('I cannot see any food here.')).toBeNull();
    expect(NutritionIntelligenceService.repairPhotoJson('{"items":[{"name":"rice","quantity":1,')).toBeNull();
    expect(NutritionIntelligenceService.repairPhotoJson('[{"quantity":1,"calories":10}]')).toBeNull();
    expect(NutritionIntelligenceService.repairPhotoJson(undefined)).toBeNull();
  });
});

describe('NutritionIntelligenceService.photoPromptVariant', () => {
  it('production uses plate-coverage anchors (not the shrink rules) and asks for dbName', () => {
    const prod = NutritionIntelligenceService.photoPromptVariant();
    expect(prod).toContain('dbName');
    expect(prod).not.toContain('choose the SMALLER');
    expect(prod).not.toContain('revise the portions DOWN');
    expect(prod).toContain('Do not shrink a clearly full plate');
    const shrink = NutritionIntelligenceService.photoPromptVariant('shrink');
    expect(shrink).toContain('choose the SMALLER');
    expect(shrink).not.toBe(prod);
    expect(NutritionIntelligenceService.photoPromptVariant('scale')).toBe(prod);
    expect(NutritionIntelligenceService.photoPromptVariant('scale_fat')).toContain('HIDDEN FAT');
    expect(NutritionIntelligenceService.photoPromptVariant('nope')).toBe(prod);
  });
});
