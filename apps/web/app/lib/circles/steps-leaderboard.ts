/**
 * Steps leaderboard for a circle — the pure part (no database).
 *
 * Three metrics, each ranked server-side so the apps only render and sort:
 *   today_steps     steps on the member's own local "today"
 *   total_steps     steps summed over every circle day so far
 *   goal_pct_today  today_steps as a % of the daily step goal (uncapped)
 *
 * Steps come from daily_tracking (one row per user per LOCAL calendar day,
 * synced from HealthKit / Health Connect). A circle runs on calendar days:
 * start_date is the first day, end_date is exclusive (the day the circle
 * completes — CircleService.getCircleStatus and the lobby's addDays(start, n)).
 *
 * Spec: docs/CIRCLE_STEPS_LEADERBOARD.md
 */

export const STEPS_METRICS = ['today_steps', 'total_steps', 'goal_pct_today'] as const;
export type StepsMetric = (typeof STEPS_METRICS)[number];

export type StepsPhase = 'upcoming' | 'active' | 'completed';
export type StepsGoalSource = 'challenge' | 'member' | 'default';

export interface StepsDay {
  date: string;
  /** null = nothing synced for that day (distinct from a synced 0). */
  steps: number | null;
}

export interface StepsMemberInput {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  /** The member's local date (their profile timezone). */
  local_today: string;
  /** False when the member hides their progress from other members. */
  visible: boolean;
  daily_goal_steps: number;
  goal_source: StepsGoalSource;
  /** date -> steps, every synced row we have for the member in range. */
  steps_by_date: Map<string, number>;
  last_synced_at: string | null;
  /** Any steps synced in the 7 days before the viewer's today. */
  synced_recently: boolean;
  joined_at: string | null;
}

export interface StepsMemberRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
  steps_visible: boolean;
  today_steps: number | null;
  total_steps: number | null;
  daily_goal_steps: number;
  goal_source: StepsGoalSource;
  goal_pct_today: number | null;
  days_goal_met: number | null;
  steps_synced_recently: boolean | null;
  last_synced_at: string | null;
  ranks: Record<StepsMetric, number | null>;
  days: StepsDay[];
}

export interface StepsPeriod {
  phase: StepsPhase;
  start_date: string;
  /** Last counted day (inclusive). */
  end_date: string;
  total_days: number;
  /** 1-based day of the circle on the viewer's today; null unless active. */
  day_number: number | null;
  days_until_start: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** The calendar day a stored circle date stands for ('2026-11-02 00:00:00+00' -> '2026-11-02'). */
export function calendarDay(value: string): string {
  return value.slice(0, 10);
}

/**
 * Where the viewer's today falls in the circle. `endExclusive` is fitcircles.end_date;
 * a circle whose end is not after its start still counts its first day.
 */
export function stepsPeriod(startDate: string, endExclusive: string, viewerToday: string): StepsPeriod {
  const start = calendarDay(startDate);
  let last = addDays(calendarDay(endExclusive), -1);
  if (last < start) last = start;
  const totalDays = daysBetween(start, last) + 1;

  if (viewerToday < start) {
    return { phase: 'upcoming', start_date: start, end_date: last, total_days: totalDays, day_number: null, days_until_start: daysBetween(viewerToday, start) };
  }
  if (viewerToday > last) {
    return { phase: 'completed', start_date: start, end_date: last, total_days: totalDays, day_number: null, days_until_start: 0 };
  }
  return { phase: 'active', start_date: start, end_date: last, total_days: totalDays, day_number: daysBetween(start, viewerToday) + 1, days_until_start: 0 };
}

/**
 * The daily step goal a circle challenge sets, or null.
 * Daily-cadence step templates are named steps-<N>k-daily (8,000 Steps Daily ->
 * steps-8k-daily). Their goal_amount is the template's whole-run total (21 x 8k),
 * which does not follow the circle length, so it is never divided back out.
 */
export function challengeDailyStepGoal(challenge: { template_id?: string | null; unit?: string | null } | null): number | null {
  if (!challenge || (challenge.unit ?? '').trim().toLowerCase() !== 'steps') return null;
  const match = /^steps-(\d+(?:\.\d+)?)k-daily$/i.exec(challenge.template_id ?? '');
  if (!match) return null;
  const goal = Math.round(Number(match[1]) * 1000);
  return goal > 0 ? goal : null;
}

/** Percent of goal, rounded, uncapped (12,000 of 8,000 is 150). */
export function goalPercent(steps: number, goal: number): number {
  if (!(goal > 0)) return 0;
  return Math.round((steps / goal) * 100);
}

/**
 * Competition ranking ("1224"): equal values share a rank, the next distinct
 * value skips. Members with no value (hidden, or the circle has not started)
 * get null.
 */
export function competitionRanks(values: Array<{ id: string; value: number | null }>): Map<string, number | null> {
  const ranked = values.filter((v) => v.value !== null).sort((a, b) => (b.value as number) - (a.value as number));
  const out = new Map<string, number | null>();
  let rank = 0;
  let previous: number | null = null;
  ranked.forEach((entry, index) => {
    if (entry.value !== previous) {
      rank = index + 1;
      previous = entry.value;
    }
    out.set(entry.id, rank);
  });
  values.filter((v) => v.value === null).forEach((v) => out.set(v.id, null));
  return out;
}

/** Display order for a metric: rank ascending, unranked last, then name. */
export function sortForMetric<T extends { display_name: string; ranks: Record<StepsMetric, number | null> }>(rows: T[], metric: StepsMetric): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.ranks[metric];
    const rb = b.ranks[metric];
    if (ra !== rb) {
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra - rb;
    }
    return a.display_name.localeCompare(b.display_name);
  });
}

/** Build every member's row and the three rankings. Rows come back in today_steps order. */
export function buildStepsRows(period: StepsPeriod, viewerId: string, members: StepsMemberInput[]): StepsMemberRow[] {
  const started = period.phase !== 'upcoming';

  const rows: StepsMemberRow[] = members.map((m) => {
    const isMe = m.user_id === viewerId;
    const visible = isMe || m.visible;
    // The member's own today, kept inside the circle (a member a timezone behind
    // the viewer can still be on the day before the start).
    const effectiveToday = m.local_today > period.end_date ? period.end_date : m.local_today;
    const counting = started && visible && effectiveToday >= period.start_date;

    const days: StepsDay[] = [];
    let total = 0;
    let goalDays = 0;
    if (counting) {
      for (let d = period.start_date; d <= effectiveToday; d = addDays(d, 1)) {
        const steps = m.steps_by_date.has(d) ? (m.steps_by_date.get(d) as number) : null;
        days.push({ date: d, steps });
        total += steps ?? 0;
        if (steps !== null && steps >= m.daily_goal_steps) goalDays += 1;
      }
    }
    const today = counting ? (m.steps_by_date.get(effectiveToday) ?? 0) : null;

    return {
      user_id: m.user_id,
      display_name: m.display_name,
      avatar_url: m.avatar_url,
      is_me: isMe,
      steps_visible: visible,
      today_steps: started && visible ? (today ?? 0) : null,
      total_steps: started && visible ? total : null,
      daily_goal_steps: m.daily_goal_steps,
      goal_source: m.goal_source,
      goal_pct_today: started && visible ? goalPercent(today ?? 0, m.daily_goal_steps) : null,
      days_goal_met: started && visible ? goalDays : null,
      steps_synced_recently: visible ? m.synced_recently : null,
      last_synced_at: visible ? m.last_synced_at : null,
      ranks: { today_steps: null, total_steps: null, goal_pct_today: null },
      days,
    };
  });

  const field: Record<StepsMetric, (r: StepsMemberRow) => number | null> = {
    today_steps: (r) => r.today_steps,
    total_steps: (r) => r.total_steps,
    goal_pct_today: (r) => r.goal_pct_today,
  };
  for (const metric of STEPS_METRICS) {
    const ranks = competitionRanks(rows.map((r) => ({ id: r.user_id, value: field[metric](r) })));
    rows.forEach((r) => (r.ranks[metric] = ranks.get(r.user_id) ?? null));
  }

  return sortForMetric(rows, 'today_steps');
}

/** The legacy leaderboard fields (GET /api/mobile/circles/[id]/leaderboard) that shipped apps render. */
export interface LegacyLeaderboardEntry {
  rank: number;
  user_id: string;
  progress_percentage: number;
  current_value?: number | null;
  starting_value?: number | null;
  target_value?: number | null;
  goal_type?: string | null;
  goal_unit?: string | null;
}

/** goal_unit shown by shipped apps as "<value> <unit>" with one decimal: "6.0 k steps/day". */
export const LEGACY_STEPS_UNIT = 'k steps/day';

const thousands = (n: number) => Math.round(n / 100) / 10;

/**
 * Shipped apps (≤ 1.1.1) only know the goal leaderboard: progress_percentage and the
 * line "<current> <unit> → <target> <unit> goal" (current/target printed "%.1f").
 * For a steps circle, fill those fields from the steps board so the row reads
 * "6.0 k steps/day → 8.0 k steps/day goal" with % = average daily steps vs the
 * daily goal, and re-rank by it (ties: total steps). starting_value is cleared so
 * the weight-only "x of y" line stays hidden. Members not on the board, or hidden,
 * keep 0% and no numbers; before the start every row reads "No data → goal".
 */
export function overlayLegacySteps<T extends { rank: number; user_id: string; progress_percentage: number }>(entries: T[], board: { members: StepsMemberRow[] }): T[] {
  const byId = new Map(board.members.map((m) => [m.user_id.toLowerCase(), m]));
  const scored = entries.map((entry) => {
    const m = byId.get(String(entry.user_id).toLowerCase());
    if (!m || !m.steps_visible) {
      return { entry: { ...entry, progress_percentage: 0, current_value: null, starting_value: null, target_value: null, goal_unit: null }, total: -1 };
    }
    const elapsed = m.days.length;
    const avg = m.total_steps !== null && elapsed > 0 ? m.total_steps / elapsed : null;
    return {
      entry: {
        ...entry,
        progress_percentage: avg === null ? 0 : goalPercent(avg, m.daily_goal_steps),
        current_value: avg === null ? null : thousands(avg),
        starting_value: null,
        target_value: thousands(m.daily_goal_steps),
        goal_unit: LEGACY_STEPS_UNIT,
      },
      total: m.total_steps ?? 0,
    };
  });
  scored.sort((a, b) => b.entry.progress_percentage - a.entry.progress_percentage || b.total - a.total);
  // Nullable numbers are what the legacy route serialises anyway (`x || null`).
  return scored.map((s, i) => ({ ...s.entry, rank: i + 1 })) as unknown as T[];
}
