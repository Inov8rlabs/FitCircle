import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import {
  CAP_EXEMPT_TYPES,
  MAX_NOTIFICATIONS_PER_DAY,
  NOTIFICATION_TEMPLATES,
  isCapExempt,
  isWithinQuietWindow,
  startOfLocalDay,
  type NotificationType,
} from '../notification-orchestrator';

describe('frequency cap policy', () => {
  it('caps nudges at 3 per day', () => {
    expect(MAX_NOTIFICATIONS_PER_DAY).toBe(3);
  });

  it('exempts chat, meal reminders and streak/challenge outcomes', () => {
    for (const t of [
      'chat_message', 'chat_mention', 'chat_rally',
      'meal_reminder_lunch', 'meal_reminder_dinner',
      'streak_lost', 'shield_applied', 'challenge_completed',
    ] as NotificationType[]) {
      expect(isCapExempt(t), t).toBe(true);
    }
    for (const t of ['daily_drop', 'momentum_at_risk', 'weekly_summary', 'dormant_7d'] as NotificationType[]) {
      expect(isCapExempt(t), t).toBe(false);
    }
  });

  it('every exempt type still exists in the catalog', () => {
    for (const t of CAP_EXEMPT_TYPES) expect(NOTIFICATION_TEMPLATES[t]).toBeTypeOf('function');
  });
});

describe('quiet hours window', () => {
  const m = (h: number, min = 0) => h * 60 + min;
  it('handles an overnight window', () => {
    expect(isWithinQuietWindow(m(23), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietWindow(m(3), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietWindow(m(7), '22:00', '07:00')).toBe(false);
    expect(isWithinQuietWindow(m(12), '22:00', '07:00')).toBe(false);
  });
  it('handles a same-day window and Postgres TIME with seconds', () => {
    expect(isWithinQuietWindow(m(10), '09:00:00', '17:00:00')).toBe(true);
    expect(isWithinQuietWindow(m(17), '09:00:00', '17:00:00')).toBe(false);
  });
  it('treats an empty window as off', () => {
    expect(isWithinQuietWindow(m(10), '10:00', '10:00')).toBe(false);
  });
});

describe('startOfLocalDay', () => {
  it('returns local midnight as a UTC instant', () => {
    // 2026-09-13 15:30 UTC == 11:30 in New York (EDT, UTC-4) → local midnight is 04:00 UTC
    const now = new Date('2026-09-13T15:30:00Z');
    expect(startOfLocalDay('America/New_York', now).toISOString()).toBe('2026-09-13T04:00:00.000Z');
    // …and 00:30 the next day in Kolkata (UTC+5:30) → local midnight is 18:30 UTC
    expect(startOfLocalDay('Asia/Kolkata', now).toISOString()).toBe('2026-09-12T18:30:00.000Z');
  });
});
