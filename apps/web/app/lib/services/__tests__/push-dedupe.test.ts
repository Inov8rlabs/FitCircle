import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Push fan-out / dedupe (docs/PUSH_NOTIFICATIONS.md). Reproduces the
// 2026-10-24 incident: Ani (in 5 circles) hit a 7-day streak and got five
// "Big moment in <circle>" pushes about himself, and every member got one
// per shared circle.
//
// Real code under test: ChatActivityHooks → SystemPostEngine.ingest →
// ChatNotificationService → NotificationOrchestrator.send → buildFCMMessage.
// Stubbed: the DB (a small in-memory fake, so the notification_log backstop is
// exercised for real), the circle_messages write, preferences, and the FCM
// call itself (PushService.sendPush records what it was handed).
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, seq: 0 }));
const sendPush = vi.hoisted(() => vi.fn(async (_userId: string, _n: unknown) => 1));

function colValue(row: Row, col: string): any {
  if (col.startsWith('data->>')) return row.data?.[col.slice('data->>'.length)];
  return row[col];
}

class FakeQuery implements PromiseLike<any> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Row | Row[] | null = null;
  private countMode = false;
  private head = false;
  private limitN: number | null = null;
  constructor(private table: string) {}
  private rows(): Row[] {
    return (db.tables[this.table] ??= []);
  }
  select(_c?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  eq(col: string, val: any) { this.filters.push((r) => colValue(r, col) === val); return this; }
  is(col: string, val: any) { this.filters.push((r) => (colValue(r, col) ?? null) === val); return this; }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(colValue(r, col))); return this; }
  gte(col: string, val: any) { this.filters.push((r) => colValue(r, col) >= val); return this; }
  lt(col: string, val: any) { this.filters.push((r) => colValue(r, col) < val); return this; }
  not(col: string, op: string, val: any) {
    if (op === 'in') {
      const vals = String(val).replace(/[()]/g, '').split(',');
      this.filters.push((r) => !vals.includes(colValue(r, col)));
    } else this.filters.push((r) => colValue(r, col) !== val);
    return this;
  }
  order() { return this; }
  limit(n: number) { this.limitN = n; return this; }
  async maybeSingle() { const { data } = this.run(); return { data: (data as Row[])[0] ?? null, error: null }; }
  async single() {
    const { data } = this.run();
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
  }
  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, ko);
  }
  private run(): { data: any; count?: number; error: null } {
    if (this.op === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted = list.map((r) => ({ id: `row-${++db.seq}`, sent_at: new Date().toISOString(), ...r }));
      this.rows().push(...inserted);
      return { data: inserted, error: null };
    }
    const matched = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      return { data: matched, error: null };
    }
    const data = this.limitN === null ? matched : matched.slice(0, this.limitN);
    return { data: this.head ? null : data, count: this.countMode ? matched.length : undefined, error: null };
  }
}

vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => ({ from: (t: string) => new FakeQuery(t) }),
}));

vi.mock('../notification-preferences-service', () => ({
  NotificationPreferencesService: {
    isTypeEnabled: async () => true,
    getPreferences: async () => ({ quiet_hours_start: null, quiet_hours_end: null, quiet_hours_timezone: 'UTC' }),
  },
}));

vi.mock('../push-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../push-service')>();
  return { ...actual, PushService: { sendPush: (...args: unknown[]) => (sendPush as any)(...args) } };
});

// The timeline write itself (DTO mapping needs half the schema); returns what
// the engine reads back.
vi.mock('../circle-chat-service', () => ({
  CircleChatService: {
    emitSystemPost: async (p: { fitcircleId: string; body: string; eventType: string }) => {
      const row = { id: `msg-${++db.seq}`, fitcircle_id: p.fitcircleId, kind: 'system_event', system_event_type: p.eventType, body: p.body, created_at: new Date().toISOString() };
      (db.tables.circle_messages ??= []).push(row);
      return row;
    },
  },
}));

import { ChatActivityHooks } from '../chat-activity-hooks';
import { ChatNotificationService, type SystemPushIntent } from '../chat-notification-service';
import { DailySummaryService, type SummarizedCircle } from '../daily-summary-service';
import {
  BURST_LIMIT,
  NotificationOrchestrator,
  collapseIdFor,
  threadIdFor,
} from '../notification-orchestrator';
import { buildFCMMessage, type PushNotification } from '../push-service';
import { SystemPostEngine } from '../system-post-engine';

// ---------------------------------------------------------------------------
// Fixture: the incident
// ---------------------------------------------------------------------------

const ANI = 'ani';
const CIRCLES = [
  { id: 'c-daily', name: 'Daily Movers Club' },
  { id: 'c-stepup', name: 'Step-Up Circle' },
  { id: 'c-oak', name: 'OakvilleBesties' },
  { id: 'c-crew', name: "Ani's Crew" },
  { id: 'c-htl', name: 'Hold the Line Crew' },
];

function seed() {
  db.tables = {};
  db.seq = 0;
  const members: Row[] = [];
  const state: Row[] = [];
  const join = (user: string, circle: string, muted = false) => {
    members.push({ user_id: user, fitcircle_id: circle, status: 'active' });
    if (muted) state.push({ user_id: user, fitcircle_id: circle, muted: true });
  };
  for (const c of CIRCLES) join(ANI, c.id);
  // Bob shares 3 circles with Ani.
  join('bob', 'c-daily');
  join('bob', 'c-stepup');
  join('bob', 'c-oak');
  // Carol shares 2 and muted both.
  join('carol', 'c-stepup', true);
  join('carol', 'c-htl', true);
  // Dee shares 2 and muted one.
  join('dee', 'c-daily', true);
  join('dee', 'c-htl');
  // Eve shares one.
  join('eve', 'c-oak');
  db.tables.fitcircle_members = members;
  db.tables.circle_chat_state = state;
  db.tables.fitcircles = CIRCLES.map((c) => ({ id: c.id, name: c.name, status: 'active' }));
  db.tables.profiles = [{ id: ANI, display_name: 'Ani', avatar_url: 'https://cdn.example.com/ani.jpg' }];
  db.tables.notification_log = [];
  db.tables.circle_messages = [];
}

/** Let the fire-and-forget fan-out (void send(...)) run to completion. */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
}

const pushesTo = (userId: string) =>
  sendPush.mock.calls.filter(([u]) => u === userId).map(([, n]) => n as PushNotification);

beforeEach(() => {
  seed();
  sendPush.mockClear();
  NotificationOrchestrator.resetInProcessGuards();
});

// ---------------------------------------------------------------------------

describe('incident 2026-10-24: 7-day streak rally across 5 circles', () => {
  it('posts in every circle but pushes the actor 0 times and each member once', async () => {
    await ChatActivityHooks.onStreakMilestone(ANI, 7);
    await settle();

    // In-app: still one post per circle.
    const posts = db.tables.circle_messages.filter((m) => m.system_event_type === 'streak_milestone');
    expect(posts.map((p) => p.fitcircle_id).sort()).toEqual(CIRCLES.map((c) => c.id).sort());

    // Push: never the actor.
    expect(pushesTo(ANI)).toHaveLength(0);

    // Bob shares 3 circles → exactly 1, coalesced copy.
    const bob = pushesTo('bob');
    expect(bob).toHaveLength(1);
    expect(bob[0].title).toBe("Ani's on a 7-day streak");
    expect(bob[0].body).toMatch(/^Celebrate in .+ and 2 other circles$/);
    expect(bob[0].data?.type).toBe('chat_rally');
    expect(bob[0].data?.screen).toBe('circle_chat');
    expect(['c-daily', 'c-stepup', 'c-oak']).toContain(bob[0].data?.circleId);

    // Carol muted every shared circle → 0 (rallies respect mute now).
    expect(pushesTo('carol')).toHaveLength(0);

    // Dee muted one of two → 1, about the unmuted circle, single-circle copy.
    const dee = pushesTo('dee');
    expect(dee).toHaveLength(1);
    expect(dee[0].title).toBe('Big moment in Hold the Line Crew');
    expect(dee[0].body).toBe("Ani's on a 7-day streak — nice");
    expect(dee[0].data?.circleId).toBe('c-htl');

    // Eve shares one → unchanged single-circle copy.
    expect(pushesTo('eve').map((n) => n.title)).toEqual(['Big moment in OakvilleBesties']);

    // Total: bob + dee + eve.
    expect(sendPush).toHaveBeenCalledTimes(3);
  });

  it('a replay of the same milestone (double check-in) pushes nobody again', async () => {
    await ChatActivityHooks.onStreakMilestone(ANI, 7);
    await settle();
    sendPush.mockClear();
    // Fresh process: only the notification_log backstop remains.
    NotificationOrchestrator.resetInProcessGuards();
    await ChatActivityHooks.onStreakMilestone(ANI, 7);
    await settle();
    expect(sendPush).not.toHaveBeenCalled();
    const dupes = db.tables.notification_log.filter((r) => r.suppression_reason === 'duplicate');
    expect(dupes.map((r) => r.user_id).sort()).toEqual(['bob', 'dee', 'eve']);
  });

  it('ordinary cross-circle system posts (workout) also push once per recipient, never the actor', async () => {
    await ChatActivityHooks.onWorkoutCompleted(ANI, 'workout-1');
    await settle();
    expect(pushesTo(ANI)).toHaveLength(0);
    const bob = pushesTo('bob');
    expect(bob).toHaveLength(1);
    expect(bob[0].title).toMatch(/^Ani in .+ and 2 other circles$/);
    expect(bob[0].body).toBe('Ani just logged a workout');
    expect(bob[0].data?.type).toBe('chat_message');
    expect(pushesTo('carol')).toHaveLength(0);
    expect(pushesTo('dee')).toHaveLength(1);
    expect(pushesTo('eve')).toHaveLength(1);
  });
});

describe('ChatNotificationService.planEventPushes (pure)', () => {
  const intent = (circleId: string, over: Partial<SystemPushIntent> = {}): SystemPushIntent => ({
    kind: 'rally',
    eventKey: 'streak_milestone:ani:d7',
    circleId,
    circleName: CIRCLES.find((c) => c.id === circleId)?.name ?? circleId,
    body: "Ani's on a 7-day streak — nice",
    eventType: 'streak_milestone',
    actorUserIds: [ANI],
    actorName: 'Ani',
    ...over,
  });
  const members = (rows: Array<[string, string, boolean?]>) => {
    const map = new Map<string, Array<{ userId: string; muted: boolean }>>();
    for (const [circle, user, muted] of rows) map.set(circle, [...(map.get(circle) ?? []), { userId: user, muted: !!muted }]);
    return map;
  };

  it('distinct events are not coalesced with each other', () => {
    const planned = ChatNotificationService.planEventPushes(
      [intent('c-daily'), intent('c-daily', { eventKey: 'workout_done:ani:w1', kind: 'system', body: 'Ani just logged a workout' })],
      members([['c-daily', ANI], ['c-daily', 'bob']])
    );
    expect(planned.map((p) => p.type)).toEqual(['chat_rally', 'chat_message']);
    expect(planned.every((p) => p.userId === 'bob')).toBe(true);
    expect(new Set(planned.map((p) => p.data.dedupeKey)).size).toBe(2);
  });

  it('excludes every bundled actor and explicitly excluded members', () => {
    const planned = ChatNotificationService.planEventPushes(
      [intent('c-daily', { kind: 'system', actorUserIds: [ANI, 'bob'], excludeUserIds: ['eve'] })],
      members([['c-daily', ANI], ['c-daily', 'bob'], ['c-daily', 'eve'], ['c-daily', 'zed']])
    );
    expect(planned.map((p) => p.userId)).toEqual(['zed']);
  });

  it('the same circle posted twice for one event counts once', () => {
    const planned = ChatNotificationService.planEventPushes(
      [intent('c-daily'), intent('c-daily')],
      members([['c-daily', 'bob']])
    );
    expect(planned).toHaveLength(1);
    expect(planned[0].data.otherCircleCount).toBeUndefined();
  });
});

describe('daily summary: one bundled push per recipient per night', () => {
  const summarized = (circleId: string, total: number, checkedIn: string[], body: string): SummarizedCircle => ({
    circleId,
    circleName: CIRCLES.find((c) => c.id === circleId)!.name,
    localDate: '2026-10-24',
    total,
    checkedInIds: new Set(checkedIn),
    body,
  });

  it('bundles every circle into one push with per-circle lines', async () => {
    const circles = [
      summarized('c-crew', 1, [ANI], 'Checked in today'),
      summarized('c-stepup', 6, [ANI, 'x'], '2 of 6 checked in today'),
      summarized('c-daily', 3, [ANI, 'bob', 'z'], 'Everyone checked in today — full house'),
    ];
    const planned = await DailySummaryService.sendBundledPushes(circles);
    await settle();
    expect(planned).toBeGreaterThan(0);

    const ani = pushesTo(ANI);
    expect(ani).toHaveLength(1);
    expect(ani[0].title).toBe('Your circles today');
    expect(ani[0].body).toBe(
      "Ani's Crew: you checked in · Step-Up Circle: 2 of 6 checked in · Daily Movers Club: everyone checked in"
    );
    expect(ani[0].data).toMatchObject({ type: 'circle_daily_summary', screen: 'circles' });
    expect(ani[0].data).not.toHaveProperty('circleId');

    // Bob is in Step-Up + Daily → one push, two lines.
    const bob = pushesTo('bob');
    expect(bob).toHaveLength(1);
    expect(bob[0].body).toBe('Step-Up Circle: 2 of 6 checked in · Daily Movers Club: everyone checked in');

    // Carol muted Step-Up (her only summarized circle) → nothing.
    expect(pushesTo('carol')).toHaveLength(0);

    // Every recipient exactly once.
    const users = sendPush.mock.calls.map(([u]) => u);
    expect(new Set(users).size).toBe(users.length);
  });

  it('a single shared circle deep-links to it; a solo circle alone never pushes', () => {
    const planned = DailySummaryService.planSummaryPushes(
      [summarized('c-crew', 1, [ANI], 'Checked in today'), summarized('c-oak', 3, ['eve'], '1 of 3 checked in today')],
      new Map([
        ['c-crew', [{ userId: ANI, muted: false }]],
        ['c-oak', [{ userId: 'eve', muted: false }, { userId: 'bob', muted: false }]],
      ])
    );
    expect(planned.find((p) => p.userId === ANI)).toBeUndefined();
    const eve = planned.find((p) => p.userId === 'eve')!;
    expect(eve.data).toMatchObject({ title: 'OakvilleBesties today', body: '1 of 3 checked in today', circleId: 'c-oak' });
    expect(eve.data.dedupeKey).toBe('daily_summary:2026-10-24');
  });

  it('a second cron tick the same night is suppressed as a duplicate', async () => {
    const circles = [summarized('c-oak', 3, ['eve'], '1 of 3 checked in today')];
    await DailySummaryService.sendBundledPushes(circles);
    await settle();
    NotificationOrchestrator.resetInProcessGuards();
    sendPush.mockClear();
    await DailySummaryService.sendBundledPushes(circles);
    await settle();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('the engine itself never pushes a daily summary', async () => {
    const engine = new SystemPostEngine();
    const res = await engine.ingest({
      fitcircleId: 'c-oak',
      actorUserId: 'c-oak',
      actorName: 'OakvilleBesties',
      eventType: 'daily_summary',
      refId: null,
      occurredAt: new Date().toISOString(),
      payload: { checkedIn: 1, total: 3 },
    });
    await settle();
    expect(res.written).toHaveLength(1);
    expect(res.intents).toHaveLength(0);
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe('NotificationOrchestrator.send duplicate guards', () => {
  it('suppresses a repeated dedupeKey (in-process) with reason duplicate', async () => {
    const a = await NotificationOrchestrator.send('bob', 'chat_message', { friendName: 'Ani', circleName: 'X', preview: 'one', dedupeKey: 'evt:k1' });
    const b = await NotificationOrchestrator.send('bob', 'chat_message', { friendName: 'Ani', circleName: 'X', preview: 'two', dedupeKey: 'evt:k1' });
    expect(a).toEqual({ sent: true });
    expect(b).toEqual({ sent: false, reason: 'duplicate' });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('suppresses a repeated dedupeKey from notification_log (cross-instance backstop)', async () => {
    db.tables.notification_log.push({
      user_id: 'bob', notification_type: 'chat_rally', title: 't', body: 'b', suppressed: false,
      data: { dedupeKey: 'evt:k2' }, sent_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const res = await NotificationOrchestrator.send('bob', 'chat_rally', { circleName: 'X', body: 'new', dedupeKey: 'evt:k2' });
    expect(res.reason).toBe('duplicate');
    expect(sendPush).not.toHaveBeenCalled();
    expect(db.tables.notification_log.at(-1)).toMatchObject({ suppressed: true, suppression_reason: 'duplicate' });
  });

  it('ignores a dedupeKey row older than 24h or one that was itself suppressed', async () => {
    db.tables.notification_log.push(
      { user_id: 'bob', notification_type: 'chat_rally', title: 't', body: 'b', suppressed: false, data: { dedupeKey: 'evt:k3' }, sent_at: new Date(Date.now() - 25 * 3600_000).toISOString() },
      { user_id: 'bob', notification_type: 'chat_rally', title: 't', body: 'b', suppressed: true, data: { dedupeKey: 'evt:k3' }, sent_at: new Date().toISOString() }
    );
    const res = await NotificationOrchestrator.send('bob', 'chat_rally', { circleName: 'X', body: 'b', dedupeKey: 'evt:k3' });
    expect(res).toEqual({ sent: true });
  });

  it('identical (type, title, body) within 10 minutes is a duplicate, even with no key', async () => {
    const data = { friendName: 'Ani', circleName: 'X', preview: 'lol' };
    expect((await NotificationOrchestrator.send('bob', 'chat_message', data)).sent).toBe(true);
    expect(await NotificationOrchestrator.send('bob', 'chat_message', data)).toEqual({ sent: false, reason: 'duplicate' });
    // From the log alone, too.
    NotificationOrchestrator.resetInProcessGuards();
    expect(await NotificationOrchestrator.send('bob', 'chat_message', data)).toEqual({ sent: false, reason: 'duplicate' });
    // Same copy to a different user is fine.
    expect((await NotificationOrchestrator.send('eve', 'chat_message', data)).sent).toBe(true);
  });

  it('is race-safe for concurrent sends in one request', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        NotificationOrchestrator.send('bob', 'chat_rally', { circleName: `Circle ${i}`, body: 'Big', dedupeKey: 'evt:race' })
      )
    );
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(results.filter((r) => r.reason === 'duplicate')).toHaveLength(4);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when nothing was delivered, so a retry can go', async () => {
    sendPush.mockResolvedValueOnce(0);
    const first = await NotificationOrchestrator.send('bob', 'chat_rally', { circleName: 'X', body: 'Big', dedupeKey: 'evt:retry' });
    expect(first.reason).toBe('no_delivery');
    const second = await NotificationOrchestrator.send('bob', 'chat_rally', { circleName: 'X', body: 'Big', dedupeKey: 'evt:retry' });
    expect(second).toEqual({ sent: true });
  });
});

describe('burst control', () => {
  it(`drops the ${BURST_LIMIT + 1}th+ social push inside 2 minutes with reason burst`, async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await NotificationOrchestrator.send('bob', 'chat_message', { friendName: `F${i}`, circleName: 'X', preview: `m${i}` }));
    }
    expect(results.map((r) => r.reason ?? 'sent')).toEqual(['sent', 'sent', 'sent', 'burst', 'burst']);
    expect(db.tables.notification_log.filter((r) => r.suppression_reason === 'burst')).toHaveLength(2);
  });

  it('never drops a direct @mention for a burst', async () => {
    for (let i = 0; i < 3; i++) {
      await NotificationOrchestrator.send('bob', 'chat_message', { friendName: `F${i}`, circleName: 'X', preview: `m${i}` });
    }
    const mention = await NotificationOrchestrator.send('bob', 'chat_mention', { friendName: 'Ani', preview: '@bob look' });
    expect(mention).toEqual({ sent: true });
  });

  it('counts pushes another instance already delivered (notification_log)', async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      db.tables.notification_log.push({ user_id: 'bob', notification_type: 'chat_rally', title: `t${i}`, body: 'b', suppressed: false, data: {}, sent_at: now });
    }
    expect(await NotificationOrchestrator.send('bob', 'chat_message', { friendName: 'A', circleName: 'X', preview: 'p' })).toEqual({
      sent: false,
      reason: 'burst',
    });
  });
});

describe('wire grouping: thread-id, apns-collapse-id, Android tag', () => {
  it('chat: thread-id per circle + apns-collapse-id = dedupeKey; Android stays data-only', async () => {
    await NotificationOrchestrator.send('bob', 'chat_rally', { circleId: 'c-oak', circleName: 'Oak', body: 'Big', dedupeKey: 'evt:streak_milestone:ani:d7' });
    const n = sendPush.mock.calls.at(-1)![1] as PushNotification;
    expect(n.chat).toEqual({ threadId: 'c-oak' });
    expect(n.collapseId).toBe('evt:streak_milestone:ani:d7');
    expect(n.data).toMatchObject({ dedupeKey: 'evt:streak_milestone:ani:d7', groupKey: 'c-oak' });
    const msg = buildFCMMessage('tok', n);
    expect(msg.message.apns!.headers).toEqual({ 'apns-priority': '10', 'apns-collapse-id': 'evt:streak_milestone:ani:d7' });
    expect(msg.message.apns!.payload.aps['thread-id']).toBe('c-oak');
    expect(msg.message.notification).toBeUndefined();
    expect(msg.message.android).toEqual({ priority: 'HIGH' });
  });

  it('non-chat: thread-id per category, collapse-id header and Android notification tag', async () => {
    await NotificationOrchestrator.send('bob', 'circle_daily_summary', { title: 'Your circles today', body: 'A · B', dedupeKey: 'daily_summary:2026-10-24' });
    const n = sendPush.mock.calls.at(-1)![1] as PushNotification;
    expect(n.chat).toBeUndefined();
    expect(n.threadId).toBe('fitcircle.social');
    const msg = buildFCMMessage('tok', n);
    expect(msg.message.apns!.headers).toEqual({ 'apns-collapse-id': 'daily_summary:2026-10-24' });
    expect(msg.message.apns!.payload.aps['thread-id']).toBe('fitcircle.social');
    expect(msg.message.android!.notification!.tag).toBe('daily_summary:2026-10-24');
    expect(msg.message.notification).toEqual({ title: 'Your circles today', body: 'A · B' });
  });

  it('no dedupeKey → no collapse-id header or tag (wire unchanged)', async () => {
    await NotificationOrchestrator.send('bob', 'weekly_summary', { workoutsThisWeek: 2, streakDays: 3 });
    const msg = buildFCMMessage('tok', sendPush.mock.calls.at(-1)![1] as PushNotification);
    expect(msg.message.apns!.headers).toBeUndefined();
    expect(msg.message.android!.notification).not.toHaveProperty('tag');
    expect(msg.message.apns!.payload.aps['thread-id']).toBe('fitcircle.journey');
  });

  it('collapse ids are ≤ 64 bytes and stable', () => {
    expect(collapseIdFor(undefined)).toBeUndefined();
    expect(collapseIdFor('evt:short')).toBe('evt:short');
    const long = `evt:workout_done:${'a'.repeat(36)}:${'b'.repeat(36)}`;
    const id = collapseIdFor(long)!;
    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(64);
    expect(collapseIdFor(long)).toBe(id);
    expect(collapseIdFor('evt:ünïcode')).toMatch(/^[0-9a-f]{64}$/);
    expect(threadIdFor('chat_message', 'social', {})).toBe('');
    expect(threadIdFor('perfect_day', 'circle', { circleId: 'c' })).toBe('fitcircle.circle');
  });
});

describe('circle-level posts that already have a dedicated push', () => {
  it('circle streak milestone and kickoff posts are written but never engine-pushed', async () => {
    await ChatActivityHooks.onCircleStreakMilestone('c-oak', 7);
    await ChatActivityHooks.onCircleKickoff('c-oak', 'OakvilleBesties', 3, 'full');
    await settle();
    expect(db.tables.circle_messages.map((m) => m.system_event_type).sort()).toEqual(['circle_kickoff', 'circle_streak']);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('a streak save pushes the circle but not the saver or the covered friend', async () => {
    db.tables.profiles.push({ id: 'eve', display_name: 'Eve' }, { id: 'bob', display_name: 'Bob' });
    await ChatActivityHooks.onCircleStreakSaved('c-oak', 'bob', 'eve', 'save-1');
    await settle();
    expect(sendPush.mock.calls.map(([u]) => u)).toEqual([ANI]);
  });
});
