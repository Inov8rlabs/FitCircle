// Nutrition eval scorers — PURE functions (PRD §8.3). No I/O, no LLM, no clock: deterministic
// so CI can run scoring on captured model outputs. The runner produces EvalCase[]; this scores them.

import type { ParsedFoodItem } from '../types/nutrition';
import {
  type EvalCase,
  type EvalReport,
  type EvalRunStats,
  type GoldenItem,
  type ScoredRecord,
  type SliceReport,
  type StageScores,
  EVAL_THRESHOLDS,
  FUZZY_MATCH_THRESHOLD,
  GROUNDING_DENSITY_TOLERANCE,
  PORTION_MAPE_MIN_TRUTH_G,
  SEMANTIC_MATCH_THRESHOLD,
} from '../types/nutrition-eval';

// ============================================================================
// Fuzzy name match (Stage 1). Token Dice/Jaccard-style similarity — no embeddings needed for
// the deterministic core. "grilled chicken breast" vs "chicken" → high overlap on "chicken".
// (§8.3 allows embedding cosine OR LLM-as-judge; this is the cheap, deterministic baseline the
// CI scorer uses. An LLM-as-judge variant can replace this behind the same signature later.)
// ============================================================================
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2)
    );
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  // Dice coefficient: 2|A∩B| / (|A|+|B|)
  return (2 * inter) / (sa.size + sb.size);
}

/**
 * Index-based matcher so the optional semantic matrix can be consulted: a prediction matches a
 * truth item on token Dice OR on runner-supplied embedding similarity.
 */
function makeMatcher(c: EvalCase): (pi: number, ti: number) => boolean {
  const preds = c.modelOutput.items;
  const truths = c.golden.groundTruth.items;
  const sem = c.nameSimilarities;
  return (pi, ti) => {
    if (nameSimilarity(preds[pi].name, truths[ti].name) >= FUZZY_MATCH_THRESHOLD) return true;
    const s = sem?.[pi]?.[ti];
    return typeof s === 'number' && s >= SEMANTIC_MATCH_THRESHOLD;
  };
}

/** Best gram estimate for a predicted item: explicit grams, else quantity × gramsPerUnit. */
function predGrams(p: ParsedFoodItem): number {
  if (p.grams > 0) return p.grams;
  if (p.quantity > 0 && p.gramsPerUnit > 0) return p.quantity * p.gramsPerUnit;
  return p.grams;
}

/** |pred − truth| / truth, or null when the truth is 0 (undefined ratio). */
function absPctErr(pred: number, truth: number): number | null {
  return truth > 0 ? Math.abs(pred - truth) / truth : null;
}

// ============================================================================
// Score one record across all four stages + calibration inputs.
// ============================================================================
export function scoreRecord(c: EvalCase): ScoredRecord {
  const preds = c.modelOutput.items;
  const truths = c.golden.groundTruth.items;
  const matches = makeMatcher(c);
  const truthFor = (pi: number): GoldenItem | null => {
    for (let ti = 0; ti < truths.length; ti++) if (matches(pi, ti)) return truths[ti];
    return null;
  };

  // --- Stage 1: identification -------------------------------------------------
  // Top-1: the most-confident predicted item matches SOME truth item.
  let topIdx = -1;
  preds.forEach((p, i) => {
    if (topIdx < 0 || p.confidence > preds[topIdx].confidence) topIdx = i;
  });
  const identTop1 = topIdx >= 0 && truthFor(topIdx) ? 1 : 0;

  // Multi-item recall: fraction of truth items matched by some prediction.
  let matchedTruthCount = 0;
  truths.forEach((_, ti) => {
    if (preds.some((_, pi) => matches(pi, ti))) matchedTruthCount++;
  });
  const multiItemRecall = truths.length ? matchedTruthCount / truths.length : 0;

  // Hallucination: predicted items matching NO truth item.
  let hallucinatedCount = 0;
  preds.forEach((_, pi) => {
    if (!truthFor(pi)) hallucinatedCount++;
  });
  const hallucinationRate = preds.length ? hallucinatedCount / preds.length : 0;

  // --- Stage 2: portion error on matched items (grams) -------------------------
  // Compare the item's GRAMS (not `quantity`, which is in the model's natural unit —
  // "2 slices" vs 60 g truth was scoring as a 97% miss).
  // Percentage error is only meaningful for substantive items: Nutrition5k lists 0.2 g of
  // parsley or 1 g of oil, and a 20 g guess there is a 10 000% "error" that swamps the mean.
  // Those items still count in the absolute (grams) error.
  const pctErrs: number[] = [];
  const absErrs: number[] = [];
  preds.forEach((p, pi) => {
    const t = truthFor(pi);
    if (t && t.grams > 0) {
      const g = predGrams(p);
      if (t.grams >= PORTION_MAPE_MIN_TRUTH_G) pctErrs.push(Math.abs(g - t.grams) / t.grams);
      absErrs.push(Math.abs(g - t.grams));
    }
  });
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const portionMape = mean(pctErrs);
  const portionMaeG = mean(absErrs);

  // --- Stage 3: nutrition mapping on the plate TOTALS ----------------------------
  const sum = (f: (p: ParsedFoodItem) => number) => preds.reduce((s, p) => s + f(p), 0);
  const predCal = sum((p) => p.calories);
  const truth = c.golden.groundTruth.total;
  const calErr = truth.calories > 0 ? Math.abs(predCal - truth.calories) / truth.calories : 1;
  const calSignedPctErr = truth.calories > 0 ? (predCal - truth.calories) / truth.calories : 0;
  const withinPct25 = calErr <= 0.25;
  const withinPct40 = calErr <= 0.4;

  // --- Stage 4: DB match coverage + grounding correctness -----------------------
  const dbMatchCoverage = c.dbMatches.length
    ? c.dbMatches.filter(Boolean).length / c.dbMatches.length
    : 0;

  let groundingCorrectness: number | null = null;
  if (c.groundedKcalPer100g) {
    let considered = 0;
    let plausible = 0;
    preds.forEach((_, i) => {
      const density = c.groundedKcalPer100g?.[i];
      if (density == null) return;
      const t = truthFor(i);
      if (!t || t.grams <= 0) return;
      const truthDensity = (t.calories / t.grams) * 100;
      if (truthDensity <= 0) return;
      considered++;
      if (Math.abs(density - truthDensity) / truthDensity <= GROUNDING_DENSITY_TOLERANCE) plausible++;
    });
    groundingCorrectness = considered ? plausible / considered : null;
  }

  const scores: StageScores = {
    identTop1,
    multiItemRecall,
    hallucinationRate,
    portionMape,
    portionMaeG,
    withinPct25,
    withinPct40,
    calAbsPctErr: calErr,
    calAbsErr: Math.abs(predCal - truth.calories),
    calSignedPctErr,
    proteinAbsPctErr: absPctErr(sum((p) => p.proteinG), truth.protein),
    carbsAbsPctErr: absPctErr(sum((p) => p.carbsG), truth.carbs),
    fatAbsPctErr: absPctErr(sum((p) => p.fatG), truth.fat),
    dbMatchCoverage,
    groundingCorrectness,
    predictedConfidence: c.modelOutput.overallConfidence,
    wasCorrect: identTop1 === 1,
  };

  return { recordId: c.golden.id, slices: c.golden.slices, scores };
}

// ============================================================================
// Expected Calibration Error (§8.3). Bucket by predicted confidence; ECE = weighted mean of
// |accuracy − confidence| per bucket. ECE < 0.1 means a 0.9 confidence is right ~90% of the time.
// ============================================================================
export function expectedCalibrationError(scored: ScoredRecord[], buckets = 10): number {
  if (scored.length === 0) return 0;
  const bins: { conf: number[]; correct: number[] }[] = Array.from({ length: buckets }, () => ({ conf: [], correct: [] }));
  for (const s of scored) {
    const c = Math.min(Math.max(s.scores.predictedConfidence, 0), 1);
    const idx = Math.min(buckets - 1, Math.floor(c * buckets));
    bins[idx].conf.push(c);
    bins[idx].correct.push(s.scores.wasCorrect ? 1 : 0);
  }
  let ece = 0;
  for (const b of bins) {
    if (b.conf.length === 0) continue;
    const avgConf = b.conf.reduce((a, x) => a + x, 0) / b.conf.length;
    const acc = b.correct.reduce((a, x) => a + x, 0) / b.correct.length;
    ece += (b.conf.length / scored.length) * Math.abs(acc - avgConf);
  }
  return ece;
}

// ============================================================================
// Aggregate a set of scored records into a SliceReport.
// ============================================================================
function aggregate(label: string, recs: ScoredRecord[]): SliceReport {
  const n = recs.length;
  const mean = (f: (s: StageScores) => number) => (n ? recs.reduce((a, r) => a + f(r.scores), 0) / n : 0);
  // Mean over records where the metric is defined (null = undefined for that record).
  const meanDefined = (f: (s: StageScores) => number | null): number | null => {
    const vals = recs.map((r) => f(r.scores)).filter((x): x is number => x !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    slice: label,
    n,
    identTop1Acc: mean((s) => s.identTop1),
    multiItemRecall: mean((s) => s.multiItemRecall),
    hallucinationRate: mean((s) => s.hallucinationRate),
    portionMape: meanDefined((s) => s.portionMape),
    portionMaeG: meanDefined((s) => s.portionMaeG),
    within25Rate: mean((s) => (s.withinPct25 ? 1 : 0)),
    within40Rate: mean((s) => (s.withinPct40 ? 1 : 0)),
    calMape: mean((s) => s.calAbsPctErr),
    calMae: mean((s) => s.calAbsErr),
    calBias: mean((s) => s.calSignedPctErr),
    proteinMape: meanDefined((s) => s.proteinAbsPctErr),
    carbsMape: meanDefined((s) => s.carbsAbsPctErr),
    fatMape: meanDefined((s) => s.fatAbsPctErr),
    dbMatchCoverage: mean((s) => s.dbMatchCoverage),
    groundingCorrectness: meanDefined((s) => s.groundingCorrectness),
  };
}

// ============================================================================
// Build the full report: overall + sliced (per cuisine/meal_type/difficulty/lighting) + ECE
// + pass/fail against EVAL_THRESHOLDS. Sliced reporting is MANDATORY (§8.3).
// ============================================================================
export function buildReport(cases: EvalCase[], datasetVersion: string, run?: EvalRunStats): EvalReport {
  const scored = cases.map(scoreRecord);
  const overall = aggregate('overall', scored);
  const ece = expectedCalibrationError(scored);

  // Per-slice breakdowns across the four slice dimensions.
  const bySlice: SliceReport[] = [];
  const dims: Array<keyof ScoredRecord['slices']> = ['cuisine', 'mealType', 'difficulty', 'lighting'];
  for (const dim of dims) {
    const values = [...new Set(scored.map((s) => s.slices[dim]))];
    for (const v of values) {
      bySlice.push(aggregate(`${dim}=${v}`, scored.filter((s) => s.slices[dim] === v)));
    }
  }

  // Pass/fail: overall metrics must meet thresholds (per-slice is reported, not gated, to avoid
  // a tiny slice flapping CI — but South-Asian/Canadian cuisine slices ARE gated, per §6.11).
  const failures: string[] = [];
  const t = EVAL_THRESHOLDS;
  if (overall.identTop1Acc < t.identTop1Acc) failures.push(`identTop1Acc ${overall.identTop1Acc.toFixed(2)} < ${t.identTop1Acc}`);
  if (overall.multiItemRecall < t.multiItemRecall) failures.push(`multiItemRecall ${overall.multiItemRecall.toFixed(2)} < ${t.multiItemRecall}`);
  if (overall.hallucinationRate > t.hallucinationRateMax) failures.push(`hallucinationRate ${overall.hallucinationRate.toFixed(2)} > ${t.hallucinationRateMax}`);
  if (overall.portionMape !== null && overall.portionMape > t.portionMapeMax) failures.push(`portionMape ${overall.portionMape.toFixed(2)} > ${t.portionMapeMax}`);
  if (overall.within25Rate < t.within25RateMin) failures.push(`within25Rate ${overall.within25Rate.toFixed(2)} < ${t.within25RateMin}`);
  if (overall.within40Rate < t.within40RateMin) failures.push(`within40Rate ${overall.within40Rate.toFixed(2)} < ${t.within40RateMin}`);
  if (overall.dbMatchCoverage < t.dbMatchCoverageMin) failures.push(`dbMatchCoverage ${overall.dbMatchCoverage.toFixed(2)} < ${t.dbMatchCoverageMin}`);
  if (overall.groundingCorrectness !== null && overall.groundingCorrectness < t.groundingCorrectnessMin) {
    failures.push(`groundingCorrectness ${overall.groundingCorrectness.toFixed(2)} < ${t.groundingCorrectnessMin}`);
  }
  if (ece > t.eceMax) failures.push(`ECE ${ece.toFixed(3)} > ${t.eceMax}`);
  // Gate the first-class cuisine slices explicitly (§6.11): South Asian + Canadian must not lag.
  for (const sliceLabel of ['cuisine=south_asian', 'cuisine=canadian']) {
    const sr = bySlice.find((s) => s.slice === sliceLabel);
    if (sr && sr.n > 0 && sr.identTop1Acc < t.identTop1Acc) {
      failures.push(`${sliceLabel} identTop1Acc ${sr.identTop1Acc.toFixed(2)} < ${t.identTop1Acc}`);
    }
  }

  const report: EvalReport = { datasetVersion, n: scored.length, overall, bySlice, ece, thresholds: t, pass: failures.length === 0, failures };
  if (run) report.run = run;
  return report;
}
