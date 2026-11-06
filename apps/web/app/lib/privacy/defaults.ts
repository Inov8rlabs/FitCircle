/**
 * Privacy-by-default switches (Quebec Law 25 s.9.1, UK GDPR Art. 25;
 * docs/PRIVACY_COMPLIANCE_SPEC.md §8). THE one place these defaults live.
 *
 * They apply only to users who never chose a value (the key is absent from
 * profiles.preferences). Changing a value here changes what those users get on
 * the next deploy; anyone who set the option keeps their choice.
 *
 * Current values are UNCHANGED from before this module existed (owner decision
 * pending, 2026-11-06):
 *   - new meals shared with circles: OFF (private by default since ee9722c, 2026-11-04)
 *   - profile visibility: 'public'; show weight: on; show progress: on
 *
 * Pure constants with no server-only imports: also bundled into web client code.
 */
export type ProfileVisibility = 'public' | 'friends' | 'private';

export const PRIVACY_DEFAULTS = Object.freeze({
  /** preferences.privacy.share_meals_with_circles when unset. */
  shareMealsWithCircles: false as boolean,
  /** preferences(.privacy).profile_visibility when unset. Law 25 option: 'friends' or 'private'. */
  profileVisibility: 'public' as ProfileVisibility,
  /** preferences(.privacy).show_weight when unset. */
  showWeight: true as boolean,
  /** preferences(.privacy).show_progress when unset. */
  showProgress: true as boolean,
});
