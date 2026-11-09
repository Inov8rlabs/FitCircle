/**
 * Free-trial lengths that BOTH stores can express as a whole number of days (docs/TRIAL_SYNC.md §2).
 *
 * - App Store: SubscriptionOfferDuration is a fixed enum (THREE_DAYS, ONE_WEEK, TWO_WEEKS, ONE_MONTH,
 *   TWO_MONTHS, THREE_MONTHS, SIX_MONTHS, ONE_YEAR).
 * - Google Play: an ISO 8601 phase duration, free trials 3 days to 3 years.
 * - Remote config `trial_days` is an int (days) used in copy ("7-day trial") and the Stripe trial.
 *
 * Month-based values are left out on purpose: "1 month" is 28-31 days, so it can't be promised as
 * N days in copy nor matched exactly by Stripe's trial_period_days.
 */
export const SUPPORTED_TRIAL_DAYS = [3, 7, 14] as const;
export type SupportedTrialDays = (typeof SUPPORTED_TRIAL_DAYS)[number];

export type AscOfferDuration = 'THREE_DAYS' | 'ONE_WEEK' | 'TWO_WEEKS' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'ONE_YEAR';

const ASC_BY_DAYS: Record<SupportedTrialDays, AscOfferDuration> = { 3: 'THREE_DAYS', 7: 'ONE_WEEK', 14: 'TWO_WEEKS' };
const PLAY_BY_DAYS: Record<SupportedTrialDays, string> = { 3: 'P3D', 7: 'P7D', 14: 'P14D' };

export function isSupportedTrialDays(days: unknown): days is SupportedTrialDays {
  return typeof days === 'number' && (SUPPORTED_TRIAL_DAYS as readonly number[]).includes(days);
}

export const ascDurationFor = (days: SupportedTrialDays): AscOfferDuration => ASC_BY_DAYS[days];
export const playDurationFor = (days: SupportedTrialDays): string => PLAY_BY_DAYS[days];

/** App Store duration → whole days, or null for month/year based durations. */
export function ascDurationDays(duration: unknown): number | null {
  switch (duration) {
    case 'THREE_DAYS':
      return 3;
    case 'ONE_WEEK':
      return 7;
    case 'TWO_WEEKS':
      return 14;
    default:
      return null;
  }
}

/** Human label for any App Store duration ("1 month"). */
export function ascDurationLabel(duration: unknown): string {
  const days = ascDurationDays(duration);
  if (days !== null) return `${days} days`;
  const map: Record<string, string> = { ONE_MONTH: '1 month', TWO_MONTHS: '2 months', THREE_MONTHS: '3 months', SIX_MONTHS: '6 months', ONE_YEAR: '1 year' };
  return map[String(duration)] ?? String(duration ?? 'unknown');
}

/**
 * ISO 8601 duration → whole days when it is day/week based ("P3D", "P1W", "P2W", "P1W3D"), else null
 * (months / years are not a fixed number of days). Play may echo P7D back as P1W.
 */
export function isoDurationDays(duration: unknown): number | null {
  if (typeof duration !== 'string') return null;
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?$/.exec(duration.trim().toUpperCase());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 7 + Number(m[2] ?? 0);
}
