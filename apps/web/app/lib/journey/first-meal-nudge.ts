/**
 * "Snap your first meal" push, same day (docs/ENGAGEMENT_115_SPEC.md §14.7) — PURE.
 * MealReminderService does the reads and the send (it runs in the 15-minute meal-reminder cron);
 * NotificationOrchestrator applies the push master switch, the momentum (meal-reminder)
 * category toggle, the daily cap, quiet hours (skip, never deferred), dedupe and logging.
 *
 * Who: a real user (not a test account) who finished onboarding without a meal — no confirmed
 * meal and no draft — has an active push token, and never had this push (attempted) before.
 * Once per user, ever.
 * When: the first lunch (12:30) or dinner (18:30) slot, user-local, whose toggle is on, that
 * starts ≥ 60 min after onboarding finished and ≤ 24 h after it. The cron may send it during
 * [slot, slot + 60 min). If no slot fits, no push.
 * `next_meal_nudge` (onboarding progress data, the §14.8 "I'll do it at my next meal" skip) is
 * carried in the push data; the rules are the same.
 */
import type { NotificationType } from '../services/notification-orchestrator';
import { addDays } from '../streaks/streak-calculator';

import { SLOT_DEFS, localClock, type MealReminderPrefs } from './meal-slots';
import { localWallTimeToUtc } from '../trials/reminder';

export const FIRST_MEAL_NUDGE_TYPE: NotificationType = 'first_meal_nudge';
export const FIRST_MEAL_NUDGE_SLOTS = ['lunch', 'dinner'] as const;
export type FirstMealNudgeSlot = (typeof FIRST_MEAL_NUDGE_SLOTS)[number];
export const FIRST_MEAL_NUDGE_MIN_GAP_MS = 60 * 60_000;
export const FIRST_MEAL_NUDGE_MAX_DELAY_MS = 24 * 3_600_000;
/** The cron may still send a due slot this long after its time (15-min cron, one missed run tolerated). */
export const FIRST_MEAL_NUDGE_GRACE_MS = 60 * 60_000;

export const firstMealNudgeDedupeKey = (userId: string) => `first_meal_nudge:${userId}`;

export function firstMealNudgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.FIRST_MEAL_NUDGE_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export type FirstMealNudgeSkip =
  | 'disabled'
  | 'test_account'
  | 'onboarding_not_completed'
  | 'has_meal'
  | 'already_attempted'
  | 'no_slot'
  | 'not_yet'
  | 'missed';

export interface FirstMealNudgeInput {
  now: Date;
  timezone: string;
  /** profiles.onboarding_completed_at (null = not finished). */
  onboardingCompletedAt: string | null;
  /** Any food entry ever, confirmed OR draft (deleted ones excluded). */
  hasAnyMeal: boolean;
  /** A first_meal_nudge was attempted before (any outcome: once per user, ever; quiet hours = skip). */
  attemptedBefore: boolean;
  isTestAccount: boolean;
  prefs: MealReminderPrefs;
  enabled?: boolean;
}

export type FirstMealNudgeDecision =
  | { send: true; slot: FirstMealNudgeSlot; localDate: string; slotAt: Date }
  | { send: false; skip: FirstMealNudgeSkip; slot?: FirstMealNudgeSlot; slotAt?: Date };

/** The first lunch / dinner slot (toggle on) in [completed + 60 min, completed + 24 h], or null. */
export function firstMealNudgeSlot(
  completedAt: Date,
  timezone: string,
  prefs: MealReminderPrefs
): { slot: FirstMealNudgeSlot; localDate: string; at: Date } | null {
  const startDay = localClock(completedAt, timezone).date;
  const earliest = completedAt.getTime() + FIRST_MEAL_NUDGE_MIN_GAP_MS;
  const latest = completedAt.getTime() + FIRST_MEAL_NUDGE_MAX_DELAY_MS;
  for (let d = 0; d <= 1; d++) {
    const day = addDays(startDay, d);
    for (const slot of FIRST_MEAL_NUDGE_SLOTS) {
      if (!prefs[slot]) continue;
      const minutes = SLOT_DEFS[slot].sendAt;
      const at = localWallTimeToUtc(day, Math.floor(minutes / 60), timezone);
      const atWithMinutes = new Date(at.getTime() + (minutes % 60) * 60_000);
      const t = atWithMinutes.getTime();
      if (t >= earliest && t <= latest) return { slot, localDate: day, at: atWithMinutes };
    }
  }
  return null;
}

export function decideFirstMealNudge(i: FirstMealNudgeInput): FirstMealNudgeDecision {
  if (i.enabled === false) return { send: false, skip: 'disabled' };
  if (i.isTestAccount) return { send: false, skip: 'test_account' };
  const completed = i.onboardingCompletedAt ? new Date(i.onboardingCompletedAt) : null;
  if (!completed || Number.isNaN(completed.getTime())) return { send: false, skip: 'onboarding_not_completed' };
  if (i.hasAnyMeal) return { send: false, skip: 'has_meal' };
  if (i.attemptedBefore) return { send: false, skip: 'already_attempted' };
  const target = firstMealNudgeSlot(completed, i.timezone, i.prefs);
  if (!target) return { send: false, skip: 'no_slot' };
  const now = i.now.getTime();
  if (now < target.at.getTime()) return { send: false, skip: 'not_yet', slot: target.slot, slotAt: target.at };
  if (now >= target.at.getTime() + FIRST_MEAL_NUDGE_GRACE_MS) return { send: false, skip: 'missed', slot: target.slot, slotAt: target.at };
  return { send: true, slot: target.slot, localDate: target.localDate, slotAt: target.at };
}

/** Copy (§14.7): no numbers, no social proof. */
export function firstMealNudgeCopy(slot: unknown): { title: string; body: string } {
  const meal = slot === 'dinner' ? 'dinner' : 'lunch';
  return { title: `Snap your ${meal}`, body: 'Take a photo and FitCircle works out the calories in seconds.' };
}

/** `onboarding_progress.data.next_meal_nudge` (§14.8 skip "I'll do it at my next meal"). */
export function nextMealNudgeFrom(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { next_meal_nudge?: unknown }).next_meal_nudge === true;
}
