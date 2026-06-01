// Nutrition eval scorers — PURE functions (PRD §8.3). No I/O, no LLM, no clock: deterministic
// so CI can run scoring on captured model outputs. The runner produces EvalCase[]; this scores them.

import type { ParsedFoodItem } from '../types/nutrition';
import {
  type EvalCase,
  type EvalReport,
  type GoldenItem,
  type ScoredRecord,
  type SliceReport,
  type StageScores,
  EVAL_THRESHOLDS,
  FUZZY_MATCH_THRESHOLD,
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

function matchesTruth(pred: ParsedFoodItem, truth: GoldenItem): boolean {
  return nameSimilarity(pred.name, truth.name) >= FUZZY_MATCH_THRESHOLD;
}

// ============================================================================
// Score one record across all four stages + calibration inputs.
// ============================================================================
export function scoreRecord(c: EvalCase): ScoredRecord {
  const preds = c.modelOutput.items;
  const truths = c.golden.groundTruth.items;

  // --- Stage 1: identification -------------------------------------------------
  // Top-1: the most-confident predicted item matches SOME truth item.
  const topPred = preds.length ? [...preds].sort((a, b) => b.confidence - a.confidence)[0] : null;
  const identTop1 = topPred && truths.some((t) => matchesTruth(topPred, t)) ? 1 : 0;

  // Multi-item recall: fraction of truth items matched by some prediction.
  const matchedTruths = truths.filter((t) => preds.some((p) => matchesTruth(p, t)));
  const multiItemRecall = truths.length ? matchedTruths.length / truths.length : 0;

  // Hallucination: predicted items matching NO truth item.
  const hallucinated = preds.filter((p) => !truths.some((t) => matchesTruth(p, t)));
  const hallucinationRate = preds.length ? hallucinated.length / preds.length : 0;

  // --- Stage 2: portion MAPE on matched items (grams) -------------------------
  const errs: number[] = [];
  for (const p of preds) {
    const t = truths.find((tt) => matchesTruth(p, tt));
    if (t && t.grams > 0) errs.push(Math.abs(p.quantity - t.grams) / t.grams);
  }
  const portionMape = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;

  // --- Stage 3: nutrition mapping on TOTAL calories ---------------------------
  const predCal = preds.reduce((s, p) => s + p.calories, 0);
  const truthCal = c.golden.groundTruth.total.calories;
  const calErr = truthCal > 0 ? Math.abs(predCal - truthCal) / truthCal : 1;
  const withinPct25 = calErr <= 0.25;
  const withinPct40 = calErr <= 0.4;

  // --- Stage 4: DB match coverage ---------------------------------------------
  const dbMatchCoverage = c.dbMatches.length
    ? c.dbMatches.filter(Boolean).length / c.dbMatches.length
    : 0;

  const scores: StageScores = {
    identTop1,
    multiItemRecall,
    hallucinationRate,
    portionMape,
    withinPct25,
    withinPct40,
    dbMatchCoverage,
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
  const mapeVals = recs.map((r) => r.scores.portionMape).filter((x): x is number => x !== null);
  return {
    slice: label,
    n,
    identTop1Acc: mean((s) => s.identTop1),
    multiItemRecall: mean((s) => s.multiItemRecall),
    hallucinationRate: mean((s) => s.hallucinationRate),
    portionMape: mapeVals.length ? mapeVals.reduce((a, b) => a + b, 0) / mapeVals.length : null,
    within25Rate: mean((s) => (s.withinPct25 ? 1 : 0)),
    within40Rate: mean((s) => (s.withinPct40 ? 1 : 0)),
    dbMatchCoverage: mean((s) => s.dbMatchCoverage),
  };
}

// ============================================================================
// Build the full report: overall + sliced (per cuisine/meal_type/difficulty/lighting) + ECE
// + pass/fail against EVAL_THRESHOLDS. Sliced reporting is MANDATORY (§8.3).
// ============================================================================
export function buildReport(cases: EvalCase[], datasetVersion: string): EvalReport {
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
  if (ece > t.eceMax) failures.push(`ECE ${ece.toFixed(3)} > ${t.eceMax}`);
  // Gate the first-class cuisine slices explicitly (§6.11): South Asian + Canadian must not lag.
  for (const sliceLabel of ['cuisine=south_asian', 'cuisine=canadian']) {
    const sr = bySlice.find((s) => s.slice === sliceLabel);
    if (sr && sr.n > 0 && sr.identTop1Acc < t.identTop1Acc) {
      failures.push(`${sliceLabel} identTop1Acc ${sr.identTop1Acc.toFixed(2)} < ${t.identTop1Acc}`);
    }
  }

  return { datasetVersion, n: scored.length, overall, bySlice, ece, thresholds: t, pass: failures.length === 0, failures };
}
