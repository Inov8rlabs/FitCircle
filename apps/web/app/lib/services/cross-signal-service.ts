import { createAdminSupabase } from '../supabase-admin';
import {
  type Confidence,
  type InsightDTO,
  type NutritionSignal,
  type OutcomeSignal,
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
  MEDIUM_CONFIDENCE_DAYS,
  MIN_CORRELATION,
  MIN_LOOKBACK_DAYS,
  MIN_SAMPLE_DAYS,
} from '../types/cross-signal';

import { BodyCompTrendsService } from './body-comp-trends-service';
import { EntitlementService } from './entitlement-service';

/**
 * CrossSignalService — gentle, correlational cross-signal insights (PRD v4 §6.10).
 *
 * Computed entirely from existing data (NO migration): we read the user's daily series
 * for each signal over a lookback window, build one value-per-day per signal, then
 * compute pairwise Pearson r between nutrition signals (protein, calories) and outcome
 * signals (mood, energy, caffeine, steps) on days where BOTH signals have a value.
 *
 * HEALTHY-ENGAGEMENT (§6.7) — see cross-signal.ts framing rules. In short: correlation
 * is never causation, tone is curious/gentle, and nutrition copy is ALWAYS positive
 * (never restriction-oriented). Copy generation lives in `copyFor`, which only ever
 * emits the positive-direction phrasing for both positive and negative correlations.
 */
export class CrossSignalService {
  // Pairs we evaluate: every nutrition signal × every outcome signal.
  private static readonly NUTRITION_SIGNALS: NutritionSignal[] = ['protein', 'calories'];
  private static readonly OUTCOME_SIGNALS: OutcomeSignal[] = ['mood', 'energy', 'caffeine', 'steps'];

  /**
   * FROZEN signature. Returns surfaced insights, strongest |correlation| first.
   * A pairing only surfaces when sampleDays >= MIN_SAMPLE_DAYS AND |r| >= MIN_CORRELATION.
   */
  static async getInsights(userId: string, lookbackDays: number = DEFAULT_LOOKBACK_DAYS): Promise<InsightDTO[]> {
    const days = clampLookback(lookbackDays);
    const since = isoDateNDaysAgo(days);

    const supabase = createAdminSupabase();

    // --- Pull each signal as a per-day map (date string -> number) ---------------
    // daily_tracking: one row per day already, so mood/energy/steps map directly.
    const { data: tracking } = await supabase
      .from('daily_tracking')
      .select('tracking_date, mood_score, energy_level, steps')
      .eq('user_id', userId)
      .gte('tracking_date', since);

    const mood = new Map<string, number>();
    const energy = new Map<string, number>();
    const steps = new Map<string, number>();
    for (const row of (tracking ?? []) as TrackingRow[]) {
      const d = row.tracking_date;
      if (!d) continue;
      if (isNum(row.mood_score)) mood.set(d, row.mood_score);
      if (isNum(row.energy_level)) energy.set(d, row.energy_level);
      if (isNum(row.steps)) steps.set(d, row.steps);
    }

    // beverage_logs: multiple rows per day -> sum caffeine_mg per entry_date.
    const { data: beverages } = await supabase
      .from('beverage_logs')
      .select('entry_date, caffeine_mg')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('entry_date', since);

    const caffeine = sumByDate(
      (beverages ?? []) as DatedValueRow[],
      (r) => r.entry_date,
      (r) => r.caffeine_mg
    );

    // food_log_entries: multiple rows per day -> sum protein_g / calories per entry_date.
    const { data: food } = await supabase
      .from('food_log_entries')
      .select('entry_date, protein_g, calories')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('entry_date', since);

    const protein = sumByDate(
      (food ?? []) as FoodRow[],
      (r) => r.entry_date,
      (r) => r.protein_g
    );
    const calories = sumByDate(
      (food ?? []) as FoodRow[],
      (r) => r.entry_date,
      (r) => r.calories
    );

    const series: Record<NutritionSignal | OutcomeSignal, Map<string, number>> = {
      protein,
      calories,
      mood,
      energy,
      caffeine,
      steps,
    };

    // --- Compute pairwise Pearson r on overlapping days --------------------------
    const insights: InsightDTO[] = [];
    for (const a of this.NUTRITION_SIGNALS) {
      for (const b of this.OUTCOME_SIGNALS) {
        const paired = alignByDate(series[a], series[b]);
        const sampleDays = paired.x.length;
        if (sampleDays < MIN_SAMPLE_DAYS) continue;

        const r = pearson(paired.x, paired.y);
        if (r === null || Math.abs(r) < MIN_CORRELATION) continue;

        const confidence: Confidence = sampleDays >= MEDIUM_CONFIDENCE_DAYS ? 'medium' : 'low';
        const { headline, detail } = copyFor(a, b, r);

        insights.push({
          id: `${a}__${b}`,
          headline,
          detail,
          signalA: a,
          signalB: b,
          correlation: round2(r),
          sampleDays,
          confidence,
        });
      }
    }

    // Strongest association first; clients can take the top N.
    insights.sort((x, y) => Math.abs(y.correlation) - Math.abs(x.correlation));

    // Body-comp descriptive insights (BODY_COMP_BUILD_CONTRACT §2) are appended AFTER
    // the correlation sort: they carry correlation 0 and belong behind any real
    // correlational finding. Failure-isolated — an error just omits them.
    insights.push(...(await this.bodyCompInsights(userId)));

    return insights;
  }

  // ---- body-composition signals (§ BODY_COMP_BUILD_CONTRACT) -----------------

  /** Scans in the last 90 days feed these insights — body-comp data is sparse
   *  (weekly/monthly scans), so the default 30-day correlation window would almost
   *  never see the ≥3 scans the copy is grounded in. */
  private static readonly BODY_COMP_LOOKBACK_DAYS = 90;
  /** Scan count at which a body-comp descriptive insight reads as 'medium' confidence. */
  private static readonly BODY_COMP_MEDIUM_CONFIDENCE_SCANS = 5;
  /** A cadence only counts as a rhythm when scans average one per ~6 weeks or better. */
  private static readonly BODY_COMP_CADENCE_MAX_AVG_GAP_DAYS = 45;

  /**
   * Descriptive, body-neutral body-comp insights: recomposition (from the server trend
   * engine) and scan cadence. Same InsightDTO shape with signalA/signalB 'bodyComp' and
   * correlation 0. PRIVATE-ONLY data — the insights endpoint is per-user (own-auth),
   * never a social surface. Gated on the server-driven body_comp_trends entitlement so
   * flipping that gate silently removes these too (nothing hardcoded). Failure-isolated:
   * any error returns [] and the classic correlational insights still ship.
   */
  private static async bodyCompInsights(userId: string): Promise<InsightDTO[]> {
    try {
      if (!(await EntitlementService.isFeatureAllowed(userId, 'body_comp_trends'))) return [];

      const supabase = createAdminSupabase();
      const sinceISO = new Date(Date.now() - this.BODY_COMP_LOOKBACK_DAYS * 86_400_000).toISOString();
      const { data } = await supabase
        .from('body_composition_logs')
        .select('measured_at, body_fat_pct, fat_mass_kg, skeletal_muscle_mass_kg')
        .eq('user_id', userId)
        .gte('measured_at', sinceISO)
        .order('measured_at', { ascending: true });

      // A "scan" is a log carrying composition data (BF% / fat mass / SMM) — the same
      // definition the trend engine's sufficiency rule uses.
      const scans = ((data ?? []) as Array<{
        measured_at: string;
        body_fat_pct: number | null;
        fat_mass_kg: number | null;
        skeletal_muscle_mass_kg: number | null;
      }>).filter((r) => r.body_fat_pct != null || r.fat_mass_kg != null || r.skeletal_muscle_mass_kg != null);
      if (scans.length < 3) return [];

      const out: InsightDTO[] = [];
      const confidence: Confidence =
        scans.length >= this.BODY_COMP_MEDIUM_CONFIDENCE_SCANS ? 'medium' : 'low';

      // (1) Recomposition — only the trend engine may make this call (its state already
      // requires ≥14-day fat & SMM spans beyond the noise floors).
      try {
        const trends = await BodyCompTrendsService.getTrends(userId, this.BODY_COMP_LOOKBACK_DAYS);
        if (trends.state === 'recomposition') {
          out.push({
            id: 'bodyComp__recomposition',
            headline: 'Your composition is shifting, not just your weight',
            detail:
              'Across your recent scans, fat mass tends to be moving down while skeletal muscle holds steady or rises. A weight-only view can miss this — the multi-week trend is the signal, and single scans will bounce around it.',
            signalA: 'bodyComp',
            signalB: 'bodyComp',
            correlation: 0,
            sampleDays: scans.length,
            confidence,
          });
        }
      } catch (err) {
        console.error('[CrossSignalService.bodyCompInsights] trends non-fatal:', err);
      }

      // (2) Scan cadence — celebrate an established rhythm; never pressure to scan more.
      const spanDays = Math.round(
        (Date.parse(scans[scans.length - 1].measured_at) - Date.parse(scans[0].measured_at)) / 86_400_000
      );
      const avgGapDays = spanDays / (scans.length - 1);
      if (spanDays >= 14 && avgGapDays <= this.BODY_COMP_CADENCE_MAX_AVG_GAP_DAYS) {
        out.push({
          id: 'bodyComp__scan_cadence',
          headline: 'A steady scan rhythm is building a clear picture',
          detail: `You've logged ${scans.length} body-composition scans over the last ${Math.max(1, Math.round(spanDays / 7))} weeks. A regular rhythm like this makes trends far more meaningful than any single reading — no need to scan more often than feels natural.`,
          signalA: 'bodyComp',
          signalB: 'bodyComp',
          correlation: 0,
          sampleDays: scans.length,
          confidence,
        });
      }

      return out;
    } catch (err) {
      // Non-blocking: body-comp insights are additive; never fail the endpoint for them.
      console.error('[CrossSignalService.bodyCompInsights] non-fatal:', err);
      return [];
    }
  }
}

// ============================================================================
// Pure helpers (no I/O) — kept module-private and deterministic for testability.
// ============================================================================

interface TrackingRow {
  tracking_date: string | null;
  mood_score: number | null;
  energy_level: number | null;
  steps: number | null;
}
interface DatedValueRow {
  entry_date: string | null;
  caffeine_mg: number | null;
}
interface FoodRow {
  entry_date: string | null;
  protein_g: number | null;
  calories: number | null;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** ISO yyyy-mm-dd for (today - n days), UTC — matches DATE columns. */
function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function clampLookback(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(Math.max(Math.trunc(n), MIN_LOOKBACK_DAYS), MAX_LOOKBACK_DAYS);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum a numeric field per date key, skipping null/non-finite values. */
function sumByDate<T>(
  rows: T[],
  dateOf: (r: T) => string | null,
  valueOf: (r: T) => number | null
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const d = dateOf(r);
    const v = valueOf(r);
    if (!d || !isNum(v)) continue;
    out.set(d, (out.get(d) ?? 0) + v);
  }
  return out;
}

/** Inner-join two date->value maps; returns parallel arrays for shared dates only. */
function alignByDate(a: Map<string, number>, b: Map<string, number>): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const [date, av] of a) {
    const bv = b.get(date);
    if (bv === undefined) continue;
    x.push(av);
    y.push(bv);
  }
  return { x, y };
}

/**
 * Pearson product-moment correlation. Returns null when undefined
 * (n < 2 or zero variance in either series).
 */
export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2 || y.length !== n) return null;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;

  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null; // no variance -> correlation undefined

  const r = cov / Math.sqrt(vx * vy);
  // Guard tiny floating-point overshoot beyond [-1, 1].
  return Math.max(-1, Math.min(1, r));
}

// ----------------------------------------------------------------------------
// Copy generation — the ONLY place insight text is produced.
// Framing rules (§6.7) are enforced here: associative not causal, gentle, and
// ALWAYS positive for nutrition. We surface the positive direction of the
// association; a negative r is reframed as a positive about the lower side.
// ----------------------------------------------------------------------------

const NUTRITION_LABEL: Record<NutritionSignal, string> = {
  protein: 'protein',
  calories: 'overall intake',
};

const OUTCOME_LABEL: Record<OutcomeSignal, string> = {
  mood: 'mood',
  energy: 'energy',
  caffeine: 'caffeine',
  steps: 'steps',
};

function copyFor(a: NutritionSignal, b: OutcomeSignal, r: number): { headline: string; detail: string } {
  const nutr = NUTRITION_LABEL[a];
  const out = OUTCOME_LABEL[b];
  const positive = r >= 0;

  // "tend to" / "looks like" keep this associative, never causal. No "should",
  // no "cut", no restriction framing — both branches phrase the higher-nutrition
  // side as the positive observation.
  if (positive) {
    return {
      headline: `Higher ${out} tends to show up on higher-${nutr} days`,
      detail: `Just an observation, not a rule: across your recent days, ${out} and ${nutr} tend to move together. Nothing to change — it's just something we noticed.`,
    };
  }
  // Negative r: still framed positively about the higher-nutrition / lower-other side.
  return {
    headline: `Your ${out} and ${nutr} tend to lean in opposite directions`,
    detail: `A gentle pattern, not a cause: on days with more ${nutr}, your ${out} tends to sit a little lower. Just noting the rhythm — there's nothing you need to do about it.`,
  };
}
