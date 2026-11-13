/**
 * Which activity signal the PMF scorecard stands on, and how to describe it. PURE.
 * Amplitude (user_active_days, every client version) is the source of truth for "used the app
 * that day" once it has been synced; before that only Home feed loads / app opens / meals count.
 */
export interface ActivitySignalInput {
  /** Earliest synced Amplitude hour (ISO), null when nothing with events was synced. */
  amplitudeSince: string | null;
  /** End of the latest synced Amplitude hour (ISO). */
  amplitudeThrough: string | null;
  feedSince: string | null;
  opensSince: string | null;
}

export const ACTIVE_DEFINITION =
  'Active = any user action recorded in Amplitude (all app versions; background sync, push delivery and security events excluded), an app open, a Home feed load, or a logged meal.';

/** Retention only counts sign-ups after this instant. */
export function activitySinceOf(s: ActivitySignalInput): string | null {
  if (s.amplitudeSince) return s.amplitudeSince;
  return [s.feedSince, s.opensSince].filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

/** Signals whose start inside a compared window would inflate activity KPIs. */
export function signalStarts(s: ActivitySignalInput): Array<[label: string, since: string | null]> {
  if (s.amplitudeSince) return [['Amplitude activity (user_active_days)', s.amplitudeSince]];
  return [
    ['App-open recording (app_opens)', s.opensSince],
    ['Home feed logging (home_feed_decisions)', s.feedSince],
  ];
}

const STALE_MS = 6 * 3_600_000;

export function activityNotes(s: ActivitySignalInput, now: Date): string[] {
  const day = (v: string | null) => (v ? v.slice(0, 10) : 'n/a');
  if (s.amplitudeSince) {
    const out = [
      `${ACTIVE_DEFINITION} Amplitude activity is synced hourly from ${day(s.amplitudeSince)} (≈ 3 h behind); retention counts only sign-ups after that.`,
    ];
    if (s.amplitudeThrough && now.getTime() - Date.parse(s.amplitudeThrough) > STALE_MS) {
      out.push(`Amplitude activity is synced only through ${s.amplitudeThrough.slice(0, 16).replace('T', ' ')} UTC; later days count only app opens, Home feed loads and meals, so they are understated.`);
    }
    return out;
  }
  return [
    `Active = an app open (app_opens, since ${day(s.opensSince)}), a Home feed load (home_feed_decisions, 1.0.8+ apps, since ${day(s.feedSince)}, kept 90 days) or a logged meal. Retention counts only sign-ups after the first activity signal; DAU / MAU windows that reach before it are undercounted.`,
    'Retention and activity are understated: Amplitude activity is not synced (user_active_days empty or AMPLITUDE_SECRET_KEY missing), so only Home feed loads, app opens and meals count, and many sessions record neither.',
  ];
}
