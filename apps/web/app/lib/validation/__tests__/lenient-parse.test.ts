import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseLenient, safeParseLenient, stripRejectedNulls, validationMessage } from '../lenient-parse';

describe('lenient-parse', () => {
  const schema = z.object({
    name: z.string().min(1),
    water_ml: z.number().int().min(1).optional(),
    notes: z.string().max(10).optional(),
    auto: z.boolean().optional().default(true),
    // null is meaningful here: it clears the field
    description: z.string().nullable().optional(),
    nutrition: z
      .object({
        calories: z.number().optional(),
        items: z.array(z.object({ name: z.string(), grams: z.number().optional() })).optional(),
      })
      .passthrough()
      .optional(),
  });

  it('drops nulls for optional-only fields and keeps the rest', () => {
    const parsed = parseLenient(schema, { name: 'x', water_ml: null, notes: null, auto: null });
    expect(parsed).toEqual({ name: 'x', auto: true });
  });

  it('keeps null where the schema accepts it (clear semantics)', () => {
    const parsed = parseLenient(schema, { name: 'x', description: null });
    expect(parsed.description).toBeNull();
  });

  it('cleans nested objects and array elements', () => {
    const parsed = parseLenient(schema, {
      name: 'x',
      nutrition: { calories: null, extra: null, items: [{ name: 'a', grams: null }] },
    });
    expect(parsed.nutrition).toEqual({ extra: null, items: [{ name: 'a' }] });
  });

  it('still rejects a null in a REQUIRED field', () => {
    const result = safeParseLenient(schema, { name: null });
    expect(result.success).toBe(false);
  });

  it('still enforces types, ranges and lengths', () => {
    expect(safeParseLenient(schema, { name: 'x', water_ml: 0 }).success).toBe(false);
    expect(safeParseLenient(schema, { name: 'x', notes: 'way too long for ten' }).success).toBe(false);
    expect(safeParseLenient(schema, { name: 'x', water_ml: '5' }).success).toBe(false);
  });

  it('sees through refinements and effects on the object', () => {
    const refined = z
      .object({ start: z.string().optional(), end: z.string().optional() })
      .refine((v) => !v.start || !v.end || v.start <= v.end, 'start must be before end');
    expect(parseLenient(refined, { start: null, end: '2026-01-01' })).toEqual({ end: '2026-01-01' });
    expect(safeParseLenient(refined, { start: '2026-02-01', end: '2026-01-01' }).success).toBe(false);
  });

  it('handles records and leaves unknown shapes alone', () => {
    const rec = z.object({ data: z.record(z.string()) });
    expect(parseLenient(rec, { data: { a: 'x', b: null } })).toEqual({ data: { a: 'x' } });
    expect(stripRejectedNulls(z.string(), null)).toBeNull();
    expect(stripRejectedNulls(schema, 'not an object')).toBe('not an object');
  });

  it('does not mutate the input', () => {
    const input = { name: 'x', water_ml: null };
    parseLenient(schema, input);
    expect(input).toEqual({ name: 'x', water_ml: null });
  });

  it('produces a readable validation message', () => {
    const result = schema.safeParse({ name: '', water_ml: 0 });
    expect(result.success).toBe(false);
    if (!result.success) expect(validationMessage(result.error)).toMatch(/^name: .+\(\+1 more\)$/);
  });
});
