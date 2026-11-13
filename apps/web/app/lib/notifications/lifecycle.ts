/**
 * Lifecycle stage per user (docs/PUSH_NOTIFICATIONS.md §8). PURE.
 *
 * The stage is a function of ONE input: lastSeenAt, the user's most recent
 * foreground use of the app (see UserAudienceService.lastSeenAt for how it is
 * computed — the lookup is a single function so it can later be swapped for
 * Amplitude-backed active days). Days are counted in the user's LOCAL calendar
 * (the zone pushes are timed in), so "3 days ago" means three local midnights
 * have passed since the last open, not 72 hours.
 *
 *   days since last seen   stage
 *   0–2                    active
 *   3–6                    lapsed_3
 *   7–13                   lapsed_7
 *   14–29                  lapsed_14
 *   30                     lapsed_30
 *   > 30                   dormant
 *
 * Any foreground use moves lastSeenAt, which resets the user to active and
 * starts a new lapse episode the next time they go quiet.
 */
import { localClockIn } from './user-timezone';

export type LifecycleStage = 'active' | 'lapsed_3' | 'lapsed_7' | 'lapsed_14' | 'lapsed_30' | 'dormant';

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = ['active', 'lapsed_3', 'lapsed_7', 'lapsed_14', 'lapsed_30', 'dormant'];

/** Last local day that still counts as active (0 = today, 1 = yesterday, 2 = two days ago). */
export const ACTIVE_MAX_DAYS = 2;
/** Beyond this many local days the user is dormant (only transactional pushes). */
export const DORMANT_AFTER_DAYS = 30;

export interface Lifecycle {
  stage: LifecycleStage;
  /** Whole local calendar days between the last foreground use and now (0 = seen today). */
  daysSinceSeen: number;
  /** Local date (YYYY-MM-DD) of the last foreground use: identifies the lapse episode. */
  lastSeenLocalDate: string;
}

/** Stage for a number of local days since the last foreground use. */
export function stageForDays(days: number): LifecycleStage {
  if (days <= ACTIVE_MAX_DAYS) return 'active';
  if (days < 7) return 'lapsed_3';
  if (days < 14) return 'lapsed_7';
  if (days < 30) return 'lapsed_14';
  if (days === DORMANT_AFTER_DAYS) return 'lapsed_30';
  return 'dormant';
}

/** Days between two YYYY-MM-DD dates (b − a). */
export function daysBetweenDates(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The latest valid timestamp among the signals, or null. */
export function latestOf(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const t = Date.parse(v);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Lifecycle for a user, or null when nothing is known (no signal at all) —
 * callers treat null as "unknown" and fail open (no lifecycle gating).
 * A lastSeenAt in the future (clock skew) counts as today.
 */
export function computeLifecycle(lastSeenAt: string | null | undefined, now: Date, timezone: string): Lifecycle | null {
  if (!lastSeenAt || !Number.isFinite(Date.parse(lastSeenAt))) return null;
  const seen = localClockIn(new Date(lastSeenAt), timezone).date;
  const today = localClockIn(now, timezone).date;
  const days = Math.max(0, daysBetweenDates(seen, today));
  return { stage: stageForDays(days), daysSinceSeen: days, lastSeenLocalDate: seen };
}

export function isLapsed(stage: LifecycleStage | null | undefined): boolean {
  return stage === 'lapsed_3' || stage === 'lapsed_7' || stage === 'lapsed_14' || stage === 'lapsed_30';
}
