/** Local-day helpers for Fitzy (daily focus, weekly plans). */
import { addDays, localToday } from '../streaks/streak-calculator';

/** Monday (YYYY-MM-DD) of the week containing `day`. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function isSunday(day: string): boolean {
  return new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
}

export function todayFor(timezone?: string | null): string {
  return localToday(timezone);
}
