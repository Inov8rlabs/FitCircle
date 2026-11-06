/**
 * JourneyContext builder — pure: the profile (already loaded by auth) + the
 * raw rows the promo loaders fetched → the facts the system promos match on.
 */
import { trialEligibleFromProfile } from '../entitlements/trial-eligibility';
import { localClock, loggedSlots, mealReminderPrefsFrom, type MealEntryLite } from '../journey/meal-slots';

import type { JourneyContext } from './types';

export interface JourneyFacts {
  /** Most recent food entry (any day), or null when the user has none. */
  lastMeal: { title: string | null; meal_type: string | null; logged_at: string | null } | null;
  /** Food entries around today (entry_date localDate ± 1). */
  recentEntries: MealEntryLite[];
}

/** profiles.fitzy_opened_at: undefined when the column is absent (migration 110 not applied) → unknown. */
export function fitzyOpenedFrom(profile: Record<string, any>): string | null | undefined {
  if (!('fitzy_opened_at' in profile)) return undefined;
  return typeof profile.fitzy_opened_at === 'string' ? profile.fitzy_opened_at : null;
}

/**
 * TRIAL_FIRST_SPEC §3: can Fitzy genuinely produce personalized recommendations? Onboarding is
 * complete and the user picked at least one goal (profiles.goals, a jsonb array of strings).
 * Missing columns → null (unknown → the teaser does not match).
 */
export function fitzyRecommendationsReadyFrom(profile: Record<string, any>): boolean | null {
  if (!('onboarding_completed' in profile) || !('goals' in profile)) return null;
  const goals = Array.isArray(profile.goals) ? profile.goals.filter((g: unknown) => typeof g === 'string' && g.trim().length > 0) : [];
  return profile.onboarding_completed === true && goals.length > 0;
}

export function buildJourneyContext(
  profile: Record<string, any>,
  facts: JourneyFacts | null,
  at: { now: Date; timezone: string; localDate: string }
): JourneyContext {
  let localMinutes = 0;
  try {
    localMinutes = localClock(at.now, at.timezone).minutes;
  } catch {
    localMinutes = at.now.getUTCHours() * 60 + at.now.getUTCMinutes();
  }
  return {
    hasLoggedMeal: facts ? facts.lastMeal !== null : null,
    loggedSlotsToday: facts ? [...loggedSlots(facts.recentEntries, at.localDate, at.timezone)] : null,
    lastMeal: facts?.lastMeal ? { title: facts.lastMeal.title, mealType: facts.lastMeal.meal_type } : null,
    signupAt: typeof profile.created_at === 'string' ? profile.created_at : profile.created_at instanceof Date ? profile.created_at.toISOString() : null,
    fitzyOpenedAt: fitzyOpenedFrom(profile),
    mealReminderPrefs: mealReminderPrefsFrom(profile.preferences),
    localMinutes,
    fitzyRecommendationsReady: fitzyRecommendationsReadyFrom(profile),
    trialEligible: trialEligibleFromProfile(profile),
  };
}
