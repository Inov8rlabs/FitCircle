/**
 * Meal-slot reminders (ACTIVATION_JOURNEY_SPEC §4): slot windows, timezones
 * (incl. :30/:45 offsets) against the 15-minute cron, logged-by-time-window,
 * prefs, dedupe, dormant backoff.
 */
import { describe, expect, it } from 'vitest';

import {
  DORMANT_IGNORED_REMINDERS,
  decideMealReminder,
  isDormant,
  mealDedupeKey,
  type MealReminderInput,
} from '../meal-reminders';
import {
  DEFAULT_MEAL_REMINDER_PREFS,
  SLOT_DEFS,
  dueSlot,
  loggedSlots,
  mealReminderPrefsFrom,
  slotForMinutes,
  withMealReminderPrefs,
} from '../meal-slots';

const hm = (h: number, m = 0) => h * 60 + m;

describe('slots + windows', () => {
  it('send times and logged windows per spec', () => {
    expect(SLOT_DEFS.breakfast.sendAt).toBe(hm(8, 30));
    expect(SLOT_DEFS.lunch.sendAt).toBe(hm(12, 30));
    expect(SLOT_DEFS.snack.sendAt).toBe(hm(15, 30));
    expect(SLOT_DEFS.dinner.sendAt).toBe(hm(18, 30));
    expect(slotForMinutes(hm(3, 59))).toBeNull();
    expect(slotForMinutes(hm(4))).toBe('breakfast');
    expect(slotForMinutes(hm(10, 59))).toBe('breakfast');
    expect(slotForMinutes(hm(11))).toBe('lunch');
    expect(slotForMinutes(hm(14, 59))).toBe('lunch');
    expect(slotForMinutes(hm(15))).toBe('snack');
    expect(slotForMinutes(hm(17))).toBe('dinner');
    expect(slotForMinutes(hm(21, 59))).toBe('dinner');
    expect(slotForMinutes(hm(22))).toBeNull();
  });
  it('a slot is due for 60 min after its send time', () => {
    expect(dueSlot(hm(8, 29))).toBeNull();
    expect(dueSlot(hm(8, 30))).toBe('breakfast');
    expect(dueSlot(hm(9, 29))).toBe('breakfast');
    expect(dueSlot(hm(9, 30))).toBeNull();
  });
});

describe('preferences', () => {
  it('defaults: breakfast/lunch/dinner on, snack off; explicit booleans override', () => {
    expect(mealReminderPrefsFrom(null)).toEqual({ breakfast: true, lunch: true, snack: false, dinner: true });
    expect(mealReminderPrefsFrom({ notifications: { meal_reminders: { snack: true, lunch: false, dinner: 'no' } } })).toEqual({ breakfast: true, lunch: false, snack: true, dinner: true });
  });
  it('patch merge keeps every other preference', () => {
    const merged = withMealReminderPrefs({ hydration: { goal_ml: 2000 }, notifications: { push: true, meal_reminders: { lunch: false } } }, { snack: true, bogus: true } as any);
    expect(merged).toEqual({ hydration: { goal_ml: 2000 }, notifications: { push: true, meal_reminders: { lunch: false, snack: true } } });
  });
});

describe('logged detection: meal_type OR entry time in the window', () => {
  const TZ = 'America/New_York';
  it('counts meal_type on the local day', () => {
    expect([...loggedSlots([{ entry_date: '2026-10-26', meal_type: 'dinner', logged_at: null }], '2026-10-26', TZ)]).toEqual(['dinner']);
  });
  it('a lunch logged as "snack" at 12:40 local counts as lunch too', () => {
    const s = loggedSlots([{ entry_date: '2026-10-26', meal_type: 'snack', logged_at: '2026-10-26T16:40:00Z' }], '2026-10-26', TZ);
    expect([...s].sort()).toEqual(['lunch', 'snack']);
  });
  it('ignores water/supplements, deleted rows, other days and the 22:00–03:59 gap', () => {
    const s = loggedSlots(
      [
        { entry_type: 'water', entry_date: '2026-10-26', meal_type: null, logged_at: '2026-10-26T16:40:00Z' },
        { entry_date: '2026-10-26', meal_type: 'breakfast', logged_at: null, deleted_at: '2026-10-26T13:00:00Z' },
        { entry_date: '2026-10-25', meal_type: 'lunch', logged_at: '2026-10-25T16:40:00Z' },
        { entry_date: '2026-10-26', meal_type: 'other', logged_at: '2026-10-27T03:30:00Z' }, // 23:30 local
      ],
      '2026-10-26',
      TZ
    );
    expect([...s]).toEqual([]);
  });
});

describe('cron cadence × timezones', () => {
  const base = (now: Date, timezone: string, over: Partial<MealReminderInput> = {}): MealReminderInput => ({
    now,
    timezone,
    prefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
    entries: [],
    lastMealAt: now.toISOString(),
    remindersSinceLastMeal: 0,
    attemptedKeys: new Set(),
    ...over,
  });

  for (const tz of ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Adelaide', 'Pacific/Auckland']) {
    it(`${tz}: every 15-min tick over a day sends each enabled slot exactly once, within 15 min of local send time`, () => {
      const sent: Array<{ slot: string; localMinutes: number }> = [];
      const attempted = new Set<string>();
      const start = Date.parse('2026-10-26T00:00:00Z');
      // Warm up 2 h first so a window that is already open at `start` was handled by an earlier tick.
      for (let t = start - 2 * 3_600_000; t < start + 26 * 3_600_000; t += 15 * 60_000) {
        const now = new Date(t);
        const d = decideMealReminder(base(now, tz, { attemptedKeys: attempted }));
        if (d.send) {
          attempted.add(d.dedupeKey);
          if (t < start) continue;
          const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
          const m = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
          sent.push({ slot: d.slot, localMinutes: m });
        }
      }
      const perDay = new Map<string, number>();
      for (const k of attempted) perDay.set(k, (perDay.get(k) ?? 0) + 1);
      for (const n of perDay.values()) expect(n).toBe(1);
      for (const s of sent) {
        const target = SLOT_DEFS[s.slot as keyof typeof SLOT_DEFS].sendAt;
        expect(s.localMinutes - target).toBeGreaterThanOrEqual(0);
        expect(s.localMinutes - target).toBeLessThan(15);
      }
      expect(sent.map((s) => s.slot)).not.toContain('snack'); // off by default
      expect(new Set(sent.map((s) => s.slot))).toEqual(new Set(['breakfast', 'lunch', 'dinner']));
    });
  }
});

describe('decideMealReminder', () => {
  // 12:30 New York (EDT) on 2026-10-26.
  const NOW = new Date('2026-10-26T16:30:00Z');
  const input = (over: Partial<MealReminderInput> = {}): MealReminderInput => ({
    now: NOW,
    timezone: 'America/New_York',
    prefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
    entries: [],
    lastMealAt: '2026-10-25T23:00:00Z',
    remindersSinceLastMeal: 0,
    attemptedKeys: new Set(),
    ...over,
  });

  it('sends the due slot with the dedupe key meal:<slot>:<localDate>', () => {
    expect(decideMealReminder(input())).toEqual({ send: true, slot: 'lunch', type: 'meal_reminder_lunch', localDate: '2026-10-26', dedupeKey: 'meal:lunch:2026-10-26' });
    expect(mealDedupeKey('breakfast', '2026-10-27')).toBe('meal:breakfast:2026-10-27');
  });
  it('skips: not due, toggle off, already attempted, slot logged (by type or by time), dormant', () => {
    expect(decideMealReminder(input({ now: new Date('2026-10-26T18:00:00Z') }))).toMatchObject({ send: false, skip: 'not_due' });
    expect(decideMealReminder(input({ prefs: { ...DEFAULT_MEAL_REMINDER_PREFS, lunch: false } }))).toMatchObject({ send: false, skip: 'slot_off' });
    expect(decideMealReminder(input({ attemptedKeys: new Set(['meal:lunch:2026-10-26']) }))).toMatchObject({ send: false, skip: 'already_sent' });
    expect(decideMealReminder(input({ entries: [{ entry_date: '2026-10-26', meal_type: 'lunch', logged_at: null }] }))).toMatchObject({ skip: 'slot_logged' });
    expect(decideMealReminder(input({ entries: [{ entry_date: '2026-10-26', meal_type: 'snack', logged_at: '2026-10-26T15:45:00Z' }] }))).toMatchObject({ skip: 'slot_logged' });
    expect(decideMealReminder(input({ lastMealAt: '2026-10-10T00:00:00Z', remindersSinceLastMeal: 3 }))).toMatchObject({ skip: 'dormant_backoff' });
  });
  it('snack only when opted in', () => {
    const snackTime = new Date('2026-10-26T19:35:00Z'); // 15:35 EDT
    expect(decideMealReminder(input({ now: snackTime }))).toMatchObject({ send: false, skip: 'slot_off' });
    expect(decideMealReminder(input({ now: snackTime, prefs: { ...DEFAULT_MEAL_REMINDER_PREFS, snack: true } }))).toMatchObject({ send: true, slot: 'snack', type: 'meal_reminder_snack' });
  });
});

describe('dormant backoff', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  it('no meal in 7 days AND ≥ 3 reminders since the last meal → stop; a new log resumes', () => {
    expect(isDormant('2026-10-18T12:00:00Z', DORMANT_IGNORED_REMINDERS, now)).toBe(true);
    expect(isDormant('2026-10-18T12:00:00Z', DORMANT_IGNORED_REMINDERS - 1, now)).toBe(false);
    expect(isDormant('2026-10-20T12:00:00Z', 10, now)).toBe(false);
    expect(isDormant(null, 3, now)).toBe(true); // never logged + 3 ignored reminders
    expect(isDormant(null, 2, now)).toBe(false);
  });
});
