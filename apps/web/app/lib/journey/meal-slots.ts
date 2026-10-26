/**
 * Meal slots (docs/ACTIVATION_JOURNEY_SPEC.md §4) — PURE, shared by the meal
 * reminder pushes, the `log_meal_now` promo and the journey endpoint.
 *
 * | slot      | push at | counts as logged (entry time, local)  | default |
 * |-----------|---------|----------------------------------------|---------|
 * | breakfast | 08:30   | 04:00–10:59, or meal_type=breakfast    | on      |
 * | lunch     | 12:30   | 11:00–14:59, or meal_type=lunch        | on      |
 * | snack     | 15:30   | 15:00–16:59, or meal_type=snack        | off     |
 * | dinner    | 18:30   | 17:00–21:59, or meal_type=dinner       | on      |
 */

export const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export interface SlotDef {
  slot: MealSlot;
  /** Local send time, minutes after midnight. */
  sendAt: number;
  /** Window [start, end) in local minutes: an entry logged in it counts for the slot. */
  windowStart: number;
  windowEnd: number;
  defaultOn: boolean;
}

const hm = (h: number, m = 0) => h * 60 + m;

export const SLOT_DEFS: Readonly<Record<MealSlot, SlotDef>> = Object.freeze({
  breakfast: { slot: 'breakfast', sendAt: hm(8, 30), windowStart: hm(4), windowEnd: hm(11), defaultOn: true },
  lunch: { slot: 'lunch', sendAt: hm(12, 30), windowStart: hm(11), windowEnd: hm(15), defaultOn: true },
  snack: { slot: 'snack', sendAt: hm(15, 30), windowStart: hm(15), windowEnd: hm(17), defaultOn: false },
  dinner: { slot: 'dinner', sendAt: hm(18, 30), windowStart: hm(17), windowEnd: hm(22), defaultOn: true },
});

export function isMealSlot(v: unknown): v is MealSlot {
  return typeof v === 'string' && (MEAL_SLOTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------- preferences

export type MealReminderPrefs = Record<MealSlot, boolean>;

export const DEFAULT_MEAL_REMINDER_PREFS: Readonly<MealReminderPrefs> = Object.freeze({
  breakfast: true,
  lunch: true,
  snack: false,
  dinner: true,
});

/**
 * `profiles.preferences.notifications.meal_reminders` → full prefs with
 * defaults. Only explicit booleans override a default.
 */
export function mealReminderPrefsFrom(preferences: unknown): MealReminderPrefs {
  const raw = (preferences as { notifications?: { meal_reminders?: Record<string, unknown> } } | null | undefined)?.notifications?.meal_reminders;
  const out = { ...DEFAULT_MEAL_REMINDER_PREFS };
  if (raw && typeof raw === 'object') {
    for (const s of MEAL_SLOTS) if (typeof raw[s] === 'boolean') out[s] = raw[s];
  }
  return out;
}

/** Merge a partial patch into `profiles.preferences` (returns a new object; never drops other keys). */
export function withMealReminderPrefs(preferences: unknown, patch: Partial<MealReminderPrefs>): Record<string, unknown> {
  const prefs = preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? (preferences as Record<string, any>) : {};
  const notifications = prefs.notifications && typeof prefs.notifications === 'object' ? prefs.notifications : {};
  const current = notifications.meal_reminders && typeof notifications.meal_reminders === 'object' ? notifications.meal_reminders : {};
  const clean: Partial<MealReminderPrefs> = {};
  for (const s of MEAL_SLOTS) if (typeof patch[s] === 'boolean') clean[s] = patch[s];
  return { ...prefs, notifications: { ...notifications, meal_reminders: { ...current, ...clean } } };
}

// ---------------------------------------------------------------------------- local time

/** Local date (YYYY-MM-DD) and minutes after midnight of `at` in `timeZone`. */
export function localClock(at: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** The slot whose "logged" window contains `minutes`, or null (22:00–03:59). */
export function slotForMinutes(minutes: number): MealSlot | null {
  for (const s of MEAL_SLOTS) {
    const d = SLOT_DEFS[s];
    if (minutes >= d.windowStart && minutes < d.windowEnd) return s;
  }
  return null;
}

/**
 * The slot whose reminder is due at `minutes`: [sendAt, sendAt + graceMinutes).
 * The cron runs every 15 min, so a 60-min grace survives a skipped run; the
 * dedupe key keeps it to one push per slot per local day.
 */
export function dueSlot(minutes: number, graceMinutes = 60): MealSlot | null {
  for (const s of MEAL_SLOTS) {
    const d = SLOT_DEFS[s];
    if (minutes >= d.sendAt && minutes < d.sendAt + graceMinutes) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------- logged detection

export interface MealEntryLite {
  entry_type?: string | null;
  entry_date: string;
  meal_type: string | null;
  /** When the food was eaten (food_log_entries.logged_at). */
  logged_at: string | null;
  deleted_at?: string | null;
}

/**
 * Slots counted as logged on `localDate`: an entry with that meal_type, OR an
 * entry whose logged_at falls in the slot's window (user-local). This is what
 * closes the "lunch logged as snack" gap. Water / supplements never count.
 */
export function loggedSlots(entries: readonly MealEntryLite[], localDate: string, timeZone: string): Set<MealSlot> {
  const out = new Set<MealSlot>();
  for (const e of entries) {
    if (e.deleted_at) continue;
    if (e.entry_type && e.entry_type !== 'food') continue;
    if (e.entry_date !== localDate) {
      // entry_date is the client's local day; logged_at may still put it on localDate.
      if (!e.logged_at) continue;
    }
    if (e.entry_date === localDate && isMealSlot(e.meal_type)) out.add(e.meal_type);
    if (e.logged_at) {
      const t = new Date(e.logged_at);
      if (Number.isNaN(t.getTime())) continue;
      let clock: { date: string; minutes: number };
      try {
        clock = localClock(t, timeZone);
      } catch {
        continue;
      }
      if (clock.date !== localDate) continue;
      const s = slotForMinutes(clock.minutes);
      if (s) out.add(s);
    }
  }
  return out;
}
