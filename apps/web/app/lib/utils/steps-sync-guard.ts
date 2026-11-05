/**
 * Platform step sync guard. iOS builds before 1.1.1 (HealthKitManager
 * fetchStepsForDateRange) enumerated HealthKit statistics one day past today and
 * sent that day as a 0-step entry dated TOMORROW. Prod had such rows for every
 * active iOS user; member profiles then listed them as "0.0 lbs" check-ins.
 */

/** A 0-step entry dated after the member's local today (YYYY-MM-DD compare). */
export function isFutureZeroSteps(entry: { date: string; steps: number }, localToday: string | null): boolean {
  return localToday != null && entry.steps === 0 && entry.date > localToday;
}
