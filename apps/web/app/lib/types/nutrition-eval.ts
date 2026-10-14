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
export type GoldenProvenance = 'nutrition5k' | 'snapme' | 'label' | 'weighed' | 'restaurant' | 'synthetic';

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
  portionMaeG: number | null; // mean abs error in grams across matched items; null if none matched
  // Stage 3 — Nutrition mapping (on the plate totals)
  withinPct25: boolean;     // total calories within ±25% of truth
  withinPct40: boolean;     // total calories within ±40% of truth
  calAbsPctErr: number;     // |pred − truth| / truth on total calories (1 when truth is 0)
  calAbsErr: number;        // |pred − truth| total calories
  calSignedPctErr: number;  // (pred − truth) / truth: >0 means the model over-estimates
  proteinAbsPctErr: number | null; // |pred − truth| / truth on total protein; null when truth is 0
  carbsAbsPctErr: number | null;
  fatAbsPctErr: number | null;
  // Stage 4 — Database matching
  dbMatchCoverage: number;  // fraction of predicted items that resolve to a foods row (0..1)
  // Grounding correctness: of the predicted items that were grounded to a DB row AND match a
  // truth item, the fraction whose nutrient density (kcal/100 g) is within ±20% of the truth
  // item's density. null when nothing qualifies. A wrong row is worse than no row.
  groundingCorrectness: number | null;
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
  portionMaeG: number | null;
  within25Rate: number;
  within40Rate: number;
  calMape: number;          // mean |pct err| on total calories
  calMae: number;           // mean |err| on total calories (kcal)
  calBias: number;          // mean signed pct err on total calories (+ = over-estimate)
  proteinMape: number | null;
  carbsMape: number | null;
  fatMape: number | null;
  dbMatchCoverage: number;
  groundingCorrectness: number | null;
}

// Per-run observability captured by the runner (not scored, but reported). Populated when the
// runner collects it; absent for reports built from captured outputs alone.
export interface EvalRunStats {
  model: string;                 // the vision model under test
  promptVariant: string | null;
  attempted: number;             // golden records attempted
  parsed: number;                // records that produced a scorable output
  parseFailures: number;         // attempts that threw (schema/timeout/provider)
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  inputTokensMean: number | null;
  outputTokensMean: number | null;
  costUsdTotal: number | null;   // from the price table; null when the model's price is unknown
  costUsdPerParse: number | null;
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
  run?: EvalRunStats;
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
  groundingCorrectnessMin: 0.9, // 90%+ of grounded+matched items land on a plausible density
  eceMax: 0.1,               // calibration: ECE < 0.1
} as const;

// A predicted item "matches" a truth item when fuzzy name similarity >= this (Stage 1, §8.3).
export const FUZZY_MATCH_THRESHOLD = 0.6;
// …or when the runner-supplied embedding cosine (text-embedding-3-small) is >= this. Calibrated
// on food-name pairs: same food with different wording sits ~0.6–0.8, different foods ~0.2–0.45.
export const SEMANTIC_MATCH_THRESHOLD = 0.55;

// Grounding correctness tolerance on nutrient density (kcal per 100 g).
export const GROUNDING_DENSITY_TOLERANCE = 0.2;

// Portion MAPE only counts matched truth items at least this heavy (grams); lighter items
// (a pinch of herbs, a teaspoon of oil) still count toward portion MAE in grams.
export const PORTION_MAPE_MIN_TRUTH_G = 5;

// ============================================================================
// Runner contract: produces (golden, modelOutput, dbMatches) triples for scoring.
// modelOutput comes from the live parsePhoto pipeline (needs AI_GATEWAY_API_KEY);
// dbMatches[i] = did predicted item i resolve to a foods row (Stage 4, via FoodsService.search).
// ============================================================================
export interface EvalCase {
  golden: GoldenRecord;
  modelOutput: PhotoParseResult;
  dbMatches: boolean[]; // parallel to modelOutput.items
  // Optional per-item grounding provenance from the REAL groundItems path: the kcal/100 g the
  // grounded item ended up with (null when the item was not grounded). Parallel to items.
  groundedKcalPer100g?: Array<number | null>;
  // Optional semantic name similarity, `nameSimilarities[predIndex][truthIndex]` in 0..1
  // (embedding cosine, computed by the runner). The scorer matches on
  // max(tokenDice, semantic) so FNDDS-style truth labels ("Egg, whole, boiled or poached")
  // still match a model's "large boiled egg". Scorers stay pure: the runner does the I/O.
  nameSimilarities?: number[][];
  // Optional per-case observability from the runner.
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}
