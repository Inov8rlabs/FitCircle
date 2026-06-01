// Nutrition eval harness — types & thresholds (FROZEN). PRD v4 §8.3.
// The keystone for a probabilistic feature: stage-level scoring so "calories are wrong"
// becomes "portion estimation overshoots rice on thali plates" (actionable).
//
// Design: scorers are PURE functions (golden truth + model output -> metrics), so the eval
// runs deterministically in CI. The runner (separate) feeds golden images through the live
// parsePhoto pipeline to PRODUCE the model outputs; scoring is decoupled and testable.

import type { PhotoParseResult } from './nutrition';

// ============================================================================
// Golden record (versioned, reviewable artifact — §8.3). Ground truth for one image.
// ============================================================================
export type GoldenProvenance = 'nutrition5k' | 'label' | 'weighed' | 'restaurant' | 'synthetic';

export interface GoldenItem {
  name: string;
  canonicalId: string | null; // expected foods-table match, when known (Stage 4)
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface GoldenSlices {
  cuisine: string;      // e.g. 'south_asian', 'canadian', 'western' — first-class per §6.11
  mealType: string;     // breakfast | lunch | dinner | snack
  difficulty: string;   // easy | medium | hard
  lighting: string;     // good | dim | mixed
}

export interface GoldenRecord {
  id: string;
  imageUri: string;
  provenance: GoldenProvenance;
  groundTruth: {
    items: GoldenItem[];
    total: { calories: number; protein: number; carbs: number; fat: number };
  };
  slices: GoldenSlices;
  datasetVersion: string;
}

// ============================================================================
// Per-record scored result + the aggregate report
// ============================================================================
export interface StageScores {
  // Stage 1 — Identification
  identTop1: number;        // 1 if the top/most-confident item fuzzy-matches a truth item, else 0
  multiItemRecall: number;  // fraction of truth items matched by some predicted item (0..1)
  hallucinationRate: number; // fraction of predicted items matching NO truth item (0..1)
  // Stage 2 — Portion estimation
  portionMape: number | null; // mean abs % error on grams across matched items; null if none matched
  // Stage 3 — Nutrition mapping (on the total)
  withinPct25: boolean;     // total calories within ±25% of truth
  withinPct40: boolean;     // total calories within ±40% of truth
  // Stage 4 — Database matching
  dbMatchCoverage: number;  // fraction of predicted items that resolve to a foods row (0..1)
  // Calibration input
  predictedConfidence: number; // model overallConfidence
  wasCorrect: boolean;         // identTop1 === 1 (used for ECE buckets)
}

export interface ScoredRecord {
  recordId: string;
  slices: GoldenSlices;
  scores: StageScores;
}

export interface SliceReport {
  slice: string;            // e.g. "cuisine=south_asian"
  n: number;
  identTop1Acc: number;
  multiItemRecall: number;
  hallucinationRate: number;
  portionMape: number | null;
  within25Rate: number;
  within40Rate: number;
  dbMatchCoverage: number;
}

export interface EvalReport {
  datasetVersion: string;
  n: number;
  overall: SliceReport;
  bySlice: SliceReport[];   // per cuisine / meal_type / difficulty / lighting
  ece: number;              // Expected Calibration Error across all records
  thresholds: typeof EVAL_THRESHOLDS;
  pass: boolean;            // every tracked metric meets its threshold
  failures: string[];       // human-readable list of which metrics missed
}

// ============================================================================
// Honest targets (§8.3). These gate CI — a regression past them fails the merge.
// ============================================================================
export const EVAL_THRESHOLDS = {
  identTop1Acc: 0.85,        // 85%+ common foods
  multiItemRecall: 0.9,      // 90%+ recall
  hallucinationRateMax: 0.05, // <5% hallucination
  portionMapeMax: 0.35,      // 25–35%; gate at the looser end
  within25RateMin: 0.7,      // 70% of totals within ±25%
  within40RateMin: 0.9,      // 90% within ±40%
  dbMatchCoverageMin: 0.8,   // 80%+ resolve to a foods row
  eceMax: 0.1,               // calibration: ECE < 0.1
} as const;

// A predicted item "matches" a truth item when fuzzy name similarity >= this (Stage 1, §8.3).
export const FUZZY_MATCH_THRESHOLD = 0.6;

// ============================================================================
// Runner contract: produces (golden, modelOutput, dbMatches) triples for scoring.
// modelOutput comes from the live parsePhoto pipeline (needs AI_GATEWAY_API_KEY);
// dbMatches[i] = did predicted item i resolve to a foods row (Stage 4, via FoodsService.search).
// ============================================================================
export interface EvalCase {
  golden: GoldenRecord;
  modelOutput: PhotoParseResult;
  dbMatches: boolean[]; // parallel to modelOutput.items
}
