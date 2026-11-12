import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Push Sent analytics + open-tracking payload contract (docs/PUSH_NOTIFICATIONS.md §7):
//  - every notification_log row the orchestrator writes gets one `Push Sent`
//    Amplitude event (sent | suppressed | failed | no_token), insert_id = row id;
//  - every delivered payload carries data.notification_id = that row's id;
//  - meal reminders carry route=log_meal_camera + mealType, and rotate copy by date.
// In-memory Supabase; PushService.sendPush is stubbed (it fills the send report).
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  db: null as any,
  push: { sent: 1, tokens: 2, platforms: ['ios', 'android'] as string[] },
  calls: [] as Array<{ userId: string; n: any }>,
  afterTasks: [] as Array<() => unknown>,
}));

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => h.db }));
vi.mock('../notification-preferences-service', () => ({
  NotificationPreferencesService: {
    isTypeEnabled: async (_u: string, type: string) => type !== 'weekly_summary',
    getPreferences: async () => ({ quiet_hours_start: null, quiet_hours_end: null, quiet_hours_timezone: 'UTC' }),
  },
}));
vi.mock('../push-service', async (importOriginal) => {
  const actual = await importOriginal<typeof PushServiceModule>();
  return {
    ...actual,
    PushService: {
      sendPush: async (userId: string, n: any, report?: { activeTokens: number; platforms: string[] }) => {
        h.calls.push({ userId, n });
        if (report) {
          report.activeTokens = h.push.tokens;
          report.platforms = [...h.push.platforms];
        }
        return h.push.sent;
      },
    },
  };
});
vi.mock('../../utils/after-response', () => ({
  runAfterResponse: (task: () => unknown) => {
    h.afterTasks.push(task);
  },
}));

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { MEAL_REMINDER_COPY, mealReminderCopy } from '../../journey/meal-reminders';
import {
  PUSH_SENT_BATCH_MAX,
  buildPushSentEvent,
  flushPushSentEvents,
  pendingPushSentEvents,
  pushPlatformFor,
  recordPushSent,
  resetPushSentEvents,
} from '../../notifications/push-sent-events';
import { MEAL_REMINDER_ROUTE, NotificationOrchestrator } from '../notification-orchestrator';
import type * as PushServiceModule from '../push-service';

const USER = '11111111-2222-4333-8444-555555555555';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

const logRows = () => h.db.getRows('notification_log') as any[];
const lastPush = () => h.calls.at(-1)!.n;
const events = () => pendingPushSentEvents();

beforeEach(() => {
  h.db = new FakeSupabase({ notification_log: {}, profiles: { uniqueKey: ['id'] } });
  h.db.seed('profiles', [{ id: USER, timezone: 'UTC' }]);
  h.push = { sent: 1, tokens: 2, platforms: ['ios', 'android'] };
  h.calls = [];
  h.afterTasks = [];
  process.env.AMPLITUDE_SERVER_API_KEY = 'test-amplitude-key';
  resetPushSentEvents();
  NotificationOrchestrator.resetInProcessGuards();
});
afterEach(() => {
  delete process.env.AMPLITUDE_SERVER_API_KEY;
  resetPushSentEvents();
});

describe('orchestrator: notification_id + Push Sent per notification_log row', () => {
  it('delivered: payload notification_id = the log row id; Push Sent outcome sent', async () => {
    const res = await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4 });
    expect(res.sent).toBe(true);
    const rows = logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(UUID_RE);
    expect(lastPush().data.notification_id).toBe(rows[0].id);

    expect(events()).toEqual([
      {
        event_type: 'Push Sent',
        user_id: USER,
        event_properties: {
          notification_type: 'momentum_at_risk',
          outcome: 'sent',
          notification_category: 'momentum',
          push_platform: 'both',
          notification_id: rows[0].id,
        },
        time: expect.any(Number),
        insert_id: `push-sent:${rows[0].id}`,
      },
    ]);
    // One flush is scheduled after the response, not one per event.
    expect(h.afterTasks).toHaveLength(1);
  });

  it('no active token → outcome no_token (row still suppressed / no_delivery)', async () => {
    h.push = { sent: 0, tokens: 0, platforms: [] };
    await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4 });
    expect(logRows()[0]).toMatchObject({ suppressed: true, suppression_reason: 'no_delivery' });
    expect(events()[0].event_properties).toEqual({
      notification_type: 'momentum_at_risk',
      outcome: 'no_token',
      notification_category: 'momentum',
      suppression_reason: 'no_delivery',
      notification_id: logRows()[0].id,
    });
  });

  it('tokens exist but every send failed → outcome failed with the platform', async () => {
    h.push = { sent: 0, tokens: 1, platforms: ['ios'] };
    await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4 });
    expect(events()[0].event_properties).toMatchObject({ outcome: 'failed', push_platform: 'ios', suppression_reason: 'no_delivery' });
  });

  it('suppressed before sending → outcome suppressed + reason, no push, no platform', async () => {
    await NotificationOrchestrator.send(USER, 'weekly_summary', {});
    expect(h.calls).toHaveLength(0);
    const [e] = events();
    expect(e.event_properties).toMatchObject({ outcome: 'suppressed', suppression_reason: 'category_disabled', notification_id: logRows()[0].id });
    expect(e.event_properties).not.toHaveProperty('push_platform');
  });

  it('a duplicate is logged + tracked with its own row id', async () => {
    await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4, dedupeKey: 'k1' });
    await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4, dedupeKey: 'k1' });
    const rows = logRows();
    expect(rows.map((r) => r.suppression_reason ?? null)).toEqual([null, 'duplicate']);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(events().map((e) => [e.event_properties!.outcome, e.insert_id])).toEqual([
      ['sent', `push-sent:${rows[0].id}`],
      ['suppressed', `push-sent:${rows[1].id}`],
    ]);
  });

  it('no Amplitude key → nothing queued, push + log unchanged', async () => {
    delete process.env.AMPLITUDE_SERVER_API_KEY;
    await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4 });
    expect(logRows()).toHaveLength(1);
    expect(lastPush().data.notification_id).toBe(logRows()[0].id);
    expect(events()).toHaveLength(0);
    expect(h.afterTasks).toHaveLength(0);
  });
});

describe('meal reminder payload + copy', () => {
  it('carries route=log_meal_camera, mealType, screen food_log and notification_id', async () => {
    await NotificationOrchestrator.send(USER, 'meal_reminder_lunch', {
      mealType: 'lunch',
      dedupeKey: 'meal:lunch:2026-11-12',
      localDate: '2026-11-12',
      currentMomentum: 0,
    });
    const n = lastPush();
    expect(MEAL_REMINDER_ROUTE).toBe('log_meal_camera');
    expect(n.data).toMatchObject({
      type: 'meal_reminder_lunch',
      category: 'momentum',
      screen: 'food_log',
      mealType: 'lunch',
      route: 'log_meal_camera',
      notification_id: logRows()[0].id,
    });
    expect({ title: n.title, body: n.body }).toEqual(mealReminderCopy('lunch', '2026-11-12'));
  });

  it('non-meal pushes never get a route key', async () => {
    await NotificationOrchestrator.send(USER, 'momentum_at_risk', { currentMomentum: 4 });
    expect(lastPush().data).not.toHaveProperty('route');
  });

  it('copy rotates by local date, is deterministic, and has no emoji', () => {
    for (const [slot, variants] of Object.entries(MEAL_REMINDER_COPY)) {
      expect(variants.length).toBeGreaterThanOrEqual(2);
      for (const v of variants) {
        expect(v.title).not.toMatch(EMOJI_RE);
        expect(v.body).not.toMatch(EMOJI_RE);
        expect(v.title.length).toBeLessThanOrEqual(45);
      }
      const days = ['2026-11-12', '2026-11-13', '2026-11-14'].map((d) => mealReminderCopy(slot as any, d));
      expect(days[0]).not.toEqual(days[1]);
      expect(mealReminderCopy(slot as any, '2026-11-12')).toEqual(days[0]);
    }
    expect(mealReminderCopy('lunch', undefined)).toEqual(MEAL_REMINDER_COPY.lunch[0]);
    expect(mealReminderCopy('lunch', 'garbage')).toEqual(MEAL_REMINDER_COPY.lunch[0]);
  });

  it('only dinner mentions a number, and only the real open streak', () => {
    expect(mealReminderCopy('dinner', '2026-11-12', 5).body).toBe('Snap dinner to keep your 5-day streak going.');
    expect(mealReminderCopy('dinner', '2026-11-12', 0).body).not.toMatch(/\d/);
    expect(mealReminderCopy('lunch', '2026-11-12', 5).body).not.toMatch(/\d/);
  });
});

describe('push-sent-events module', () => {
  it('pushPlatformFor maps token platforms', () => {
    expect(pushPlatformFor(['ios'])).toBe('ios');
    expect(pushPlatformFor(['android', 'android'])).toBe('android');
    expect(pushPlatformFor(['ios', 'android'])).toBe('both');
    expect(pushPlatformFor(['web'])).toBeUndefined();
    expect(pushPlatformFor([])).toBeUndefined();
    expect(pushPlatformFor(undefined)).toBeUndefined();
  });

  it('sent events never carry a suppression_reason', () => {
    const e = buildPushSentEvent({ notificationId: 'n-1', userId: USER, notificationType: 'x', outcome: 'sent', suppressionReason: 'ignored' });
    expect(e.event_properties).not.toHaveProperty('suppression_reason');
  });

  it('flushes one cron run as batched HTTP V2 requests with platform server', async () => {
    const total = PUSH_SENT_BATCH_MAX * 2 + 1;
    for (let i = 0; i < total; i++) {
      recordPushSent({ notificationId: `n-${i}`, userId: USER, notificationType: 'meal_reminder_lunch', outcome: 'sent' });
    }
    expect(h.afterTasks).toHaveLength(1);
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    });
    const accepted = await flushPushSentEvents({ fetchImpl: fetchImpl as any });
    expect(accepted).toBe(total);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api2.amplitude.com/2/httpapi');
    expect(bodies.map((b) => b.events.length)).toEqual([PUSH_SENT_BATCH_MAX, PUSH_SENT_BATCH_MAX, 1]);
    expect(bodies[0].api_key).toBe('test-amplitude-key');
    expect(bodies[0].events[0]).toMatchObject({ event_type: 'Push Sent', user_id: USER, platform: 'server', insert_id: 'push-sent:n-0' });
    expect(pendingPushSentEvents()).toHaveLength(0);

    // A later record schedules a fresh flush.
    recordPushSent({ notificationId: 'late', userId: USER, notificationType: 'x', outcome: 'sent' });
    expect(h.afterTasks).toHaveLength(2);
  });

  it('a failing or hanging Amplitude never throws', async () => {
    recordPushSent({ notificationId: 'n-1', userId: USER, notificationType: 'x', outcome: 'sent' });
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(flushPushSentEvents({ fetchImpl: fetchImpl as any })).resolves.toBe(0);
  });
});
