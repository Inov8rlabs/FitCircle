/**
 * MealReminderService.run (ACTIVATION_JOURNEY_SPEC §4) end to end against an
 * in-memory DB: timezone resolution, slot prefs, logged-by-time, dedupe across
 * runs, dormant backoff, kill switch; plus the orchestrator policy for the new types.
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
vi.mock('../notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return { ...real, NotificationOrchestrator: { ...real.NotificationOrchestrator, send: (...a: any[]) => send(...a) } };
});

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';

import { MealReminderService } from '../meal-reminder-service';
import {
  CAP_EXEMPT_TYPES,
  NOTIFICATION_TEMPLATES,
  TYPE_SCREEN_MAP,
  isCapChecked,
  isCapExempt,
  type NotificationType,
} from '../notification-orchestrator';
import { NotificationPreferencesService } from '../notification-preferences-service';

const NY = '11111111-1111-4111-8111-111111111111';
const IN = '22222222-2222-4222-8222-222222222222';
// 16:35 UTC = 12:35 New York (EDT) = 22:05 Kolkata.
const NOW = new Date('2026-10-26T16:35:00Z');

let db: HomeFeedFakeDb;

beforeEach(() => {
  db = new HomeFeedFakeDb();
  Object.assign(db.tables, { push_tokens: [], notification_preferences: [], notification_log: [], engagement_streaks: [] });
  setHomeFeedDb(db);
  send.mockReset().mockImplementation(async (userId: string, type: string, data: any) => {
    db.rows('notification_log').push({ user_id: userId, notification_type: type, data, suppressed: false, sent_at: NOW.toISOString() });
    return { sent: true };
  });
  db.rows('push_tokens').push({ user_id: NY, is_active: true }, { user_id: IN, is_active: true });
  db.rows('profiles').push(
    { id: NY, timezone: 'America/New_York', preferences: {}, created_at: '2026-10-01T00:00:00Z' },
    { id: IN, timezone: 'Asia/Kolkata', preferences: {}, created_at: '2026-10-01T00:00:00Z' }
  );
  db.rows('food_log_entries').push({ user_id: NY, entry_type: 'food', entry_date: '2026-10-25', meal_type: 'dinner', logged_at: '2026-10-25T23:00:00Z', deleted_at: null });
});
afterEach(() => {
  delete process.env.MEAL_REMINDERS_ENABLED;
});

describe('MealReminderService.run', () => {
  it('sends lunch at 12:35 New York (not to the Kolkata user at 22:05), with slot + dedupe key + food_log routing', async () => {
    const r = await MealReminderService.run({ now: NOW });
    expect(r).toMatchObject({ candidates: 2, due: 1, sent: 1, bySlot: { lunch: 1 } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(NY, 'meal_reminder_lunch', expect.objectContaining({ mealType: 'lunch', dedupeKey: 'meal:lunch:2026-10-26', localDate: '2026-10-26', currentMomentum: 0 }));
  });

  it('a second run in the same window does not resend (dedupe key already attempted)', async () => {
    await MealReminderService.run({ now: NOW });
    const r = await MealReminderService.run({ now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(r.sent).toBe(0);
    expect(r.skipped.already_sent).toBe(1);
  });

  it('skips when lunch is already logged — even when it was logged as a snack at 12:10', async () => {
    db.rows('food_log_entries').push({ user_id: NY, entry_type: 'food', entry_date: '2026-10-26', meal_type: 'snack', logged_at: '2026-10-26T16:10:00Z', deleted_at: null });
    const r = await MealReminderService.run({ now: NOW });
    expect(r.sent).toBe(0);
    expect(r.skipped.slot_logged).toBe(1);
  });

  it('respects the per-slot toggle in profiles.preferences', async () => {
    db.rows('profiles')[0].preferences = { notifications: { meal_reminders: { lunch: false } } };
    const r = await MealReminderService.run({ now: NOW });
    expect(r.sent).toBe(0);
    expect(r.skipped.slot_off).toBe(1);
  });

  it('uses notification_preferences.quiet_hours_timezone first (what quiet hours use)', async () => {
    db.rows('notification_preferences').push({ user_id: IN, quiet_hours_timezone: 'America/Chicago' }); // 11:35 Chicago → nothing due
    db.rows('notification_preferences').push({ user_id: NY, quiet_hours_timezone: 'America/Chicago' });
    const r = await MealReminderService.run({ now: NOW });
    expect(r.due).toBe(0);
  });

  it('dormant backoff: no meal in 7 days and 3 meal reminders since → skip; resumes after a new log', async () => {
    db.rows('food_log_entries').length = 0;
    db.rows('food_log_entries').push({ user_id: NY, entry_type: 'food', entry_date: '2026-10-10', meal_type: 'lunch', logged_at: '2026-10-10T16:00:00Z', created_at: '2026-10-10T16:00:00Z', deleted_at: null });
    for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) {
      db.rows('notification_log').push({ user_id: NY, notification_type: 'meal_reminder_dinner', data: {}, suppressed: false, sent_at: `${d}T22:30:00Z` });
    }
    const r = await MealReminderService.run({ now: NOW });
    expect(r.skipped.dormant_backoff).toBe(1);
    db.rows('food_log_entries').push({ user_id: NY, entry_type: 'food', entry_date: '2026-10-26', meal_type: 'breakfast', logged_at: '2026-10-26T12:00:00Z', deleted_at: null });
    expect((await MealReminderService.run({ now: NOW })).sent).toBe(1);
  });

  it('kill switch MEAL_REMINDERS_ENABLED=false', async () => {
    process.env.MEAL_REMINDERS_ENABLED = 'false';
    const r = await MealReminderService.run({ now: NOW });
    expect(r).toMatchObject({ enabled: false, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('dinner mentions the streak only while today is unclaimed', async () => {
    const dinner = new Date('2026-10-26T22:35:00Z'); // 18:35 New York
    db.rows('engagement_streaks').push({ user_id: NY, current_streak: 12 });
    await MealReminderService.run({ now: dinner });
    expect(send).toHaveBeenCalledWith(NY, 'meal_reminder_dinner', expect.objectContaining({ currentMomentum: 12, dedupeKey: 'meal:dinner:2026-10-26' }));
  });
});

describe('orchestrator policy for the meal slots + fitzy_intro', () => {
  const MEAL: NotificationType[] = ['meal_reminder_breakfast', 'meal_reminder_lunch', 'meal_reminder_snack', 'meal_reminder_dinner'];
  it('meal reminders: momentum category, food_log screen (routable on shipped apps), never counted toward the cap but blocked by it', () => {
    for (const t of MEAL) {
      expect(NotificationPreferencesService.getCategoryForType(t)).toBe('momentum');
      expect(TYPE_SCREEN_MAP[t]).toBe('food_log');
      expect(isCapExempt(t)).toBe(true);
      expect(CAP_EXEMPT_TYPES.has(t)).toBe(true);
      expect(isCapChecked(t)).toBe(true);
      const c = NOTIFICATION_TEMPLATES[t]({});
      expect(c.title.length).toBeLessThanOrEqual(50);
      expect(c.body).not.toMatch(/haven't|forgot|missed|still/i); // warm, no guilt
    }
    expect(isCapChecked('chat_message')).toBe(false);
    expect(isCapChecked('momentum_at_risk')).toBe(true);
    expect(NOTIFICATION_TEMPLATES.meal_reminder_dinner({ currentMomentum: 5 }).body).toContain('5-day streak');
  });
  it('fitzy_intro: coach category, opens fitzy_chat', () => {
    expect(NotificationPreferencesService.getCategoryForType('fitzy_intro')).toBe('coach');
    expect(TYPE_SCREEN_MAP.fitzy_intro).toBe('fitzy_chat');
    expect(isCapExempt('fitzy_intro')).toBe(false);
  });
});
