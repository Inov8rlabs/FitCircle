// Self-test for the nutrition eval harness (PRD §8.3). Validates the PURE scorers against
// hand-built (golden, modelOutput) cases — proving the harness logic is correct BEFORE it's
// pointed at the live LLM. Deterministic; no network.

import { describe, it, expect } from 'vitest';

import type { PhotoParseResult } from '../../types/nutrition';
import type { EvalCase, GoldenRecord } from '../../types/nutrition-eval';
import {
  buildReport,
  expectedCalibrationError,
  nameSimilarity,
  scoreRecord,
} from '../nutrition-eval';

// --- helpers to build cases compactly ---------------------------------------
function golden(id: string, cuisine: string, items: Array<[string, number, number]>, totalCal: number): GoldenRecord {
  return {
    id,
    imageUri: `mem://${id}`,
    provenance: 'weighed',
    groundTruth: {
      items: items.map(([name, grams, calories]) => ({ name, canonicalId: null, grams, calories, protein: 0, carbs: 0, fat: 0 })),
      total: { calories: totalCal, protein: 0, carbs: 0, fat: 0 },
    },
    slices: { cuisine, mealType: 'dinner', difficulty: 'medium', lighting: 'good' },
    datasetVersion: 'test-v1',
  };
}
function model(items: Array<[string, number, number, number]>, conf: number): PhotoParseResult {
  return {
    items: items.map(([name, quantity, calories, confidence]) => ({
      name, quantity, quantityRange: null, servingUnit: 'g', grams: quantity, gramsPerUnit: 1,
      calories, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0, confidence,
    })),
    overallConfidence: conf,
    notes: null,
  };
}

describe('nutrition-eval — fuzzy name matching (Stage 1)', () => {
  it('matches descriptive prediction to a short truth label', () => {
    expect(nameSimilarity('grilled chicken breast', 'chicken')).toBeGreaterThanOrEqual(0.4);
  });
  it('scores unrelated foods low', () => {
    expect(nameSimilarity('chocolate cake', 'grilled salmon')).toBeLessThan(0.2);
  });
});

describe('nutrition-eval — per-record scoring across 4 stages', () => {
  it('perfect prediction scores top marks', () => {
    const c: EvalCase = {
      golden: golden('g1', 'western', [['chicken breast', 150, 248]], 248),
      modelOutput: model([['grilled chicken breast', 150, 248, 0.9]], 0.9),
      dbMatches: [true],
    };
    const s = scoreRecord(c).scores;
    expect(s.identTop1).toBe(1);
    expect(s.multiItemRecall).toBe(1);
    expect(s.hallucinationRate).toBe(0);
    expect(s.portionMape).toBe(0);
    expect(s.withinPct25).toBe(true);
    expect(s.dbMatchCoverage).toBe(1);
  });

  it('detects a hallucinated item', () => {
    const c: EvalCase = {
      golden: golden('g2', 'western', [['rice', 200, 260]], 260),
      modelOutput: model([['rice', 200, 260, 0.8], ['ketchup', 30, 30, 0.4]], 0.7),
      dbMatches: [true, false],
    };
    const s = scoreRecord(c).scores;
    expect(s.hallucinationRate).toBeCloseTo(0.5, 5); // 1 of 2 preds unmatched
    expect(s.dbMatchCoverage).toBeCloseTo(0.5, 5);
  });

  it('computes portion MAPE on grams', () => {
    const c: EvalCase = {
      golden: golden('g3', 'south_asian', [['biryani', 300, 480]], 480),
      modelOutput: model([['chicken biryani', 360, 576, 0.7]], 0.7), // 20% over on grams
      dbMatches: [true],
    };
    const s = scoreRecord(c).scores;
    expect(s.portionMape).toBeCloseTo(0.2, 5);
  });

  it('flags nutrition mapping outside ±25% but inside ±40%', () => {
    const c: EvalCase = {
      golden: golden('g4', 'western', [['pasta', 250, 400]], 400),
      modelOutput: model([['pasta', 250, 530, 0.6]], 0.6), // +32.5%
      dbMatches: [true],
    };
    const s = scoreRecord(c).scores;
    expect(s.withinPct25).toBe(false);
    expect(s.withinPct40).toBe(true);
  });
});

describe('nutrition-eval — ECE calibration', () => {
  it('well-calibrated confidence yields low ECE', () => {
    // 10 records at conf 0.9; 9 identify correctly, 1 wrong → bucket acc 0.9 == conf 0.9 → ECE ~0.
    // (Use real multi-token names; the matcher ignores tokens <=2 chars.)
    const scored = Array.from({ length: 10 }, (_, i) =>
      scoreRecord({
        golden: golden(`c${i}`, 'western', [['oatmeal', 100, 389]], 389),
        modelOutput: model([[i < 9 ? 'oatmeal porridge' : 'totally unrelated nonsense', 100, 389, 0.9]], 0.9),
        dbMatches: [true],
      })
    );
    expect(expectedCalibrationError(scored)).toBeLessThan(0.15);
  });

  it('overconfident-and-wrong yields high ECE', () => {
    // conf 0.95 but all wrong → |acc 0 - conf 0.95| ≈ 0.95
    const scored = Array.from({ length: 8 }, (_, i) =>
      scoreRecord({
        golden: golden(`w${i}`, 'western', [['apple', 100, 52]], 52),
        modelOutput: model([['deep fried zzz nonsense', 100, 52, 0.95]], 0.95),
        dbMatches: [true],
      })
    );
    expect(expectedCalibrationError(scored)).toBeGreaterThan(0.5);
  });
});

describe('nutrition-eval — report with mandatory sliced reporting (§8.3, §6.11)', () => {
  // All correct → for ECE to stay < 0.1 (calibrated), confidence must be ~1.0 (acc is 1.0).
  const cases: EvalCase[] = [
    { golden: golden('s1', 'south_asian', [['dal', 200, 240]], 240), modelOutput: model([['dal lentils', 200, 240, 0.95]], 0.95), dbMatches: [true] },
    { golden: golden('s2', 'south_asian', [['roti', 60, 180]], 180), modelOutput: model([['roti flatbread', 60, 180, 0.95]], 0.95), dbMatches: [true] },
    { golden: golden('w1', 'canadian', [['poutine', 300, 740]], 740), modelOutput: model([['poutine', 300, 740, 0.95]], 0.95), dbMatches: [true] },
  ];

  it('produces overall + per-slice breakdowns including the cuisine wedge', () => {
    const report = buildReport(cases, 'test-v1');
    expect(report.n).toBe(3);
    // sliced reporting is mandatory — cuisine slices must be present
    const southAsian = report.bySlice.find((s) => s.slice === 'cuisine=south_asian');
    const canadian = report.bySlice.find((s) => s.slice === 'cuisine=canadian');
    expect(southAsian?.n).toBe(2);
    expect(canadian?.n).toBe(1);
    // every record identified correctly → overall top-1 accuracy 1.0
    expect(report.overall.identTop1Acc).toBe(1);
    expect(report.pass).toBe(true);
  });

  it('fails the report when overall identification regresses below threshold', () => {
    const bad: EvalCase[] = [
      { golden: golden('b1', 'western', [['salmon', 150, 280]], 280), modelOutput: model([['mystery zzz', 150, 280, 0.5]], 0.5), dbMatches: [false] },
    ];
    const report = buildReport(bad, 'test-v1');
    expect(report.pass).toBe(false);
    expect(report.failures.some((f) => f.includes('identTop1Acc'))).toBe(true);
  });
});
