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
  it('gives Gemini minimal thinking plus headroom for thinking tokens', () => {
    const opts = NutritionIntelligenceService.modelCallOptions('google/gemini-3-flash', 2_000);
    expect(opts.maxOutputTokens).toBe(6_000);
    expect(opts.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    });
  });

  it('leaves Anthropic calls exactly as before', () => {
    const opts = NutritionIntelligenceService.modelCallOptions('anthropic/claude-haiku-4.5', 800);
    expect(opts).toEqual({ maxOutputTokens: 800, providerOptions: {} });
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
