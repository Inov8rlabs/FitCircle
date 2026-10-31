/** Experiment maths for Engage analytics (docs/ENGAGE_SPEC.md §10). */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |ε| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Two-sided two-proportion z-test p-value for x1/n1 vs x2/n2 (pooled SE).
 * Null when either group is empty or the pooled rate is 0 or 1.
 */
export function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (x1 + x2) / (n1 + n2);
  if (p <= 0 || p >= 1) return null;
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (x1 / n1 - x2 / n2) / se;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
}

/** Relative lift of `rate` over `control` ((r - c) / c); null without a control rate. */
export function lift(rate: number | null, control: number | null): number | null {
  if (rate === null || control === null || control === 0) return null;
  return (rate - control) / control;
}

export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
