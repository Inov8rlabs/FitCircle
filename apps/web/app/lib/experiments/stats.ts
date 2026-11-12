/**
 * Small, dependency-free Bayesian helpers for experiment results
 * (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.6). Deterministic: every
 * simulation takes a seed, so the same data always yields the same numbers
 * (and the Admin Tools UI doesn't flicker between refreshes).
 */

/** 32-bit FNV-1a of a string — turns "key|metric|segment" into a seed. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: fast seeded uniform PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
function normal(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) — Marsaglia & Tsang (2000); shape < 1 via the boost trick. */
export function sampleGamma(shape: number, rand: () => number): number {
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = rand();
    return sampleGamma(shape + 1, rand) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rand: () => number): number {
  const x = sampleGamma(a, rand);
  const y = sampleGamma(b, rand);
  return x / (x + y);
}

/** Quantile of an ASCENDING-sorted array (linear interpolation). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface ArmPosterior {
  /** One draw per simulation, aligned across arms (draw i of every arm is one joint sample). */
  draws: Float64Array;
}

/**
 * Compare arms from aligned posterior draws.
 *  - pBest: share of draws where the arm is the best (ties split).
 *  - pBeats[ref]: P(arm better than `ref`).
 *  - ci90: 5th–95th percentile of the arm's draws.
 * `higherIsBetter=false` flips "better" (e.g. deletions, refunds).
 */
export function compareDraws(
  arms: Record<string, Float64Array>,
  opts: { higherIsBetter: boolean; reference?: string }
): Record<string, { pBest: number; pBeatsReference: number | null; ci90: [number, number] }> {
  const keys = Object.keys(arms);
  const sims = keys.length ? arms[keys[0]].length : 0;
  const wins: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const beats: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const sign = opts.higherIsBetter ? 1 : -1;
  for (let i = 0; i < sims; i++) {
    let best = -Infinity;
    let bestKeys: string[] = [];
    for (const k of keys) {
      const v = sign * arms[k][i];
      if (v > best) {
        best = v;
        bestKeys = [k];
      } else if (v === best) bestKeys.push(k);
    }
    for (const k of bestKeys) wins[k] += 1 / bestKeys.length;
    if (opts.reference && arms[opts.reference]) {
      const ref = sign * arms[opts.reference][i];
      for (const k of keys) {
        const v = sign * arms[k][i];
        if (v > ref) beats[k] += 1;
        else if (v === ref) beats[k] += 0.5;
      }
    }
  }
  const out: Record<string, { pBest: number; pBeatsReference: number | null; ci90: [number, number] }> = {};
  for (const k of keys) {
    const sorted = Array.from(arms[k]).sort((a, b) => a - b);
    out[k] = {
      pBest: sims ? wins[k] / sims : NaN,
      pBeatsReference: opts.reference && k !== opts.reference && sims ? beats[k] / sims : null,
      ci90: [quantileSorted(sorted, 0.05), quantileSorted(sorted, 0.95)],
    };
  }
  return out;
}

/** Beta(1 + x, 1 + n − x) posterior draws (uniform prior). */
export function betaDraws(x: number, n: number, sims: number, rand: () => number): Float64Array {
  const out = new Float64Array(sims);
  for (let i = 0; i < sims; i++) out[i] = sampleBeta(1 + x, 1 + Math.max(0, n - x), rand);
  return out;
}

/** Bootstrap distribution of the mean (resample with replacement). Empty input → NaN draws. */
export function bootstrapMeans(values: readonly number[], sims: number, rand: () => number): Float64Array {
  const out = new Float64Array(sims);
  const n = values.length;
  if (n === 0) return out.fill(NaN);
  for (let i = 0; i < sims; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[Math.floor(rand() * n)];
    out[i] = sum / n;
  }
  return out;
}

/**
 * Lift of `arm` vs `control` from aligned posterior draws: 5th–95th percentile of
 * the relative lift (arm / control − 1) and of the absolute difference (arm − control).
 * Draws where control is 0 (relative lift undefined) are skipped for the relative interval.
 */
export function liftIntervals(arm: Float64Array, control: Float64Array): { rel: [number, number] | null; abs: [number, number] | null } {
  const n = Math.min(arm.length, control.length);
  const rel: number[] = [];
  const abs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = arm[i];
    const c = control[i];
    if (!Number.isFinite(a) || !Number.isFinite(c)) continue;
    abs.push(a - c);
    if (c !== 0) rel.push(a / c - 1);
  }
  const q = (xs: number[]): [number, number] | null => {
    if (!xs.length) return null;
    xs.sort((p, r) => p - r);
    return [quantileSorted(xs, 0.05), quantileSorted(xs, 0.95)];
  };
  return { rel: q(rel), abs: q(abs) };
}

/** ln Γ(x) — Lanczos approximation (g = 7, n = 9). */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised upper incomplete gamma Q(s, x) (Numerical Recipes gser / gcf). */
function gammaQ(s: number, x: number): number {
  if (x <= 0) return 1;
  if (x < s + 1) {
    let sum = 1 / s;
    let term = sum;
    for (let k = 1; k < 500; k++) {
      term *= x / (s + k);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-x + s * Math.log(x) - lnGamma(s)));
  }
  let b = x + 1 - s;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.min(1, Math.exp(-x + s * Math.log(x) - lnGamma(s)) * h);
}

/** P(χ²_df ≥ stat): the p-value of a chi-square statistic. */
export function chiSquarePValue(stat: number, df: number): number {
  if (!(df > 0) || !Number.isFinite(stat)) return NaN;
  return gammaQ(df / 2, stat / 2);
}
