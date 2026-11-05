/**
 * A circle member's progress as another member sees it (the "Profile" sheet).
 * The pure part: which metric a circle tracks, who may see it, and how raw rows
 * become dated entries and a summary. Contract: docs/MEMBER_PROGRESS_CONTRACT.md.
 *
 * Why this exists: the old history route picked a daily_tracking column from the
 * circle type but always answered in `entries[].weight`, so a steps circle showed
 * 10,109 steps as "22,286.5 lbs" (every client treats `weight` as kg), and
 * workout/custom circles fell through to the member's weigh-ins.
 */

export type CircleTypeWire = 'step_count' | 'weight_loss' | 'workout_minutes' | 'custom';
export type MemberMetric = 'steps' | 'weight' | 'workout_minutes' | 'custom' | 'none';
export type Aggregation = 'daily_total' | 'measurement';
export type HiddenReason = 'weight_private' | 'progress_private' | 'profile_private' | 'not_in_circle';

/** Where a metric's rows come from. */
export type MetricSource =
  | { table: 'daily_tracking'; column: 'steps' | 'weight_kg' }
  | { table: 'exercise_logs' }
  | { table: 'challenge_logs'; challengeId: string }
  | null;

export interface MetricSpec {
  metric: MemberMetric;
  unit: string | null;
  label: string | null;
  aggregation: Aggregation;
  source: MetricSource;
}

export interface CircleChallengeInfo {
  id: string;
  name: string | null;
  unit: string | null;
  goal_amount: number | string | null;
}

const WEIGHT_UNITS = new Set(['lb', 'lbs', 'kg', 'kgs', 'pounds', 'kilograms']);

const STEPS: MetricSpec = {
  metric: 'steps',
  unit: 'steps',
  label: 'Steps',
  aggregation: 'daily_total',
  source: { table: 'daily_tracking', column: 'steps' },
};
const WEIGHT: MetricSpec = {
  metric: 'weight',
  unit: 'kg',
  label: 'Weight',
  aggregation: 'measurement',
  source: { table: 'daily_tracking', column: 'weight_kg' },
};
const WORKOUT_MINUTES: MetricSpec = {
  metric: 'workout_minutes',
  unit: 'min',
  label: 'Workout minutes',
  aggregation: 'daily_total',
  source: { table: 'exercise_logs' },
};
const NONE: MetricSpec = { metric: 'none', unit: null, label: null, aggregation: 'daily_total', source: null };

/**
 * The metric a circle is about. step_count / weight_loss / workout_minutes map
 * directly; a custom circle follows its challenge (steps / weight units reuse
 * the synced data, anything else is the challenge's own logs); no challenge → none.
 * Unknown types (e.g. a legacy `workout_frequency`) are treated like custom.
 */
export function resolveCircleMetric(circleType: string | null | undefined, challenge: CircleChallengeInfo | null): MetricSpec {
  switch (circleType) {
    case 'step_count':
      return STEPS;
    case 'weight_loss':
      return WEIGHT;
    case 'workout_minutes':
      return WORKOUT_MINUTES;
    default: {
      if (!challenge) return NONE;
      const unit = (challenge.unit ?? '').trim().toLowerCase();
      if (unit === 'steps') return STEPS;
      if (WEIGHT_UNITS.has(unit)) return WEIGHT;
      return {
        metric: 'custom',
        unit: challenge.unit?.trim() || null,
        label: challenge.name?.trim() || null,
        aggregation: 'daily_total',
        source: { table: 'challenge_logs', challengeId: challenge.id },
      };
    }
  }
}

export interface PrivacyPrefs {
  profile_visibility: 'public' | 'friends' | 'private';
  show_weight: boolean;
  show_progress: boolean;
}

/** Same defaults as UserService.parsePrivacySettings: visible unless switched off. */
export function parsePrivacyPrefs(preferences: unknown): PrivacyPrefs {
  const p = (preferences && typeof preferences === 'object' ? preferences : {}) as Record<string, unknown>;
  const visibility = p.profile_visibility;
  return {
    profile_visibility: visibility === 'private' || visibility === 'friends' ? visibility : 'public',
    show_weight: p.show_weight !== false,
    show_progress: p.show_progress !== false,
  };
}

/**
 * What a viewer may see. The member always sees their own. Anyone else must be
 * an active member of the circle, and the member's privacy switches apply:
 * private profile hides everything, show_progress hides any metric, and
 * show_weight hides a weight metric.
 */
export function memberProgressVisibility(input: {
  isOwner: boolean;
  viewerInCircle: boolean;
  privacy: PrivacyPrefs;
  metric: MemberMetric;
}): { can_view: boolean; hidden_reason: HiddenReason | null } {
  if (input.isOwner) return { can_view: true, hidden_reason: null };
  if (!input.viewerInCircle) return { can_view: false, hidden_reason: 'not_in_circle' };
  if (input.privacy.profile_visibility === 'private') return { can_view: false, hidden_reason: 'profile_private' };
  if (input.metric === 'weight' && !input.privacy.show_weight) return { can_view: false, hidden_reason: 'weight_private' };
  if (!input.privacy.show_progress) return { can_view: false, hidden_reason: 'progress_private' };
  return { can_view: true, hidden_reason: null };
}

/** One raw row of the metric (a tracking day, a workout, a challenge log). */
export interface RawMetricRow {
  id: string;
  date: string;
  value: number | string | null | undefined;
  is_public?: boolean | null;
  note?: string | null;
}

export interface MemberProgressEntry {
  id: string;
  /** YYYY-MM-DD, the member's local day. Date only: never render a time. */
  date: string;
  value: number;
  /** value − the chronologically previous (older) entry; null for the oldest. */
  change: number | null;
  is_public: boolean;
  note: string | null;
}

export interface Period {
  start: string;
  end: string;
}

const toNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : (value as number | null | undefined);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** 2 decimals for weights / custom amounts; steps and minutes are whole. */
export function roundFor(metric: MemberMetric, n: number): number {
  return metric === 'steps' || metric === 'workout_minutes' ? Math.round(n) : Math.round(n * 100) / 100;
}

/** "2026-11-02 00:00:00+00" / "2026-11-02T05:00:00Z" / "2026-11-02" → "2026-11-02". */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : null;
}

/**
 * Raw rows → dated entries, newest first.
 * - Only real values: > 0. A 0 / null is a placeholder (old iOS builds wrote a
 *   0-step row for "tomorrow"), never a measurement or a day's total.
 * - No day after the member's local today; only days inside the circle period.
 * - Rows the member marked private (is_public = false) only for the member.
 * - Daily totals sum the rows of a day; measurements keep one value per day.
 * - change = value − older value (for weight: negative = lost).
 */
export function buildMemberEntries(
  rows: RawMetricRow[],
  opts: { metric: MemberMetric; aggregation: Aggregation; today: string; period: Period | null; isOwner: boolean }
): MemberProgressEntry[] {
  const byDay = new Map<string, MemberProgressEntry>();
  for (const row of rows) {
    const date = dayOf(row.date);
    const value = toNumber(row.value);
    if (!date || value == null || value <= 0) continue;
    if (date > opts.today) continue;
    if (opts.period && (date < opts.period.start || date > opts.period.end)) continue;
    const isPublic = row.is_public !== false;
    if (!isPublic && !opts.isOwner) continue;

    const existing = byDay.get(date);
    if (!existing) {
      byDay.set(date, { id: row.id, date, value, change: null, is_public: isPublic, note: row.note ?? null });
    } else if (opts.aggregation === 'daily_total') {
      existing.value += value;
      existing.is_public = existing.is_public && isPublic;
      existing.note = existing.note ?? row.note ?? null;
    }
    // measurement: one value per day; daily_tracking is unique per (user, day).
  }

  const ascending = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  ascending.forEach((entry, i) => {
    entry.value = roundFor(opts.metric, entry.value);
    const older = i > 0 ? ascending[i - 1] : null;
    entry.change = older ? roundFor(opts.metric, entry.value - older.value) : null;
  });
  return ascending.reverse();
}

export interface MemberProgressSummary {
  total: number | null;
  daily_average: number | null;
  days_logged: number;
  best_day: { date: string; value: number } | null;
  today_value: number | null;
  goal: number | null;
  progress_percentage: number | null;
  starting: number | null;
  current: number | null;
  target: number | null;
  change: number | null;
}

export const EMPTY_SUMMARY: MemberProgressSummary = {
  total: null,
  daily_average: null,
  days_logged: 0,
  best_day: null,
  today_value: null,
  goal: null,
  progress_percentage: null,
  starting: null,
  current: null,
  target: null,
  change: null,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The card numbers. Daily totals: total / average / best day / today, and goal
 * progress (the stored participant % when there is one, so it matches the
 * leaderboard, else total ÷ goal). Weight: start / current / target in kg with
 * change = current − start (negative = lost); the caller supplies them.
 */
export function buildMemberSummary(
  entries: MemberProgressEntry[],
  opts: {
    metric: MemberMetric;
    aggregation: Aggregation;
    today: string;
    goal?: number | string | null;
    storedProgressPct?: number | string | null;
    weight?: { startKg: number | null; currentKg: number | null; targetKg: number | null; progressPct: number | null };
  }
): MemberProgressSummary {
  const todayEntry = entries.find((e) => e.date === opts.today) ?? null;
  const best = entries.reduce<MemberProgressEntry | null>((top, e) => (!top || e.value > top.value ? e : top), null);

  if (opts.aggregation === 'measurement') {
    const w = opts.weight;
    const start = w?.startKg ?? (entries.length ? entries[entries.length - 1].value : null);
    const current = w?.currentKg ?? (entries.length ? entries[0].value : null);
    const target = w?.targetKg ?? null;
    return {
      ...EMPTY_SUMMARY,
      days_logged: entries.length,
      today_value: todayEntry?.value ?? null,
      starting: start,
      current,
      target,
      change: start != null && current != null ? roundFor(opts.metric, current - start) : null,
      progress_percentage: w?.progressPct ?? null,
    };
  }

  const total = entries.reduce((sum, e) => sum + e.value, 0);
  const goal = toNumber(opts.goal);
  const positiveGoal = goal != null && goal > 0 ? goal : null;
  const stored = toNumber(opts.storedProgressPct);
  const progress =
    stored != null ? round1(stored) : positiveGoal != null ? round1(Math.min(100, (total / positiveGoal) * 100)) : null;

  return {
    ...EMPTY_SUMMARY,
    total: entries.length ? roundFor(opts.metric, total) : 0,
    daily_average: entries.length ? roundFor(opts.metric, total / entries.length) : null,
    days_logged: entries.length,
    best_day: best ? { date: best.date, value: best.value } : null,
    today_value: todayEntry?.value ?? null,
    goal: positiveGoal,
    progress_percentage: progress,
  };
}

/** Legacy `/history` entry: `weight` is only ever a weight in kg. */
export interface LegacyHistoryEntry {
  id: string;
  date: string;
  weight: number | null;
  weight_change: number | null;
  is_public: boolean;
  note: string | null;
  notes: string | null;
}

/** Weight entries in the shape shipped iOS / Android decode (CheckInEntry). */
export function toLegacyWeightEntries(entries: MemberProgressEntry[]): LegacyHistoryEntry[] {
  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    weight: e.value,
    weight_change: e.change,
    is_public: e.is_public,
    note: e.note,
    notes: e.note,
  }));
}
