/**
 * Display rules for a circle member's progress (web participant sheet). Mirrors
 * the iOS / Android presentation: docs/MEMBER_PROGRESS_CONTRACT.md.
 *
 * - Only `metric === 'weight'` values are converted, with the VIEWER's units.
 * - Steps / minutes / custom amounts are shown in their own unit.
 * - Dates are date-only member-local days: "Today", "Yesterday", "Nov 4".
 */
import { kgToLbs, type UnitSystem } from '@/lib/utils/units';

export type MemberMetric = 'steps' | 'weight' | 'workout_minutes' | 'custom' | 'none';
export type HiddenReason = 'weight_private' | 'progress_private' | 'profile_private' | 'not_in_circle';

export interface MemberProgressEntry {
  id: string;
  date: string;
  value: number;
  change: number | null;
  is_public: boolean;
  note: string | null;
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

export interface MemberCircleProgress {
  metric: MemberMetric;
  unit: string | null;
  label: string | null;
  can_view: boolean;
  hidden_reason: HiddenReason | null;
  today: string;
  summary: MemberProgressSummary;
  entries: MemberProgressEntry[];
}

const grouped = (n: number, maxFractionDigits = 0) =>
  n.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });

/** Weight (kg on the wire) in the viewer's units, one decimal. */
export function weightValue(kg: number, unitSystem: UnitSystem): string {
  const v = unitSystem === 'imperial' ? kgToLbs(kg) : Math.round(kg * 10) / 10;
  return v.toFixed(1);
}

export function weightUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? 'lbs' : 'kg';
}

/** "12,345 steps", "45 min", "120 reps", "89.0 kg" / "196.2 lbs". */
export function formatMetricValue(
  value: number,
  metric: MemberMetric,
  unit: string | null,
  unitSystem: UnitSystem
): string {
  switch (metric) {
    case 'weight':
      return `${weightValue(value, unitSystem)} ${weightUnitLabel(unitSystem)}`;
    case 'steps':
      return `${grouped(Math.round(value))} steps`;
    case 'workout_minutes':
      return `${grouped(Math.round(value))} min`;
    default:
      return unit ? `${grouped(value, 2)} ${unit}` : grouped(value, 2);
  }
}

/**
 * A weight change between two weigh-ins (newer − older, kg). Negative is a
 * loss: "Lost 1.1 lbs" with the positive tone; positive "Gained 0.9 lbs".
 */
export function formatWeightChange(
  changeKg: number,
  unitSystem: UnitSystem
): { text: string; direction: 'lost' | 'gained' | 'same' } {
  const magnitude = weightValue(Math.abs(changeKg), unitSystem);
  if (Number(magnitude) === 0) return { text: 'No change', direction: 'same' };
  const unit = weightUnitLabel(unitSystem);
  return changeKg < 0
    ? { text: `Lost ${magnitude} ${unit}`, direction: 'lost' }
    : { text: `Gained ${magnitude} ${unit}`, direction: 'gained' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

const dayNumber = (p: { y: number; m: number; d: number }) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;

/**
 * A date-only day relative to `today` (both YYYY-MM-DD, member-local):
 * "Today", "Yesterday", "Nov 4", or "Nov 4, 2025" in another year. Never a time.
 */
export function formatEntryDay(day: string, today: string): string {
  const p = parseDay(day);
  const t = parseDay(today);
  if (!p) return day;
  if (t) {
    const diff = dayNumber(t) - dayNumber(p);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
  }
  const base = `${MONTHS[p.m - 1]} ${p.d}`;
  return t && t.y === p.y ? base : `${base}, ${p.y}`;
}

/** Card title per metric. */
export function metricTitle(progress: Pick<MemberCircleProgress, 'metric' | 'label'>): string {
  switch (progress.metric) {
    case 'weight':
      return 'Weight progress';
    case 'steps':
      return 'Steps';
    case 'workout_minutes':
      return 'Workout minutes';
    case 'custom':
      return progress.label || 'Progress';
    default:
      return 'Progress';
  }
}

export function hiddenMessage(reason: HiddenReason | null): string {
  switch (reason) {
    case 'weight_private':
      return 'Weight is private';
    case 'profile_private':
      return 'This profile is private';
    case 'not_in_circle':
      return 'Only circle members can see this progress';
    default:
      return 'Progress is private';
  }
}
