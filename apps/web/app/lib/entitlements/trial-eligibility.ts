/**
 * Trial-first monetization (docs/TRIAL_FIRST_SPEC.md) — the server's best guess
 * at whether a user can still start the Pro free trial (length: lib/config/trial.ts).
 *
 * The stores (Apple / Google) make the real decision for their own trials and
 * Stripe checkout re-checks with BillingService.isWebTrialEligible, so this is
 * only used to pick paywall COPY ("Try Pro free for N days" vs "Unlock Fitzy Pro").
 * It must be cheap: it reads only profile columns the caller usually already has.
 *
 * Eligible = never trialed (profiles.trial_started_at null) AND no prior paid
 * subscription on any store (profiles.subscription_platform is not a store).
 * A complimentary / referral grant ('promotional') is not a store subscription,
 * so a lapsed grant keeps the user eligible.
 * Unknown (columns missing, read failed) → not eligible: never promise a free
 * trial we can't vouch for.
 */

const STORE_PLATFORMS = new Set(['app_store', 'play_store', 'stripe']);

export interface TrialEligibilityProfile {
  trial_started_at?: string | null;
  subscription_platform?: string | null;
}

/** Pure. `undefined` columns (not selected / pre-migration-112) → unknown → false. */
export function trialEligibleFromProfile(profile: TrialEligibilityProfile | null | undefined): boolean {
  if (!profile || !('trial_started_at' in profile)) return false;
  if (profile.trial_started_at) return false;
  if (profile.subscription_platform && STORE_PLATFORMS.has(profile.subscription_platform)) return false;
  return true;
}
