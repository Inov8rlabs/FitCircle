/**
 * Synthetic users for the Admin Tools previews (Pro lifecycle editor and the
 * home feed editor's "Pro ending" / "Pro ended" personas). Pure; never a real
 * profile. The sample usage numbers are ADMIN-PREVIEW ONLY (labelled as
 * sample in the editor) — real users only ever see their own counts.
 */
import { addDays, localDayOf } from '../streaks/streak-calculator';
import { localWallTimeToUtc } from '../trials/reminder';

import type { LifecycleFeedInput } from './card';
import { computeLifecycleState } from './state';
import type { LifecycleFacts, ProLifecycleConfig, ProLifecycleState, ProUsage } from './types';

export const SAMPLE_USAGE: ProUsage = { aiMeals: 5, meals: 8, fitzyChats: 3, plans: 1 };
export const PERSONA_FIRST_NAME = 'Alex';

export interface PersonaSample {
  trialAvailable: boolean;
  usage: 'sample' | 'none';
}

export const DEFAULT_SAMPLE: PersonaSample = { trialAvailable: true, usage: 'sample' };

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A believable end: tomorrow 1 PM local (expiring) / yesterday 1 PM (ended), kept inside the configured window. */
export function personaEnd(state: ProLifecycleState, now: Date, timezone: string, config: ProLifecycleConfig): Date {
  const today = localDayOf(now, timezone);
  if (state === 'pro_expired') {
    const y = localWallTimeToUtc(addDays(today, -1), 13, timezone);
    return now.getTime() - y.getTime() <= config.states.pro_expired.daysAfter * DAY ? y : new Date(now.getTime() - 12 * HOUR);
  }
  const t = localWallTimeToUtc(addDays(today, 1), 13, timezone);
  const window = config.states[state].hoursBefore * HOUR;
  return t.getTime() - now.getTime() <= window ? t : new Date(now.getTime() + window / 2);
}

/** The persona's profile fields + lifecycle input for `state`. */
export function personaLifecycle(
  state: ProLifecycleState,
  now: Date,
  timezone: string,
  config: ProLifecycleConfig,
  sample: PersonaSample = DEFAULT_SAMPLE
): { profile: Record<string, unknown>; input: LifecycleFeedInput } {
  const end = personaEnd(state, now, timezone, config);
  const start = new Date(end.getTime() - 7 * DAY);
  const iso = (d: Date) => d.toISOString();
  let profile: Record<string, unknown>;
  let facts: LifecycleFacts;
  if (state === 'trial_expiring') {
    profile = {
      subscription_tier: 'premium',
      subscription_status: 'trialing',
      subscription_platform: 'app_store',
      subscription_will_renew: false,
      subscription_expires_at: iso(end),
      trial_started_at: iso(new Date(end.getTime() - 3 * DAY)),
      trial_ends_at: iso(end),
    };
    facts = { profile: { id: 'persona', ...profile }, grants: [], hasPurchased: false, hadTrial: true };
  } else {
    const expiring = state === 'pro_expiring';
    profile = {
      subscription_tier: expiring ? 'premium' : 'free',
      subscription_status: expiring ? 'active' : 'cancelled',
      subscription_platform: expiring ? 'promotional' : null,
      subscription_product_id: expiring ? 'referral' : null,
      subscription_expires_at: expiring ? iso(end) : null,
      subscription_will_renew: false,
      trial_started_at: sample.trialAvailable ? null : iso(new Date(start.getTime() - 30 * DAY)),
    };
    facts = {
      profile: { id: 'persona', ...profile },
      grants: [{ granted_by: 'referral-program', created_at: iso(start), expires_at: iso(end), revoked_at: null }],
      hasPurchased: false,
      hadTrial: !sample.trialAvailable,
    };
  }
  const result = computeLifecycleState(facts, now, config, {});
  return {
    profile,
    input: { result, usage: sample.usage === 'sample' ? SAMPLE_USAGE : { aiMeals: 0, meals: 0, fitzyChats: 0, plans: 0 }, firstName: PERSONA_FIRST_NAME, timezone },
  };
}
