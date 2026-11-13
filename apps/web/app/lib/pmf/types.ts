/**
 * Product-market-fit scorecard — wire contract of GET /api/admin/pmf
 * (admin app → FitCircle → PMF). KPIs, thresholds and sources: lib/pmf/catalog.ts.
 * The admin app vendors a copy of this file (components/modules/pmf/types.ts); keep both in sync.
 */

export type PmfPeriod = 7 | 28 | 90;
export const PMF_PERIODS: PmfPeriod[] = [7, 28, 90];

export type KpiGroup = 'retention' | 'activation' | 'engagement' | 'growth' | 'monetization' | 'satisfaction';
export type KpiUnit = 'percent' | 'count' | 'usd' | 'ratio' | 'hours' | 'days_per_week' | 'score';
export type KpiStatus = 'on_track' | 'at_risk' | 'off_track' | 'too_few' | 'no_data' | 'not_measured' | 'no_target';
/** Where a threshold comes from. `benchmark` = not in our docs; a common industry rule of thumb (the UI says so). */
export type ThresholdSource = 'pmf_doc' | 'growth_plan' | 'benchmark';
export type SegmentDimension = 'platform' | 'channel';

export interface KpiThreshold {
  direction: 'higher' | 'lower';
  /** On track at or beyond this value. */
  target: number;
  /** At risk between `minimum` and `target`; off track beyond `minimum`. Null → at risk within 20% of target. */
  minimum: number | null;
  /** Best-in-class (informational). */
  best: number | null;
  /** The doc's PMF threshold, when it differs from the near-term target (informational). */
  pmfThreshold: number | null;
  source: ThresholdSource;
  /** e.g. "PMF-METRICS.md · Retention targets". */
  sourceLabel: string;
  note?: string;
}

export interface KpiWindow {
  start: string;
  end: string;
}

export interface KpiValue {
  value: number | null;
  /** Users (or subscribers / trials / days) the value rests on. */
  n: number;
  /** Successes for rates (value = numerator ÷ n). */
  numerator: number | null;
  window: KpiWindow;
}

export interface KpiTrendPoint {
  /** Bucket start (YYYY-MM-DD). */
  start: string;
  end: string;
  value: number | null;
  n: number;
}

export interface KpiSegmentRow {
  key: string;
  label: string;
  value: number | null;
  n: number;
  numerator: number | null;
  /** Same segment, previous period (for mix analysis). */
  previous: { value: number | null; n: number; numerator: number | null };
}

export interface KpiSegments {
  dimension: SegmentDimension;
  rows: KpiSegmentRow[];
}

export interface PmfKpi {
  id: string;
  name: string;
  group: KpiGroup;
  /** Plain-English definition (the ⓘ). */
  definition: string;
  unit: KpiUnit;
  threshold: KpiThreshold | null;
  status: KpiStatus;
  current: KpiValue;
  previous: KpiValue;
  /** current − previous (points for percent, units otherwise); null when either is missing. */
  change: number | null;
  /** 12 weekly buckets, oldest first, ending at the current window's end. */
  trend: KpiTrendPoint[];
  segments: KpiSegments[];
  /** n < LOW_SAMPLE_N: one user moves a rate by more than ~3 points. */
  lowSample: boolean;
  /** Days a sign-up needs before it can count (cohort KPIs); 0 for activity KPIs. */
  maturityDays: number;
  /** What the window means, e.g. "Sign-ups Oct 29 – Nov 4 (each needs 7 days to mature)". */
  windowLabel: string;
  /** Set when the KPI cannot be computed from data we collect. */
  notMeasured: { reason: string; needed: string } | null;
  /** PMF-score weight if this KPI feeds the PMF score. */
  pmfComponent: string | null;
  notes: string[];
}

export type InsightKind = 'score' | 'gap' | 'mover' | 'segment' | 'gate' | 'sample' | 'coverage' | 'win';
export type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface PmfInsight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  /** What is moving / where we stand and the likely reason. */
  body: string;
  /** What to do next. */
  action: string | null;
  kpiIds: string[];
  /** The numbers the insight rests on. */
  evidence: string[];
}

export interface PmfScoreComponent {
  key: 'retention' | 'engagement' | 'growth' | 'satisfaction' | 'economic';
  label: string;
  weight: number;
  kpiId: string;
  input: number | null;
  /** 0–100, capped. */
  score: number | null;
  formula: string;
}

export interface PmfScore {
  /** Null when any component is not measured (we never fill a gap with an estimate). */
  value: number | null;
  band: string | null;
  components: PmfScoreComponent[];
  missing: string[];
  bands: Array<{ min: number; max: number; label: string }>;
}

export interface PmfPopulation {
  method: string;
  /** Sign-ups left out in the loaded span, by reason. */
  excluded: { total: number; byReason: Record<string, number> };
  realSignups: { current: number; previous: number };
  currentWindow: KpiWindow;
  previousWindow: KpiWindow;
}

export interface PmfReport {
  generatedAt: string;
  period: PmfPeriod;
  today: string;
  timeZone: string;
  kpis: PmfKpi[];
  insights: PmfInsight[];
  score: PmfScore;
  population: PmfPopulation;
  /** First instant each activity signal exists (null = none). */
  signals: { activitySince: string | null; appOpensSince: string | null; amplitudeSince?: string | null; amplitudeThrough?: string | null };
  notes: string[];
  sources: Array<{ id: ThresholdSource; label: string; detail: string }>;
}
