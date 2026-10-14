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

describe('nutrition-eval — v2 metrics (grams MAE, macros, grounding correctness)', () => {
  it('scores portion error on GRAMS, not the natural-unit quantity', () => {
    const c: EvalCase = {
      golden: golden('g5', 'western', [['toast', 60, 160]], 160),
      modelOutput: {
        items: [{
          name: 'toast', quantity: 2, quantityRange: null, servingUnit: 'slice', grams: 66, gramsPerUnit: 33,
          calories: 176, proteinG: 6, carbsG: 30, fatG: 2, fiberG: 2, sugarG: 2, sodiumMg: 300, confidence: 0.9,
        }],
        overallConfidence: 0.9,
        notes: null,
      },
      dbMatches: [false],
    };
    const s = scoreRecord(c).scores;
    expect(s.portionMape).toBeCloseTo(0.1, 5);
    expect(s.portionMaeG).toBeCloseTo(6, 5);
  });

  it('reports macro errors on totals and null when the truth macro is zero', () => {
    const g = golden('g6', 'western', [['rice', 150, 195]], 195);
    g.groundTruth.total = { calories: 195, protein: 4, carbs: 42, fat: 0 };
    const c: EvalCase = {
      golden: g,
      modelOutput: {
        items: [{
          name: 'rice', quantity: 150, quantityRange: null, servingUnit: 'g', grams: 150, gramsPerUnit: 1,
          calories: 234, proteinG: 5, carbsG: 50.4, fatG: 1, fiberG: 0, sugarG: 0, sodiumMg: 0, confidence: 0.8,
        }],
        overallConfidence: 0.8,
        notes: null,
      },
      dbMatches: [true],
    };
    const s = scoreRecord(c).scores;
    expect(s.calAbsPctErr).toBeCloseTo(0.2, 5);
    expect(s.calSignedPctErr).toBeCloseTo(0.2, 5);
    expect(s.calAbsErr).toBeCloseTo(39, 5);
    expect(s.proteinAbsPctErr).toBeCloseTo(0.25, 5);
    expect(s.carbsAbsPctErr).toBeCloseTo(0.2, 5);
    expect(s.fatAbsPctErr).toBeNull();
  });

  it('grounding correctness compares grounded density against the matched truth item', () => {
    // truth: chicken 100 g / 165 kcal (1.65 kcal/g), rice 150 g / 195 kcal (1.3 kcal/g)
    const c: EvalCase = {
      golden: golden('g7', 'western', [['chicken', 100, 165], ['rice', 150, 195]], 360),
      modelOutput: model([['chicken', 100, 165, 0.9], ['rice', 150, 195, 0.9], ['sauce', 20, 40, 0.5]], 0.9),
      dbMatches: [true, true, false],
      // chicken grounded to a plausible row (170 kcal/100 g); rice grounded to a WRONG row (360 kcal/100 g = a dry-weight product)
      groundedKcalPer100g: [170, 360, null],
    };
    const s = scoreRecord(c).scores;
    expect(s.groundingCorrectness).toBeCloseTo(0.5, 5);
  });

  it('grounding correctness is null when no grounded item matched a truth item', () => {
    const c: EvalCase = {
      golden: golden('g8', 'western', [['salad', 100, 50]], 50),
      modelOutput: model([['salad', 100, 50, 0.9]], 0.9),
      dbMatches: [false],
      groundedKcalPer100g: [null],
    };
    expect(scoreRecord(c).scores.groundingCorrectness).toBeNull();
  });

  it('aggregates the new metrics and gates grounding correctness', () => {
    const good: EvalCase = {
      golden: golden('g9', 'western', [['chicken', 100, 165]], 165),
      modelOutput: model([['chicken', 100, 165, 0.95]], 0.95),
      dbMatches: [true],
      groundedKcalPer100g: [165],
    };
    const bad: EvalCase = {
      golden: golden('g10', 'western', [['chicken', 100, 165]], 165),
      modelOutput: model([['chicken', 100, 165, 0.95]], 0.95),
      dbMatches: [true],
      groundedKcalPer100g: [400],
    };
    const report = buildReport([good, bad], 'test-v2');
    expect(report.overall.groundingCorrectness).toBeCloseTo(0.5, 5);
    expect(report.overall.calMae).toBe(0);
    expect(report.failures.some((f) => f.includes('groundingCorrectness'))).toBe(true);
  });
});

describe('nutrition-eval — semantic name matching (runner-supplied similarity)', () => {
  it('matches on the embedding similarity when token Dice misses', () => {
    const c: EvalCase = {
      golden: golden('g11', 'western', [['Egg, whole, boiled or poached', 44, 62]], 62),
      modelOutput: model([['large chicken egg', 50, 72, 0.9]], 0.9),
      dbMatches: [false],
      nameSimilarities: [[0.71]],
    };
    const s = scoreRecord(c).scores;
    expect(s.identTop1).toBe(1);
    expect(s.multiItemRecall).toBe(1);
    expect(s.hallucinationRate).toBe(0);
    expect(s.portionMape).toBeCloseTo(6 / 44, 5);
  });

  it('does not match below the semantic threshold', () => {
    const c: EvalCase = {
      golden: golden('g12', 'western', [['Egg, whole, boiled or poached', 44, 62]], 62),
      modelOutput: model([['blueberry muffin', 50, 72, 0.9]], 0.9),
      dbMatches: [false],
      nameSimilarities: [[0.31]],
    };
    const s = scoreRecord(c).scores;
    expect(s.identTop1).toBe(0);
    expect(s.hallucinationRate).toBe(1);
  });
});

describe('nutrition-eval — portion MAPE ignores sub-5 g truth items (but MAE counts them)', () => {
  it('a 20 g guess for 0.2 g of parsley does not swamp the plate', () => {
    const c: EvalCase = {
      golden: golden('g13', 'western', [['rice', 150, 195], ['parsley', 0.2, 0.1]], 195),
      modelOutput: model([['rice', 165, 215, 0.9], ['parsley', 20, 7, 0.4]], 0.8),
      dbMatches: [true, false],
    };
    const s = scoreRecord(c).scores;
    expect(s.portionMape).toBeCloseTo(0.1, 5);
    expect(s.portionMaeG).toBeCloseTo((15 + 19.8) / 2, 5);
  });
});

describe('nutrition-eval — paired grounding ablation', () => {
  it('re-scores the same cases on the pre-grounding items and reports both', () => {
    // Truth: 100 g banana = 89 kcal. Grounded output is right; the model's raw guess was 2× too dense.
    const g = golden('p1', 'western', [['banana', 100, 89]], 89);
    const grounded = model([['banana', 100, 89, 0.9]], 0.9);
    const raw = model([['banana', 100, 178, 0.9]], 0.9).items;
    const c: EvalCase = { golden: g, modelOutput: grounded, dbMatches: [true], groundedKcalPer100g: [89], rawItems: raw };
    const report = buildReport([c], 'test-v1');
    expect(report.overall.within25Rate).toBe(1);
    expect(report.ablation?.modelOnly.within25Rate).toBe(0);
    expect(report.ablation?.modelOnly.dbMatchCoverage).toBe(0);
  });

  it('is omitted when no case was grounded or rawItems are missing', () => {
    const g = golden('p2', 'western', [['banana', 100, 89]], 89);
    const out = model([['banana', 100, 89, 0.9]], 0.9);
    expect(buildReport([{ golden: g, modelOutput: out, dbMatches: [false], rawItems: out.items }], 'test-v1').ablation).toBeUndefined();
    expect(buildReport([{ golden: g, modelOutput: out, dbMatches: [true] }], 'test-v1').ablation).toBeUndefined();
  });
});
