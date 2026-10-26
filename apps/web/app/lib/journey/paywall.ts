/**
 * Paywall moments (ACTIVATION_JOURNEY_SPEC §5) — pure.
 *
 *  - An AUTOMATICALLY presented paywall: at most once per 72 h, never in the
 *    user's first 10 minutes, never before the first meal (value first).
 *  - The post-first-meal soft paywall (`first_meal_aha`): once ever, after the
 *    Meet-Fitzy moment. Exempt from the 10-minute rule (that IS the moment);
 *    it does not require the meal to have reached the server yet (offline-first
 *    logging), and still respects the 72 h spacing.
 *  - User-initiated taps always open the paywall (clients don't ask).
 */
export const PAYWALL_AUTO_SPACING_HOURS = 72;
export const PAYWALL_NEW_USER_GRACE_MINUTES = 10;

export interface PaywallInput {
  isPro: boolean;
  subscriptionsEnabled: boolean;
  mealsLoggedEver: number;
  signupAt: string | null;
  autoLastAt: string | null;
  ahaShownAt: string | null;
  now: Date;
}

export interface PaywallEligibility {
  /** May the app present the paywall on its own right now (feed/app moments other than the aha)? */
  autoEligible: boolean;
  /** May the app show the once-only post-first-meal soft paywall? */
  postAhaEligible: boolean;
  /** When the 72 h spacing ends (null = not spacing-blocked). */
  nextAutoEligibleAt: string | null;
}

export function paywallEligibility(i: PaywallInput): PaywallEligibility {
  const base = !i.isPro && i.subscriptionsEnabled;
  const last = i.autoLastAt ? Date.parse(i.autoLastAt) : NaN;
  const spacingEnds = Number.isNaN(last) ? null : last + PAYWALL_AUTO_SPACING_HOURS * 3_600_000;
  const spaced = spacingEnds === null || i.now.getTime() >= spacingEnds;
  const signup = i.signupAt ? Date.parse(i.signupAt) : NaN;
  const pastGrace = !Number.isNaN(signup) && i.now.getTime() - signup >= PAYWALL_NEW_USER_GRACE_MINUTES * 60_000;
  return {
    autoEligible: base && spaced && pastGrace && i.mealsLoggedEver >= 1,
    postAhaEligible: base && spaced && !i.ahaShownAt,
    nextAutoEligibleAt: spaced || spacingEnds === null ? null : new Date(spacingEnds).toISOString(),
  };
}
