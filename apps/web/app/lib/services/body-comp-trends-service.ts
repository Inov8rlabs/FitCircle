import { createAdminSupabase } from '../supabase-admin';
import {
  type BodyCompDelta,
  type BodyCompInsight,
  type BodyCompProjection,
  type BodyCompSource,
  type BodyCompTrendPoint,
  type BodyCompTrendState,
  type BodyCompTrends,
} from '../types/body-composition';

/**
 * BodyCompTrendsService — the server-side trend engine (BODY_COMP_BUILD_CONTRACT §2).
 * Clients are thin renderers: state, series, deltas, projection band, and every insight
 * string are computed HERE and rendered verbatim. Nothing in this file may leak into any
 * social surface.
 *
 * Engine constants (contract "Trend engine constants"):
 *  - EMA α=0.25 over daily weight (daily_tracking ∪ body-comp weights), missing days
 *    linearly interpolated; trailing 21-day smoothed slope.
 *  - Noise floors: |ΔBF%| < 1.0, |ΔSMM| < 1.0 kg, |Δweight| < 0.5 kg → withinNoise.
 *    Fat mass / lean mass reuse the weight floor (0.5 kg) — they are weight-derived.
 *  - insufficient_data until ≥3 scans OR ≥14 daily weight points.
 *  - Projection: needs a body_fat_pct goal in profiles.goals + ≥28 days of data; rate
 *    clamped to 0.5–1% BW/week; returned as a date RANGE, never a single date.
 *  - recomposition := fat-mass trend down beyond noise AND SMM within noise or up.
 */

export const TREND_EMA_ALPHA = 0.25;
export const TREND_SLOPE_WINDOW_DAYS = 21;
export const TREND_MIN_SCANS = 3;
export const TREND_MIN_WEIGHT_DAYS = 14;
export const PROJECTION_MIN_DATA_DAYS = 28;
/** Minimum day-span between first and last scan for fat/SMM trend calls (recomposition). */
export const TREND_MIN_SCAN_SPAN_DAYS = 14;

export const NOISE_FLOORS = {
  weightKg: 0.5,
  bodyFatPct: 1.0,
  fatMassKg: 0.5,
  skeletalMuscleMassKg: 1.0,
} as const;

export const TRENDS_DISCLAIMER =
  'Body-composition estimates vary between devices, hydration levels, and time of day. ' +
  'Multi-week trends are more meaningful than any single measurement. This information is ' +
  'for general wellness only and is not medical advice.';

// ============================================================================
// Pure engine (exported for unit tests)
// ============================================================================

export interface TrendInputLog {
  measuredAt: string;
  source: BodyCompSource;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  fatMassKg?: number | null;
  skeletalMuscleMassKg?: number | null;
}

export interface TrendInput {
  /** daily_tracking weight rows: date YYYY-MM-DD, weight in kg. */
  dailyWeights: { date: string; weightKg: number }[];
  /** body_composition_logs in the lookback window (post-derivation values). */
  logs: TrendInputLog[];
  goalBodyFatPct: number | null;
  /** YYYY-MM-DD; defaults to the current UTC date (injectable for tests). */
  today?: string;
}

/**
 * Source precedence per metric per day (contract): photo_scan/dexa >
 * healthkit/health_connect/smart_scale > manual; daily_tracking weight ranks with
 * manual. Most recent wins within the same priority.
 */
export function sourcePriority(source: BodyCompSource | 'daily_tracking'): number {
  switch (source) {
    case 'photo_scan':
    case 'dexa':
      return 3;
    case 'healthkit':
    case 'health_connect':
    case 'smart_scale':
      return 2;
    default:
      return 1; // manual, daily_tracking
  }
}

/** Linearly interpolate missing calendar days between sorted (date, value) anchors. */
export function interpolateDaily(points: { date: string; value: number }[]): {
  date: string;
  value: number;
}[] {
  if (points.length === 0) return [];
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const gap = daysBetween(a.date, b.date);
    out.push(a);
    for (let d = 1; d < gap; d++) {
      out.push({ date: addDays(a.date, d), value: a.value + ((b.value - a.value) * d) / gap });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Exponential moving average, seeded with the first value. */
export function computeEma(values: number[], alpha: number = TREND_EMA_ALPHA): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    out.push(i === 0 ? values[i] : alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

export function computeBodyCompTrends(input: TrendInput): BodyCompTrends {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const logs = [...input.logs].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));

  // --- Per-day metric resolution with source precedence -----------------------------
  type Candidate = { value: number; priority: number; timeMs: number };
  const byDay = new Map<string, { [metric: string]: Candidate }>();
  const consider = (date: string, metric: string, candidate: Candidate) => {
    const day = byDay.get(date) ?? {};
    const current = day[metric];
    if (
      !current ||
      candidate.priority > current.priority ||
      (candidate.priority === current.priority && candidate.timeMs >= current.timeMs)
    ) {
      day[metric] = candidate;
    }
    byDay.set(date, day);
  };

  for (const dw of input.dailyWeights) {
    consider(dw.date, 'weightKg', { value: dw.weightKg, priority: 1, timeMs: Date.parse(`${dw.date}T00:00:00Z`) });
  }
  for (const log of logs) {
    const date = log.measuredAt.slice(0, 10);
    const priority = sourcePriority(log.source);
    const timeMs = Date.parse(log.measuredAt);
    if (log.weightKg != null) consider(date, 'weightKg', { value: log.weightKg, priority, timeMs });
    if (log.bodyFatPct != null) consider(date, 'bodyFatPct', { value: log.bodyFatPct, priority, timeMs });
    if (log.fatMassKg != null) consider(date, 'fatMassKg', { value: log.fatMassKg, priority, timeMs });
    if (log.skeletalMuscleMassKg != null) {
      consider(date, 'skeletalMuscleMassKg', { value: log.skeletalMuscleMassKg, priority, timeMs });
    }
  }

  const allDays = [...byDay.keys()].sort();

  // --- Smoothed daily weight --------------------------------------------------------
  const weightAnchors = allDays
    .filter((d) => byDay.get(d)!.weightKg != null)
    .map((d) => ({ date: d, value: byDay.get(d)!.weightKg.value }));
  const interpolated = interpolateDaily(weightAnchors);
  const ema = computeEma(interpolated.map((p) => p.value));
  const smoothedByDay = new Map(interpolated.map((p, i) => [p.date, ema[i]]));

  // --- Series -----------------------------------------------------------------------
  const seriesDays = [...new Set([...smoothedByDay.keys(), ...allDays])].sort();
  const series: BodyCompTrendPoint[] = seriesDays.map((date) => {
    const day = byDay.get(date);
    const smoothed = smoothedByDay.get(date);
    const point: BodyCompTrendPoint = { date };
    if (smoothed != null) point.weightKgSmoothed = round2(smoothed);
    if (day?.fatMassKg != null) point.fatMassKg = day.fatMassKg.value;
    if (day?.skeletalMuscleMassKg != null) point.skeletalMuscleMassKg = day.skeletalMuscleMassKg.value;
    if (day?.bodyFatPct != null) point.bodyFatPct = day.bodyFatPct.value;
    return point;
  });

  // --- Sufficiency ------------------------------------------------------------------
  const scans = logs.filter(
    (l) => l.bodyFatPct != null || l.fatMassKg != null || l.skeletalMuscleMassKg != null
  );
  const weightDayCount = weightAnchors.length;
  const insufficient = scans.length < TREND_MIN_SCANS && weightDayCount < TREND_MIN_WEIGHT_DAYS;

  // --- Latest vs previous log, per metric -------------------------------------------
  const latestVsPrevious = computeDeltas(logs);

  // --- State ------------------------------------------------------------------------
  const state = insufficient
    ? 'insufficient_data'
    : resolveTrendState({
        fatTrend: metricTrend(byDay, allDays, 'fatMassKg'),
        smmTrend: metricTrend(byDay, allDays, 'skeletalMuscleMassKg'),
        weightChange21: trailingChange(ema, TREND_SLOPE_WINDOW_DAYS),
      });

  // --- Projection band --------------------------------------------------------------
  const dataSpanDays = allDays.length >= 2 ? daysBetween(allDays[0], allDays[allDays.length - 1]) : 0;
  const latestBf = latestMetric(byDay, allDays, 'bodyFatPct');
  const latestWeight =
    interpolated.length > 0 ? ema[ema.length - 1] : latestMetric(byDay, allDays, 'weightKg');
  const projection = computeProjection({
    goalBodyFatPct: input.goalBodyFatPct,
    currentWeightKg: latestWeight,
    currentBodyFatPct: latestBf,
    dataSpanDays,
    today,
  });

  const insights = buildInsights(state, latestVsPrevious, projection);

  return { state, series, latestVsPrevious, projection, insights, disclaimer: TRENDS_DISCLAIMER };
}

/** State from fat/SMM scan trends + 21-day smoothed weight change. */
export function resolveTrendState(input: {
  fatTrend: { delta: number; spanDays: number } | null;
  smmTrend: { delta: number; spanDays: number } | null;
  weightChange21: number | null;
}): Exclude<BodyCompTrendState, 'insufficient_data'> {
  const { fatTrend, smmTrend, weightChange21 } = input;

  const fatAssessable = fatTrend != null && fatTrend.spanDays >= TREND_MIN_SCAN_SPAN_DAYS;
  const smmAssessable = smmTrend != null && smmTrend.spanDays >= TREND_MIN_SCAN_SPAN_DAYS;
  if (
    fatAssessable &&
    smmAssessable &&
    fatTrend.delta <= -NOISE_FLOORS.fatMassKg &&
    // "within noise or up": strict >, consistent with |delta| < floor everywhere
    // else — an SMM drop of exactly the noise floor is a beyond-noise decline.
    smmTrend.delta > -NOISE_FLOORS.skeletalMuscleMassKg
  ) {
    return 'recomposition';
  }

  if (weightChange21 != null) {
    if (weightChange21 <= -NOISE_FLOORS.weightKg) return 'losing';
    if (weightChange21 >= NOISE_FLOORS.weightKg) return 'gaining';
    return 'steady';
  }

  // No weight series at all (scan-only user): fall back to the fat-mass trend.
  if (fatAssessable) {
    if (fatTrend.delta <= -NOISE_FLOORS.fatMassKg) return 'losing';
    if (fatTrend.delta >= NOISE_FLOORS.fatMassKg) return 'gaining';
  }
  return 'steady';
}

/** Latest log vs the previous log carrying the same metric, with per-metric noise floors. */
export function computeDeltas(logsAsc: TrendInputLog[]): BodyCompDelta[] {
  const metrics: { key: keyof typeof NOISE_FLOORS; digits: number }[] = [
    { key: 'weightKg', digits: 2 },
    { key: 'bodyFatPct', digits: 1 },
    { key: 'fatMassKg', digits: 2 },
    { key: 'skeletalMuscleMassKg', digits: 2 },
  ];
  const deltas: BodyCompDelta[] = [];
  for (const { key, digits } of metrics) {
    const values: number[] = [];
    for (let i = logsAsc.length - 1; i >= 0 && values.length < 2; i--) {
      const v = logsAsc[i][key];
      if (v != null) values.push(v);
    }
    if (values.length === 2) {
      const delta = roundTo(values[0] - values[1], digits);
      deltas.push({ metric: key, delta, withinNoise: Math.abs(delta) < NOISE_FLOORS[key] });
    }
  }
  return deltas;
}

/**
 * Projection band (contract): requires a BF% goal + ≥28 days of data + current weight
 * and BF%. Weight at goal assumes lean mass holds; the loss rate is clamped to
 * 0.5–1% of current body weight per week, giving a date RANGE, never a single date.
 */
export function computeProjection(input: {
  goalBodyFatPct: number | null;
  currentWeightKg: number | null;
  currentBodyFatPct: number | null;
  dataSpanDays: number;
  today: string;
}): BodyCompProjection | null {
  const { goalBodyFatPct, currentWeightKg, currentBodyFatPct, dataSpanDays, today } = input;
  if (goalBodyFatPct == null || currentWeightKg == null || currentBodyFatPct == null) return null;
  if (dataSpanDays < PROJECTION_MIN_DATA_DAYS) return null;
  if (goalBodyFatPct >= currentBodyFatPct) return null;

  const leanKg = currentWeightKg * (1 - currentBodyFatPct / 100);
  const goalWeightKg = leanKg / (1 - goalBodyFatPct / 100);
  const lossKg = currentWeightKg - goalWeightKg;
  if (lossKg < 0.1) return null;

  const fastKgPerWeek = 0.01 * currentWeightKg; // 1% BW/week
  const slowKgPerWeek = 0.005 * currentWeightKg; // 0.5% BW/week
  const earliestDays = Math.ceil((lossKg / fastKgPerWeek) * 7);
  const latestDays = Math.ceil((lossKg / slowKgPerWeek) * 7);

  return {
    goalBodyFatPct,
    earliestDate: addDays(today, earliestDays),
    latestDate: addDays(today, latestDays),
  };
}

// ============================================================================
// Insight copy — server-authored, body-neutral. Clients render verbatim.
// Rules: trend over single scan; never celebrate speed of change; no clinical
// language; direction is information, not a verdict.
// ============================================================================

function buildInsights(
  state: BodyCompTrendState,
  deltas: BodyCompDelta[],
  projection: BodyCompProjection | null
): BodyCompInsight[] {
  const insights: BodyCompInsight[] = [];

  switch (state) {
    case 'insufficient_data':
      insights.push({
        id: 'getting_started',
        headline: 'Keep logging to unlock trends',
        detail:
          'Trends need at least 3 scans or about two weeks of weight entries. Every log you add makes the picture clearer.',
      });
      break;
    case 'recomposition':
      insights.push({
        id: 'state_recomposition',
        headline: 'Body recomposition in progress',
        detail:
          'Fat mass is trending down while skeletal muscle is holding steady or rising. A weight-only chart cannot see this — your composition is changing even if the scale looks flat.',
      });
      break;
    case 'losing':
      insights.push({
        id: 'state_losing',
        headline: 'Weight is trending down',
        detail:
          'Your smoothed weight has moved down over the last three weeks. The multi-week trend line is the signal — individual weigh-ins will bounce around it.',
      });
      break;
    case 'gaining':
      insights.push({
        id: 'state_gaining',
        headline: 'Weight is trending up',
        detail:
          'Your smoothed weight has moved up over the last three weeks. Whether that matches your intent depends on your goal — the trend is information, not a verdict.',
      });
      break;
    case 'steady':
      insights.push({
        id: 'state_steady',
        headline: 'Holding steady',
        detail:
          'Your smoothed weight has stayed within the measurement noise band over the last three weeks. Steady phases are a normal part of any long-term change.',
      });
      break;
  }

  if (deltas.some((d) => d.withinNoise)) {
    insights.push({
      id: 'measurement_noise',
      headline: 'Small changes are normal',
      detail:
        'Some of your recent scan-to-scan changes are within typical measurement variation for body-composition devices. The multi-week trend is what matters — single readings are noisy.',
    });
  }

  if (projection) {
    insights.push({
      id: 'projection_band',
      headline: 'About your projection',
      detail:
        'The projected date range assumes a sustainable rate of change of 0.5–1% of body weight per week. It updates as new data arrives and is an estimate, not a promise.',
    });
  }

  return insights;
}

// ============================================================================
// Service (DB access)
// ============================================================================

export class BodyCompTrendsService {
  static async getTrends(userId: string, lookbackDays: number = 180): Promise<BodyCompTrends> {
    const supabase = createAdminSupabase();
    const sinceMs = Date.now() - lookbackDays * 86_400_000;
    const sinceISO = new Date(sinceMs).toISOString();
    const sinceDate = sinceISO.slice(0, 10);

    const [dailyRes, logsRes, profileRes] = await Promise.all([
      supabase
        .from('daily_tracking')
        .select('tracking_date, weight_kg')
        .eq('user_id', userId)
        .gte('tracking_date', sinceDate)
        .not('weight_kg', 'is', null)
        .order('tracking_date', { ascending: true }),
      supabase
        .from('body_composition_logs')
        .select('measured_at, source, weight_kg, body_fat_pct, fat_mass_kg, skeletal_muscle_mass_kg')
        .eq('user_id', userId)
        .gte('measured_at', sinceISO)
        .order('measured_at', { ascending: true }),
      supabase.from('profiles').select('goals').eq('id', userId).maybeSingle(),
    ]);

    if (dailyRes.error) throw new Error(`body-comp trends failed: ${dailyRes.error.message}`);
    if (logsRes.error) throw new Error(`body-comp trends failed: ${logsRes.error.message}`);

    const dailyWeights = (dailyRes.data ?? []).map((r) => ({
      date: r.tracking_date as string,
      weightKg: Number(r.weight_kg),
    }));
    const logs: TrendInputLog[] = (logsRes.data ?? []).map((r) => ({
      measuredAt: r.measured_at as string,
      source: r.source as BodyCompSource,
      weightKg: r.weight_kg,
      bodyFatPct: r.body_fat_pct,
      fatMassKg: r.fat_mass_kg,
      skeletalMuscleMassKg: r.skeletal_muscle_mass_kg,
    }));

    return computeBodyCompTrends({
      dailyWeights,
      logs,
      goalBodyFatPct: extractBodyFatGoal(profileRes.data?.goals),
    });
  }
}

/**
 * profiles.goals is a JSONB array of { type, target, unit, ... } entries (see
 * /api/mobile/profile/goals). The body-fat goal is the entry typed body_fat_pct
 * (accepting close variants) with a plausible percent target.
 */
export function extractBodyFatGoal(goals: unknown): number | null {
  if (!Array.isArray(goals)) return null;
  for (const goal of goals) {
    if (!goal || typeof goal !== 'object') continue;
    const g = goal as { type?: unknown; target?: unknown };
    if (
      typeof g.type === 'string' &&
      ['body_fat_pct', 'body_fat', 'body_fat_percentage'].includes(g.type) &&
      typeof g.target === 'number' &&
      g.target >= 2 &&
      g.target <= 65
    ) {
      return g.target;
    }
  }
  return null;
}

// ============================================================================
// Small helpers
// ============================================================================

function metricTrend(
  byDay: Map<string, { [metric: string]: { value: number } }>,
  sortedDays: string[],
  metric: string
): { delta: number; spanDays: number } | null {
  const days = sortedDays.filter((d) => byDay.get(d)?.[metric] != null);
  if (days.length < 2) return null;
  const first = days[0];
  const last = days[days.length - 1];
  return {
    delta: byDay.get(last)![metric].value - byDay.get(first)![metric].value,
    spanDays: daysBetween(first, last),
  };
}

function latestMetric(
  byDay: Map<string, { [metric: string]: { value: number } }>,
  sortedDays: string[],
  metric: string
): number | null {
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const v = byDay.get(sortedDays[i])?.[metric];
    if (v != null) return v.value;
  }
  return null;
}

/** Smoothed change over the trailing `windowDays` (or the whole series when shorter). */
function trailingChange(ema: number[], windowDays: number): number | null {
  if (ema.length < 2) return null;
  const span = Math.min(windowDays, ema.length - 1);
  return ema[ema.length - 1] - ema[ema.length - 1 - span];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
