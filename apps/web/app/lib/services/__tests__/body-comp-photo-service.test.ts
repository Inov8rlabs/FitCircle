import { describe, expect, it } from 'vitest';

import { type BodyCompParseResult, bodyCompParseResultSchema } from '../../types/body-composition';
import { BodyCompPhotoService } from '../body-comp-photo-service';

/**
 * BodyCompPhotoService.buildDraft — the pure model-output → BodyCompDraft shaping +
 * cross-field validation layer (BODY_COMP_BUILD_CONTRACT §2 "Photo-parse implementation").
 * The AI call itself is not exercised here; these tests pin the contract's cross-checks.
 */

const metric = (value: number, confidence = 0.9) => ({ value, confidence });

/** A clean, self-consistent InBody-style parse: 80 kg, 25% BF, 20 kg fat, 60 kg lean. */
const cleanParse = (overrides: Partial<BodyCompParseResult> = {}): BodyCompParseResult => ({
  measuredAt: '2026-07-20T08:15:00Z',
  metrics: {
    weightKg: metric(80),
    bodyFatPct: metric(25),
    fatMassKg: metric(20),
    skeletalMuscleMassKg: metric(35),
    leanBodyMassKg: metric(60),
    bodyWaterKg: metric(44),
    boneMassKg: metric(3.2),
    visceralFatLevel: metric(8),
    bmrKcal: metric(1710),
  },
  segmental: null,
  overallConfidence: 0.9,
  warnings: [],
  ...overrides,
});

describe('buildDraft — clean parse', () => {
  it('passes through consistent values with confidences intact', () => {
    const draft = BodyCompPhotoService.buildDraft(cleanParse(), 'model-x', false);
    expect(draft.measuredAt).toBe('2026-07-20T08:15:00.000Z');
    expect(draft.metrics.weightKg).toEqual({ value: 80, confidence: 0.9 });
    expect(draft.metrics.bodyFatPct).toEqual({ value: 25, confidence: 0.9 });
    expect(draft.metrics.bmrKcal).toEqual({ value: 1710, confidence: 0.9 });
    expect(draft.overallConfidence).toBe(0.9);
    expect(draft.warnings).toEqual([]);
    expect(draft.model).toBe('model-x');
    expect(draft.cached).toBe(false);
  });

  it('never exposes leanBodyMassKg on the frozen draft', () => {
    const draft = BodyCompPhotoService.buildDraft(cleanParse(), 'm', false);
    expect('leanBodyMassKg' in draft.metrics).toBe(false);
  });

  it('omits absent and non-positive metrics', () => {
    const parse = cleanParse();
    parse.metrics.bodyWaterKg = null;
    parse.metrics.boneMassKg = metric(-1);
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.metrics.bodyWaterKg).toBeUndefined();
    expect(draft.metrics.boneMassKg).toBeUndefined();
  });
});

describe('buildDraft — cross-field validation', () => {
  it('flags fat mass that disagrees with weight × BF% beyond ±3% BW', () => {
    const parse = cleanParse();
    parse.metrics.fatMassKg = metric(28); // expected 20; off by 8 kg > 2.4 kg tolerance
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.metrics.fatMassKg!.confidence).toBeLessThanOrEqual(0.45);
    expect(draft.metrics.bodyFatPct!.confidence).toBeLessThanOrEqual(0.45);
    expect(draft.warnings.some((w) => w.includes("don't agree"))).toBe(true);
    expect(draft.overallConfidence).toBeLessThan(0.9);
  });

  it('flags fat + lean that fail to reconstruct the printed weight', () => {
    const parse = cleanParse();
    parse.metrics.leanBodyMassKg = metric(50); // 20 + 50 = 70 vs weight 80 → >3% off
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.metrics.weightKg!.confidence).toBeLessThanOrEqual(0.5);
    expect(draft.warnings.some((w) => w.includes("doesn't add up"))).toBe(true);
  });

  it('flags SMM at or above lean body mass', () => {
    const parse = cleanParse();
    parse.metrics.skeletalMuscleMassKg = metric(65); // lean is 60
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.metrics.skeletalMuscleMassKg!.confidence).toBeLessThanOrEqual(0.35);
    expect(draft.warnings.some((w) => w.includes('Skeletal muscle'))).toBe(true);
  });

  it('flags implausible body fat % and weight readings', () => {
    const parse = cleanParse();
    parse.metrics.bodyFatPct = metric(62); // > 60 plausibility ceiling
    parse.metrics.fatMassKg = null; // avoid triggering the agreement check too
    parse.metrics.leanBodyMassKg = null;
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.metrics.bodyFatPct!.confidence).toBeLessThanOrEqual(0.3);
    expect(draft.warnings.some((w) => w.includes('outside the typical'))).toBe(true);
  });

  it('warns when segmental lean sums past total lean and dents overall confidence', () => {
    const parse = cleanParse({
      segmental: {
        trunk: { leanKg: 30, pctOfIdeal: 105 },
        leftArm: { leanKg: 10, pctOfIdeal: null },
        rightArm: { leanKg: 10, pctOfIdeal: null },
        leftLeg: { leanKg: 10, pctOfIdeal: null },
        rightLeg: { leanKg: 10, pctOfIdeal: null }, // Σ = 70 > lean 60 × 1.02
      },
    });
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.segmental).not.toBeNull();
    expect(draft.warnings.some((w) => w.includes('Segmental lean'))).toBe(true);
    expect(draft.overallConfidence).toBeCloseTo(0.8, 5); // 0.9 − 0.1 segmental penalty
  });

  it('keeps a consistent segmental block without warnings', () => {
    const parse = cleanParse({
      segmental: {
        trunk: { leanKg: 28, pctOfIdeal: 104.2 },
        leftArm: { leanKg: 3.1, pctOfIdeal: 98 },
        rightArm: { leanKg: 3.2, pctOfIdeal: 100 },
        leftLeg: { leanKg: 9.4, pctOfIdeal: null },
        rightLeg: { leanKg: 9.5, pctOfIdeal: null },
      },
    });
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.segmental).toEqual({
      trunk: { leanKg: 28, pctOfIdeal: 104.2 },
      leftArm: { leanKg: 3.1, pctOfIdeal: 98 },
      rightArm: { leanKg: 3.2, pctOfIdeal: 100 },
      leftLeg: { leanKg: 9.4 },
      rightLeg: { leanKg: 9.5 },
    });
    expect(draft.warnings).toEqual([]);
  });
});

describe('buildDraft — measuredAt + degenerate parses', () => {
  it('nulls unparseable, ancient, and future dates', () => {
    for (const bad of ['not a date', '1998-01-01', '2999-01-01T00:00:00Z', null]) {
      const draft = BodyCompPhotoService.buildDraft(cleanParse({ measuredAt: bad }), 'm', false);
      expect(draft.measuredAt).toBeNull();
    }
  });

  it('returns overallConfidence 0 with a warning when nothing was read', () => {
    const parse = cleanParse();
    for (const key of Object.keys(parse.metrics) as (keyof typeof parse.metrics)[]) {
      parse.metrics[key] = null;
    }
    const draft = BodyCompPhotoService.buildDraft(parse, 'm', false);
    expect(draft.overallConfidence).toBe(0);
    expect(draft.metrics).toEqual({});
    expect(draft.warnings.some((w) => w.includes('No body-composition values'))).toBe(true);
  });
});

describe('bodyCompParseResultSchema — robustness clamps', () => {
  it('clamps glitchy confidences into 0..1 and coerces non-finite values to 0', () => {
    const parsed = bodyCompParseResultSchema.parse({
      measuredAt: null,
      metrics: {
        weightKg: { value: 80, confidence: 1.4 },
        bodyFatPct: { value: Number.NaN, confidence: -0.2 },
        fatMassKg: null,
        skeletalMuscleMassKg: null,
        leanBodyMassKg: null,
        bodyWaterKg: null,
        boneMassKg: null,
        visceralFatLevel: null,
        bmrKcal: null,
      },
      segmental: null,
      overallConfidence: 2,
      warnings: [],
    });
    expect(parsed.metrics.weightKg!.confidence).toBe(1);
    expect(parsed.metrics.bodyFatPct!.value).toBe(0); // dropped later by buildDraft
    expect(parsed.metrics.bodyFatPct!.confidence).toBe(0);
    expect(parsed.overallConfidence).toBe(1);
  });
});
