/** momentum_at_risk on D+1 is skipped after a delivered dont_miss_twice / streak_save_offer (ENGAGEMENT_115_SPEC §5.2). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getReferralDb } = await import('./referral-fake-db');
  return { createAdminSupabase: () => getReferralDb().client() };
});
const h = vi.hoisted(() => ({ sent: [] as string[], delivered: new Set<string>() }));
vi.mock('../notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    NotificationOrchestrator: {
      ...real.NotificationOrchestrator,
      hasSent: async (_u: string, type: string) => h.delivered.has(type),
      send: async (_u: string, type: string) => (h.sent.push(type), { sent: true }),
    },
  };
});

import { ReminderService } from '../reminder-service';

import { ReferralFakeDb, setReferralDb } from './referral-fake-db';

const U = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T00:05:00Z')); // 19:05 New York
  const db = new ReferralFakeDb();
  Object.assign(db.tables, { push_tokens: [{ user_id: U, is_active: true }], notification_preferences: [], engagement_streaks: [{ user_id: U, current_streak: 4 }], streak_claims: [], food_log_entries: [] });
  db.addProfile({ id: U, timezone: 'America/New_York' });
  setReferralDb(db);
  h.sent = [];
  h.delivered = new Set();
});
afterEach(() => vi.useRealTimers());

describe('ReminderService momentum_at_risk vs the D+1 push', () => {
  it('sends without a D+1 push (unchanged)', async () => {
    await ReminderService.sendDailyStreakReminders();
    expect(h.sent).toEqual(['momentum_at_risk']);
  });
  it.each(['dont_miss_twice', 'streak_save_offer'])('skips after a delivered %s in the last 20 h', async (type) => {
    h.delivered.add(type);
    const r = await ReminderService.sendDailyStreakReminders();
    expect(h.sent).toEqual([]);
    expect(r.skippedActed).toBe(1);
  });
});
