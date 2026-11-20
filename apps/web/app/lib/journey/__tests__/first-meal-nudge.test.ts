/**
 * "Snap your first meal" push (ENGAGEMENT_115_SPEC §14.7): pure policy + the meal-reminder cron
 * integration (replaces that slot's reminder, once per user, test accounts / meals excluded).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('../../supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
const send = vi.fn();
vi.mock('../../services/notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return { ...real, NotificationOrchestrator: { ...real.NotificationOrchestrator, send: (...a: any[]) => send(...a) } };
});

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';

import { MealReminderService } from '../../services/meal-reminder-service';
import { NOTIFICATION_TEMPLATES, TYPE_SCREEN_MAP, isCapChecked, isCapExempt } from '../../services/notification-orchestrator';
import { NotificationPreferencesService } from '../../services/notification-preferences-service';
import {
  decideFirstMealNudge,
  firstMealNudgeCopy,
  firstMealNudgeEnabled,
  firstMealNudgeSlot,
  nextMealNudgeFrom,
} from '../first-meal-nudge';
import { DEFAULT_MEAL_REMINDER_PREFS } from '../meal-slots';

const NY = 'America/New_York';
const prefs = { ...DEFAULT_MEAL_REMINDER_PREFS };

describe('firstMealNudgeSlot (first lunch 12:30 / dinner 18:30 ≥ 60 min and ≤ 24 h after onboarding)', () => {
  it('finished 10:00 → lunch 12:30 the same day', () => {
    expect(firstMealNudgeSlot(new Date('2026-11-16T15:00:00Z'), NY, prefs)).toMatchObject({ slot: 'lunch', localDate: '2026-11-16', at: new Date('2026-11-16T17:30:00Z') });
  });
  it('finished 11:45 → lunch is < 60 min away → dinner 18:30', () => {
    expect(firstMealNudgeSlot(new Date('2026-11-16T16:45:00Z'), NY, prefs)).toMatchObject({ slot: 'dinner', localDate: '2026-11-16' });
  });
  it('finished 22:00 → lunch the next day; lunch toggle off → dinner next day', () => {
    expect(firstMealNudgeSlot(new Date('2026-11-17T03:00:00Z'), NY, prefs)).toMatchObject({ slot: 'lunch', localDate: '2026-11-17' });
    expect(firstMealNudgeSlot(new Date('2026-11-17T03:00:00Z'), NY, { ...prefs, lunch: false })).toMatchObject({ slot: 'dinner', localDate: '2026-11-17' });
  });
  it('both slots off → no push', () => {
    expect(firstMealNudgeSlot(new Date('2026-11-16T15:00:00Z'), NY, { ...prefs, lunch: false, dinner: false })).toBeNull();
  });
});

describe('decideFirstMealNudge', () => {
  const base = {
    now: new Date('2026-11-16T17:40:00Z'), // 12:40 NY
    timezone: NY,
    onboardingCompletedAt: '2026-11-16T15:00:00Z',
    hasAnyMeal: false,
    attemptedBefore: false,
    isTestAccount: false,
    prefs,
  };
  it('due inside [12:30, 13:30) → send lunch', () => {
    expect(decideFirstMealNudge(base)).toMatchObject({ send: true, slot: 'lunch', localDate: '2026-11-16' });
  });
  it('skips: test account, meal or draft, attempted before (once ever), not finished, switch off', () => {
    expect(decideFirstMealNudge({ ...base, isTestAccount: true })).toMatchObject({ skip: 'test_account' });
    expect(decideFirstMealNudge({ ...base, hasAnyMeal: true })).toMatchObject({ skip: 'has_meal' });
    expect(decideFirstMealNudge({ ...base, attemptedBefore: true })).toMatchObject({ skip: 'already_attempted' });
    expect(decideFirstMealNudge({ ...base, onboardingCompletedAt: null })).toMatchObject({ skip: 'onboarding_not_completed' });
    expect(decideFirstMealNudge({ ...base, enabled: false })).toMatchObject({ skip: 'disabled' });
  });
  it('before the slot → not_yet; an hour after → missed (no later slot is tried)', () => {
    expect(decideFirstMealNudge({ ...base, now: new Date('2026-11-16T17:00:00Z') })).toMatchObject({ skip: 'not_yet', slot: 'lunch' });
    expect(decideFirstMealNudge({ ...base, now: new Date('2026-11-16T18:31:00Z') })).toMatchObject({ skip: 'missed' });
  });
  it('copy, switch, onboarding flag', () => {
    expect(firstMealNudgeCopy('dinner')).toEqual({ title: 'Snap your dinner', body: 'Take a photo and FitCircle works out the calories in seconds.' });
    expect(firstMealNudgeCopy('lunch').title).toBe('Snap your lunch');
    expect(firstMealNudgeEnabled({} as any)).toBe(true);
    expect(firstMealNudgeEnabled({ FIRST_MEAL_NUDGE_ENABLED: 'false' } as any)).toBe(false);
    expect(nextMealNudgeFrom({ next_meal_nudge: true })).toBe(true);
    expect(nextMealNudgeFrom({ next_meal_nudge: 'yes' })).toBe(false);
    expect(nextMealNudgeFrom(null)).toBe(false);
  });
});

describe('orchestrator policy for first_meal_nudge', () => {
  it('food log + camera route, momentum category (meal-reminder toggle), counts toward the cap', async () => {
    expect(TYPE_SCREEN_MAP.first_meal_nudge).toBe('food_log');
    expect(NOTIFICATION_TEMPLATES.first_meal_nudge({ mealType: 'dinner' })).toMatchObject({ title: 'Snap your dinner', category: 'momentum' });
    expect(isCapExempt('first_meal_nudge')).toBe(false);
    expect(isCapChecked('first_meal_nudge')).toBe(true);
    expect(NotificationPreferencesService.getCategoryForType('first_meal_nudge')).toBe('momentum');
  });
});

describe('MealReminderService.run → first_meal_nudge', () => {
  const U = '33333333-3333-4333-8333-333333333333';
  const NOW = new Date('2026-11-16T17:35:00Z'); // 12:35 NY
  let db: HomeFeedFakeDb;
  beforeEach(() => {
    db = new HomeFeedFakeDb();
    Object.assign(db.tables, { push_tokens: [], notification_preferences: [], notification_log: [], engagement_streaks: [], onboarding_progress: [] });
    setHomeFeedDb(db);
    send.mockReset().mockImplementation(async (userId: string, type: string, data: any) => {
      db.rows('notification_log').push({ user_id: userId, notification_type: type, data, suppressed: false, sent_at: NOW.toISOString() });
      return { sent: true };
    });
    db.rows('push_tokens').push({ user_id: U, is_active: true });
    db.rows('profiles').push({
      id: U,
      timezone: NY,
      preferences: {},
      created_at: '2026-11-16T14:40:00Z',
      onboarding_completed_at: '2026-11-16T15:00:00Z',
      email: 'maya@gmail.com',
      is_admin: false,
      metadata: {},
    });
    db.rows('onboarding_progress').push({ user_id: U, data: { next_meal_nudge: true } });
  });
  afterEach(() => {
    delete process.env.FIRST_MEAL_NUDGE_ENABLED;
  });

  it('sends first_meal_nudge INSTEAD of the lunch reminder, once ever; the lunch reminder never follows', async () => {
    const r = await MealReminderService.run({ now: NOW });
    expect(r).toMatchObject({ sent: 1, firstMealNudges: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(U, 'first_meal_nudge', expect.objectContaining({
      mealType: 'lunch',
      dedupeKey: `first_meal_nudge:${U}`,
      slotKey: 'meal:lunch:2026-11-16',
      nextMealNudge: true,
    }));
    // 15 min later: neither the nudge again nor the lunch reminder.
    const again = await MealReminderService.run({ now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(again.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a meal (or draft) → the normal lunch reminder; a test account → no nudge; switch off → normal reminder', async () => {
    db.rows('food_log_entries').push({ user_id: U, entry_type: 'food', entry_status: 'draft', entry_date: '2026-11-15', meal_type: 'dinner', logged_at: '2026-11-15T23:00:00Z', deleted_at: null });
    await MealReminderService.run({ now: NOW });
    expect(send).toHaveBeenCalledWith(U, 'meal_reminder_lunch', expect.anything());

    send.mockClear();
    db.rows('food_log_entries').length = 0;
    db.rows('notification_log').length = 0;
    db.rows('profiles')[0].email = 'robot@example.com';
    await MealReminderService.run({ now: NOW });
    expect(send).not.toHaveBeenCalledWith(U, 'first_meal_nudge', expect.anything());

    send.mockClear();
    db.rows('notification_log').length = 0;
    db.rows('profiles')[0].email = 'maya@gmail.com';
    process.env.FIRST_MEAL_NUDGE_ENABLED = 'false';
    await MealReminderService.run({ now: NOW });
    expect(send).toHaveBeenCalledWith(U, 'meal_reminder_lunch', expect.anything());
  });

  it('a quiet-hours / suppressed attempt still counts as the one attempt (skip, never deferred)', async () => {
    send.mockImplementationOnce(async (userId: string, type: string, data: any) => {
      db.rows('notification_log').push({ user_id: userId, notification_type: type, data, suppressed: true, suppression_reason: 'quiet_hours', sent_at: NOW.toISOString() });
      return { sent: false, reason: 'quiet_hours' };
    });
    const r = await MealReminderService.run({ now: NOW });
    expect(r.skipped.first_meal_nudge_quiet_hours).toBe(1);
    const later = await MealReminderService.run({ now: new Date('2026-11-16T23:35:00Z') }); // dinner
    expect(send).toHaveBeenLastCalledWith(U, 'meal_reminder_dinner', expect.anything());
    expect(later.firstMealNudges).toBe(0);
  });
});
