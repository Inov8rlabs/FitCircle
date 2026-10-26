/**
 * Meal-slot reminder policy (docs/ACTIVATION_JOURNEY_SPEC.md §4) — PURE.
 * MealReminderService does the reads and the send; the orchestrator applies
 * the momentum toggle, quiet hours, the daily cap and the dedupe guard.
 *
 * Skip when: the slot isn't due (local [sendAt, sendAt + 60 min)), the slot
 * toggle is off, a reminder for this slot+day was already attempted, the slot
 * is already logged (meal_type OR entry time in the window), or the user is
 * dormant (no meal in 7 days AND ≥ 3 meal reminders since their last meal —
 * resumes on their next log).
 */
import type { NotificationType } from '../services/notification-orchestrator';

import { dueSlot, localClock, loggedSlots, type MealEntryLite, type MealReminderPrefs, type MealSlot } from './meal-slots';

export const MEAL_REMINDER_TYPE: Record<MealSlot, NotificationType> = {
  breakfast: 'meal_reminder_breakfast',
  lunch: 'meal_reminder_lunch',
  snack: 'meal_reminder_snack',
  dinner: 'meal_reminder_dinner',
};

/** Minutes after the slot's send time during which the (15-minutely) cron may still send it. */
export const SEND_GRACE_MINUTES = 60;
/** "Dead user" backoff (§4). */
export const DORMANT_NO_MEAL_DAYS = 7;
export const DORMANT_IGNORED_REMINDERS = 3;

/** `meal:<slot>:<localDate>` — the dedupe key (docs/PUSH_NOTIFICATIONS.md §3). */
export const mealDedupeKey = (slot: MealSlot, localDate: string) => `meal:${slot}:${localDate}`;

export type MealReminderSkip = 'not_due' | 'slot_off' | 'already_sent' | 'slot_logged' | 'dormant_backoff';

export interface MealReminderInput {
  now: Date;
  timezone: string;
  prefs: MealReminderPrefs;
  /** Food entries around today (entry_date today ± 1 is enough). */
  entries: readonly MealEntryLite[];
  /** Most recent food entry time (logged_at or created_at), or null when none ever. */
  lastMealAt: string | null;
  /** Delivered meal reminders since the last meal (or since sign-up if none). */
  remindersSinceLastMeal: number;
  /** dedupe keys already used (any outcome) in the last ~20 h. */
  attemptedKeys: ReadonlySet<string>;
}

export type MealReminderDecision =
  | { send: true; slot: MealSlot; type: NotificationType; localDate: string; dedupeKey: string }
  | { send: false; slot: MealSlot | null; skip: MealReminderSkip; localDate: string };

/** Which slot (if any) is due for this timezone right now — the cheap first filter. */
export function dueSlotFor(now: Date, timezone: string): { slot: MealSlot | null; localDate: string } {
  const clock = localClock(now, timezone);
  return { slot: dueSlot(clock.minutes, SEND_GRACE_MINUTES), localDate: clock.date };
}

export function isDormant(lastMealAt: string | null, remindersSinceLastMeal: number, now: Date): boolean {
  const last = lastMealAt ? Date.parse(lastMealAt) : NaN;
  const recent = !Number.isNaN(last) && now.getTime() - last < DORMANT_NO_MEAL_DAYS * 86_400_000;
  return !recent && remindersSinceLastMeal >= DORMANT_IGNORED_REMINDERS;
}

export function decideMealReminder(i: MealReminderInput): MealReminderDecision {
  const { slot, localDate } = dueSlotFor(i.now, i.timezone);
  if (!slot) return { send: false, slot: null, skip: 'not_due', localDate };
  if (!i.prefs[slot]) return { send: false, slot, skip: 'slot_off', localDate };
  const dedupeKey = mealDedupeKey(slot, localDate);
  if (i.attemptedKeys.has(dedupeKey)) return { send: false, slot, skip: 'already_sent', localDate };
  if (loggedSlots(i.entries, localDate, i.timezone).has(slot)) return { send: false, slot, skip: 'slot_logged', localDate };
  if (isDormant(i.lastMealAt, i.remindersSinceLastMeal, i.now)) return { send: false, slot, skip: 'dormant_backoff', localDate };
  return { send: true, slot, type: MEAL_REMINDER_TYPE[slot], localDate, dedupeKey };
}
