/**
 * Meal-slot reminder policy (docs/ACTIVATION_JOURNEY_SPEC.md §4) — PURE.
 * MealReminderService does the reads and the send; the orchestrator applies
 * the momentum toggle, quiet hours, the daily cap and the dedupe guard.
 *
 * Skip when: the slot isn't due (local [sendAt, sendAt + 60 min)), the slot
 * toggle is off, a reminder for this slot+day was already attempted, the slot
 * is already logged (meal_type OR entry time in the window), or the user is
 * dormant (no meal in 7 days AND ≥ 3 meal reminders since their last meal —
 * resumes on their next log). A user younger than NEW_USER_GRACE_HOURS is never
 * dormant: a new sign-up who hasn't logged yet is exactly who the reminders are
 * for (retention fix 3, 2026-11-09 — the backoff used to stop them after ~1 day).
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
/** Accounts younger than this are never treated as dormant. */
export const NEW_USER_GRACE_HOURS = 72;

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
  /** profiles.created_at (ISO); null/absent = unknown (treated as not new). */
  signupAt?: string | null;
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

/** Account younger than NEW_USER_GRACE_HOURS (never dormant). */
export function isNewUser(signupAt: string | null | undefined, now: Date): boolean {
  const t = signupAt ? Date.parse(signupAt) : NaN;
  return Number.isFinite(t) && now.getTime() - t < NEW_USER_GRACE_HOURS * 3_600_000;
}

export function isDormant(lastMealAt: string | null, remindersSinceLastMeal: number, now: Date, signupAt?: string | null): boolean {
  if (isNewUser(signupAt, now)) return false;
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
  if (isDormant(i.lastMealAt, i.remindersSinceLastMeal, i.now, i.signupAt)) return { send: false, slot, skip: 'dormant_backoff', localDate };
  return { send: true, slot, type: MEAL_REMINDER_TYPE[slot], localDate, dedupeKey };
}

// ---------------------------------------------------------------------------- copy

/**
 * Meal reminder copy: specific and action-led (open camera, one photo, FitCircle
 * counts). A few variants per slot, rotated deterministically by the user's
 * local date so consecutive days differ and a cron re-run picks the same one.
 * No emoji, no fabricated data: the only number ever shown is the user's own
 * streak, and only when it is still open today (dinner).
 */
export interface MealReminderCopy {
  title: string;
  body: string;
}

export const MEAL_REMINDER_COPY: Record<MealSlot, readonly MealReminderCopy[]> = {
  breakfast: [
    { title: 'Breakfast time — snap it in 5 seconds', body: 'Take a photo and FitCircle does the counting.' },
    { title: 'Log breakfast with one photo', body: 'Point your camera at your plate. FitCircle fills in calories and macros.' },
    { title: "What's on your plate this morning?", body: 'Snap breakfast now so you never have to remember it later.' },
  ],
  lunch: [
    { title: 'Lunch time — snap it in 5 seconds', body: 'Take a photo and FitCircle does the counting.' },
    { title: 'Log lunch before the first bite', body: 'One photo is all it takes. FitCircle works out calories and macros.' },
    { title: "What's for lunch?", body: 'Snap a photo and get calories and macros back in seconds.' },
  ],
  snack: [
    { title: 'Snack time — one photo logs it', body: 'Small bites count too. Snap it and FitCircle does the rest.' },
    { title: 'Grabbing a snack?', body: 'Take a quick photo and FitCircle does the counting.' },
  ],
  dinner: [
    { title: 'Dinner time — snap it in 5 seconds', body: 'Take a photo and FitCircle does the counting.' },
    { title: 'Log dinner with one photo', body: 'Point your camera at your plate. FitCircle fills in calories and macros.' },
    { title: "What's for dinner?", body: 'Snap it before you dig in. FitCircle does the counting.' },
  ],
};

/** Days since the epoch for a YYYY-MM-DD local date; 0 when missing/invalid. */
function dayIndex(localDate: string | null | undefined): number {
  const t = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? Date.parse(`${localDate}T00:00:00Z`) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : 0;
}

/** The copy for a slot on a local date. `streakDays` > 0 only when today's streak is genuinely still open. */
export function mealReminderCopy(slot: MealSlot, localDate?: string | null, streakDays?: number | null): MealReminderCopy {
  const variants = MEAL_REMINDER_COPY[slot];
  const pick = variants[((dayIndex(localDate) % variants.length) + variants.length) % variants.length];
  if (slot === 'dinner' && typeof streakDays === 'number' && Number.isInteger(streakDays) && streakDays > 0) {
    return { title: pick.title, body: `Snap dinner to keep your ${streakDays}-day streak going.` };
  }
  return pick;
}
