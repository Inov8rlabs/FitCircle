/** Monday-first week of step counts from daily_tracking rows (iOS calculateWeeklyProgress). */
export interface WeekDay {
  date: string; // YYYY-MM-DD
  label: string; // M T W …
  steps: number;
  isToday: boolean;
  isFuture: boolean;
}

function iso(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** `offset` 0 = this week, -1 = last week, … */
export function weekDays(rows: { tracking_date: string; steps?: number | null }[], offset = 0, now = new Date()): WeekDay[] {
  const byDate = new Map(rows.map((r) => [r.tracking_date, r.steps ?? 0]));
  const today = iso(now);
  const monday = new Date(now);
  const dow = (monday.getDay() + 6) % 7; // 0 = Monday
  monday.setDate(monday.getDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const date = iso(d);
    return {
      date,
      label: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
      steps: byDate.get(date) ?? 0,
      isToday: date === today,
      isFuture: date > today,
    };
  });
}

/** 9.1k / 820 */
export function compactSteps(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
