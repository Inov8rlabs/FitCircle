import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Grouped chat notifications (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §2):
// thread-id per circle, summary-arg, "alert once" burst etiquette (durable via
// notification_log), unread badge, blocked pairs, the cheer push.
// Real orchestrator + chat fan-out over an in-memory DB; FCM is captured.
// ---------------------------------------------------------------------------

import { ChatFakeDb } from './chat-fake-db';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => holder.db.client() }));

vi.mock('../notification-preferences-service', () => ({
  NotificationPreferencesService: {
    isTypeEnabled: async () => true,
    getPreferences: async () => ({ quiet_hours_start: null, quiet_hours_end: null, quiet_hours_timezone: 'UTC' }),
  },
}));

const sendPush = vi.hoisted(() => vi.fn(async (_userId: string, _n: unknown) => 1));
const realPush = vi.hoisted(() => ({ PushService: null as any }));
vi.mock('../push-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../push-service')>();
  realPush.PushService = actual.PushService;
  return { ...actual, PushService: { sendPush: (...args: unknown[]) => (sendPush as any)(...args) } };
});

import { ChatNotificationService, type PlannedPush } from '../chat-notification-service';
import { CHAT_QUIET_WINDOW_MINUTES, NotificationOrchestrator, NOTIFICATION_TEMPLATES } from '../notification-orchestrator';
import { QUIET_CHAT_RELEVANCE } from '../push-presentation';
import { CHAT_BADGE_FEATURE, CHAT_QUIET_FEATURE, apsExtras, buildFCMMessage, forDevice, parseClientFeatures, type PushNotification } from '../push-service';

const CIRCLE = 'c-steps';
const OTHER_CIRCLE = 'c-lift';
let db: ChatFakeDb;

const lastPush = () => sendPush.mock.calls.at(-1)![1] as PushNotification;
const pushFor = (userId: string) => sendPush.mock.calls.filter(([u]) => u === userId).map(([, n]) => n as PushNotification);
const chatData = (i: number, circleId = CIRCLE) => ({
  circleId,
  circleName: 'Nov steps challenge',
  friendName: `F${i}`,
  senderName: `F${i}`,
  senderId: `s${i}`,
  preview: `message ${i}`,
  messageId: `m${i}-${circleId}`,
  dedupeKey: `msg:m${i}-${circleId}`,
  conversation: true,
});

beforeEach(() => {
  db = new ChatFakeDb();
  holder.db = db;
  db.tables = {
    notification_log: [],
    fitcircle_members: [],
    circle_chat_state: [],
    circle_member_blocks: [],
    circle_messages: [],
    profiles: [],
  };
  sendPush.mockClear();
  sendPush.mockImplementation(async () => 1);
  NotificationOrchestrator.resetInProcessGuards();
});
afterEach(() => vi.useRealTimers());

describe('wire shape', () => {
  it('chat: thread-id = circle id, summary-arg = circle name, badge, sound unless silent', () => {
    const n: PushNotification = {
      title: 'Raveesh in Nov steps challenge',
      body: "Let's go!",
      data: { type: 'chat_message' },
      chat: { threadId: CIRCLE },
      badge: 4,
      apns: { summaryArg: 'Nov steps challenge', interruptionLevel: 'active', mutableContent: true },
    };
    const aps = buildFCMMessage('tok', n).message.apns!.payload.aps;
    expect(aps).toMatchObject({ 'thread-id': CIRCLE, 'summary-arg': 'Nov steps challenge', badge: 4, sound: 'default', 'mutable-content': 1 });
    const quiet = buildFCMMessage('tok', { ...n, silent: true, apns: { ...n.apns, interruptionLevel: 'passive' } }).message.apns!.payload.aps;
    expect(quiet).not.toHaveProperty('sound');
    expect(quiet['interruption-level']).toBe('passive');
    // Android stays data-only.
    expect(buildFCMMessage('tok', n).message.notification).toBeUndefined();
  });

  it('no badge key when unknown; summary-arg omitted when absent', () => {
    const aps = buildFCMMessage('tok', { title: 't', body: 'b', chat: { threadId: CIRCLE } }).message.apns!.payload.aps;
    expect(aps).not.toHaveProperty('badge');
    expect(apsExtras({})).toEqual({});
  });
});

describe('alert once per circle (burst etiquette), per device', () => {
  // A 1.1.x+ app that declared chat_quiet (+ chat_badge) vs every shipped build.
  const NEW = { client_features: [CHAT_QUIET_FEATURE, CHAT_BADGE_FEATURE] };
  const OLD = { client_features: [] as string[] };
  const on = (token: { client_features: string[] }, n: PushNotification) => forDevice(token, n);

  it('chat_quiet devices: first push alerts, follow-ups in 2 minutes are passive + silent + data.quiet', async () => {
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(2));
    const [first, second] = pushFor('bob');
    expect(first.chatDelivery).toEqual({ quiet: false, burstFollowUp: false });
    expect(second.chatDelivery).toEqual({ quiet: true, burstFollowUp: false });
    const a = on(NEW, first)!;
    expect(a.apns!.interruptionLevel).toBe('active');
    expect(a.silent).toBeUndefined();
    expect(a.data!.quiet).toBeUndefined();
    expect(a.chat).toEqual({ threadId: CIRCLE });
    expect(a.apns!.summaryArg).toBe('Nov steps challenge');
    expect(a).not.toHaveProperty('chatDelivery');
    const b = on(NEW, second)!;
    expect(b.apns!.interruptionLevel).toBe('passive');
    expect(b.apns!.relevanceScore).toBe(QUIET_CHAT_RELEVANCE);
    expect(b.silent).toBe(true);
    expect(b.data!.quiet).toBe('true');
    expect(buildFCMMessage('tok', b).message.apns!.payload.aps).not.toHaveProperty('sound');
    // The decision is recorded.
    expect(db.tables.notification_log.map((r) => r.data.quiet)).toEqual([false, true]);
  });

  it('devices without chat_quiet get the follow-up exactly as before (alerting, with sound)', async () => {
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(2));
    const legacy = on(OLD, pushFor('bob')[1])!;
    expect(legacy.apns!.interruptionLevel).toBe('active');
    expect(legacy.silent).toBeUndefined();
    expect(legacy.data!.quiet).toBeUndefined();
    expect(buildFCMMessage('tok', legacy).message.apns!.payload.aps.sound).toBe('default');
  });

  it('is per circle, and per recipient', async () => {
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(2, OTHER_CIRCLE));
    await NotificationOrchestrator.send('eve', 'chat_message', chatData(3));
    expect(sendPush.mock.calls.map(([, n]) => (n as PushNotification).chatDelivery!.quiet)).toEqual([false, false, false]);
  });

  it('durable: a chat push another instance logged 1 minute ago makes this one quiet; 3 minutes ago does not', async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    db.tables.notification_log.push({ user_id: 'bob', notification_type: 'chat_rally', suppressed: false, data: { circleId: CIRCLE }, sent_at: ago(1), title: 'x', body: 'y' });
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    expect(lastPush().chatDelivery!.quiet).toBe(true);

    NotificationOrchestrator.resetInProcessGuards();
    db.tables.notification_log = [
      { user_id: 'bob', notification_type: 'chat_message', suppressed: false, data: { circleId: CIRCLE }, sent_at: ago(CHAT_QUIET_WINDOW_MINUTES + 1), title: 'x', body: 'y' },
      // Suppressed rows and other circles never count.
      { user_id: 'bob', notification_type: 'chat_message', suppressed: true, data: { circleId: CIRCLE }, sent_at: ago(0.5), title: 'x', body: 'y' },
      { user_id: 'bob', notification_type: 'chat_message', suppressed: false, data: { circleId: OTHER_CIRCLE }, sent_at: ago(0.5), title: 'x', body: 'y' },
    ];
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(2));
    expect(lastPush().chatDelivery!.quiet).toBe(false);
  });

  it('a failed delivery does not make the next message quiet', async () => {
    sendPush.mockResolvedValueOnce(0);
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(2));
    expect(lastPush().chatDelivery!.quiet).toBe(false);
  });

  it('mentions always alert on every device, even inside the window', async () => {
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    await NotificationOrchestrator.send('bob', 'chat_mention', { ...chatData(2), preview: '@bob look' });
    expect(lastPush().chatDelivery).toBeUndefined();
    for (const token of [NEW, OLD]) {
      expect(on(token, lastPush())!.apns!.interruptionLevel).toBe('active');
      expect(on(token, lastPush())!.silent).toBeUndefined();
    }
  });

  it('burst follow-ups (4th+ in 2 min): chat_quiet devices get them quietly, other devices nothing', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await NotificationOrchestrator.send('bob', 'chat_message', chatData(i)));
    expect(results.every((r) => r.sent)).toBe(true); // the mock "delivered" to a chat_quiet device
    const pushes = pushFor('bob');
    expect(pushes.map((n) => n.chatDelivery!.burstFollowUp)).toEqual([false, false, false, true, true, true]);
    expect(pushes.map((n) => on(NEW, n)!.apns!.interruptionLevel)).toEqual(['active', 'passive', 'passive', 'passive', 'passive', 'passive']);
    // Shipped builds: the first three as before (alerting), then the old drop.
    expect(pushes.map((n) => on(OLD, n)?.apns!.interruptionLevel ?? 'dropped')).toEqual(['active', 'active', 'active', 'dropped', 'dropped', 'dropped']);
    expect(db.tables.notification_log.filter((r) => r.data.burstFollowUp).length).toBe(3);
  });

  it('a burst follow-up that reached no device (only shipped builds) is logged as the old burst drop', async () => {
    for (let i = 0; i < 3; i++) await NotificationOrchestrator.send('bob', 'chat_message', chatData(i));
    sendPush.mockResolvedValueOnce(0); // PushService skipped every token (none declared chat_quiet)
    expect(await NotificationOrchestrator.send('bob', 'chat_message', chatData(9))).toEqual({ sent: false, reason: 'burst' });
    expect(db.tables.notification_log.at(-1)).toMatchObject({ suppressed: true, suppression_reason: 'burst' });
  });

  it('ambient system chat pushes keep the old drop rule on every device', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const { conversation: _c, ...data } = chatData(i, `circle-${i}`);
      results.push(await NotificationOrchestrator.send('bob', 'chat_message', data));
    }
    expect(results.map((r) => r.reason ?? 'sent')).toEqual(['sent', 'sent', 'sent', 'burst', 'burst']);
  });

  it('forDevice: chat_quiet + chat_badge are independent', () => {
    const n: PushNotification = { title: 't', body: 'b', chat: { threadId: CIRCLE }, badge: 2, chatDelivery: { quiet: true, burstFollowUp: false } };
    expect(forDevice({ client_features: [CHAT_QUIET_FEATURE] }, n)).toMatchObject({ silent: true });
    expect(forDevice({ client_features: [CHAT_QUIET_FEATURE] }, n)).not.toHaveProperty('badge');
    const badgeOnly = forDevice({ client_features: [CHAT_BADGE_FEATURE] }, n)!;
    expect(badgeOnly.badge).toBe(2);
    expect(badgeOnly.silent).toBeUndefined();
    expect(forDevice({}, { ...n, chatDelivery: { quiet: true, burstFollowUp: true } })).toBeNull();
  });
});

describe('cheer push', () => {
  const cheer = {
    circleId: CIRCLE,
    circleName: 'Nov steps challenge',
    friendName: 'Ani',
    senderName: 'Ani',
    senderId: 'ani',
    emoji: '👏',
    cheerMessage: 'Keep going!',
    preview: 'cheered you 👏 · Keep going!',
    messageId: 'cheer-1',
    dedupeKey: 'cheer:cheer-1',
  };

  it('copy: "Ani cheered you 👏" / "Keep going! · <circle>"', () => {
    expect(NOTIFICATION_TEMPLATES.chat_cheer(cheer)).toEqual({ title: 'Ani cheered you 👏', body: 'Keep going! · Nov steps challenge', category: 'social' });
    expect(NOTIFICATION_TEMPLATES.chat_cheer({ ...cheer, cheerMessage: '' }).body).toBe('in Nov steps challenge');
  });

  it('rides the chat_mention wire type (shipped clients) with subtype=cheer, and alerts inside a burst', async () => {
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    await NotificationOrchestrator.send('bob', 'chat_cheer', cheer);
    const n = lastPush();
    expect(n.data).toMatchObject({ type: 'chat_mention', subtype: 'cheer', screen: 'circle_chat', circleId: CIRCLE, senderName: 'Ani', preview: 'cheered you 👏 · Keep going!' });
    expect(n.chat).toEqual({ threadId: CIRCLE });
    expect(n.apns!.interruptionLevel).toBe('active');
    expect(n.apns!.mutableContent).toBe(true);
    expect(n.silent).toBeUndefined();
    expect(db.tables.notification_log.at(-1)!.notification_type).toBe('chat_cheer');
  });

  it('notifyCheer sends chat_cheer with the badge and avatar, piercing mute', async () => {
    const send = vi.spyOn(NotificationOrchestrator, 'send').mockResolvedValue({ sent: true });
    db.tables.profiles.push({ id: 'ani', display_name: 'Ani', avatar_url: 'https://x/a.png' });
    db.tables.fitcircle_members.push({ fitcircle_id: CIRCLE, user_id: 'bob', status: 'active' });
    db.tables.circle_chat_state.push({ fitcircle_id: CIRCLE, user_id: 'bob', muted: true, last_read_at: null });
    await ChatNotificationService.notifyCheer({
      circleId: CIRCLE, circleName: 'Nov steps challenge', messageId: 'cheer-1', senderId: 'ani', senderName: 'Ani', recipientId: 'bob', emoji: '🔥', message: null,
    });
    expect(send).toHaveBeenCalledWith('bob', 'chat_cheer', expect.objectContaining({
      emoji: '🔥', cheerMessage: '', preview: 'cheered you 🔥', senderAvatarUrl: 'https://x/a.png', dedupeKey: 'cheer:cheer-1', badge: 0,
    }));
    send.mockRestore();
  });
});

describe('badge', () => {
  it('chat pushes carry the recipient unread total (aps.badge + data.unreadTotal)', async () => {
    db.tables.fitcircle_members.push({ fitcircle_id: CIRCLE, user_id: 'bob', status: 'active' });
    db.tables.circle_messages.push(
      { id: 'a', fitcircle_id: CIRCLE, sender_id: 'eve', created_at: new Date().toISOString(), deleted_at: null },
      { id: 'b', fitcircle_id: CIRCLE, sender_id: 'eve', created_at: new Date().toISOString(), deleted_at: null }
    );
    await NotificationOrchestrator.send('bob', 'chat_message', chatData(1));
    expect(lastPush().badge).toBe(2);
    expect(lastPush().data!.unreadTotal).toBe('2');
    expect(buildFCMMessage('tok', lastPush()).message.apns!.payload.aps.badge).toBe(2);
  });

  it('a caller-provided badge wins (batched fan-out)', async () => {
    await NotificationOrchestrator.send('bob', 'chat_message', { ...chatData(1), badge: 7 });
    expect(lastPush().badge).toBe(7);
  });

  it('non-chat pushes never get a chat badge', async () => {
    await NotificationOrchestrator.send('bob', 'weekly_summary', { workoutsThisWeek: 1, streakDays: 2 });
    expect(lastPush().badge).toBeUndefined();
    expect(lastPush().data!.unreadTotal).toBeUndefined();
  });
});

describe('fan-out: blocks, exclusions, badges', () => {
  beforeEach(() => {
    for (const user_id of ['ani', 'bob', 'eve', 'mal', 'rav', 'mute']) {
      db.tables.fitcircle_members.push({ fitcircle_id: CIRCLE, user_id, status: 'active' });
      db.tables.profiles.push({ id: user_id, display_name: user_id, avatar_url: null });
    }
    db.tables.circle_chat_state.push({ fitcircle_id: CIRCLE, user_id: 'mute', muted: true, last_read_at: null });
    db.tables.circle_member_blocks.push(
      { blocker_id: 'eve', blocked_id: 'ani' }, // eve blocked the sender
      { blocker_id: 'ani', blocked_id: 'mal' } // the sender blocked mal
    );
  });

  it('member message: no push to either side of a block, to excluded ids, or to muted members', async () => {
    const send = vi.spyOn(NotificationOrchestrator, 'send').mockResolvedValue({ sent: true });
    await ChatNotificationService.notifyNewMessage(CIRCLE, 'ani', 'Ani', 'Nov steps challenge', 'm1', '👏 @rav Keep going!', { excludeUserIds: ['rav'] });
    expect(send.mock.calls.map(([u]) => u).sort()).toEqual(['bob']);
    expect(send.mock.calls[0][2]).toMatchObject({ conversation: true, badge: 0, circleId: CIRCLE, dedupeKey: 'msg:m1' });
    send.mockRestore();
  });

  it('system / member-post pushes about a member skip blocked pairs; badges are stamped', async () => {
    const planned: PlannedPush[] = ['bob', 'eve', 'mal'].map((userId) => ({
      userId,
      type: 'chat_message',
      data: { circleId: CIRCLE, senderId: 'ani', preview: 'Ani logged lunch' },
    }));
    planned.push({ userId: 'eve', type: 'chat_rally', data: { circleId: CIRCLE, body: 'Circle streak 7' } });
    const kept = await ChatNotificationService.withBlocksAndBadges(planned);
    expect(kept.map((p) => `${p.userId}:${p.type}`)).toEqual(['bob:chat_message', 'eve:chat_rally']);
    expect(kept.every((p) => typeof p.data.badge === 'number')).toBe(true);
  });
});

describe('badge only for devices that manage it (shipped iOS never clears it)', () => {
  const n: PushNotification = { title: 't', body: 'b', chat: { threadId: CIRCLE }, badge: 3, data: { unreadTotal: '3' } };

  it('X-Client-Features parsing', () => {
    expect(parseClientFeatures(' icon_keys, CHAT_BADGE ,reactions_v2,,bad feature,x'.repeat(1))).toEqual(['icon_keys', 'chat_badge', 'reactions_v2', 'x']);
    expect(parseClientFeatures(null)).toEqual([]);
  });

  it('strips aps.badge for tokens without chat_badge (or registered before migration 123)', () => {
    expect(forDevice({ client_features: [CHAT_BADGE_FEATURE] }, n)!.badge).toBe(3);
    expect(forDevice({ client_features: ['icon_keys'] }, n)).not.toHaveProperty('badge');
    expect(forDevice({}, n)).not.toHaveProperty('badge');
    expect(buildFCMMessage('tok', forDevice({}, n)!).message.apns!.payload.aps).not.toHaveProperty('badge');
    const noBadge = { ...n, badge: undefined };
    expect(forDevice({}, noBadge)).toBe(noBadge);
  });

  it('registerToken stores the features, and still registers before the column exists', async () => {
    await realPush.PushService.registerToken('bob', 'tok-1', 'ios', 'iPhone', ['chat_badge']);
    expect(db.tables.push_tokens[0]).toMatchObject({ token: 'tok-1', client_features: ['chat_badge'], is_active: true });

    // Pre-123 database: the first upsert fails on the unknown column, the retry omits it.
    const calls: Array<Record<string, unknown>> = [];
    holder.db = {
      client: () => ({
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            calls.push(row);
            const result = 'client_features' in row
              ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'client_features' column" } }
              : { data: { id: 't', ...row }, error: null };
            return { select: () => ({ single: async () => result }) };
          },
        }),
      }),
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const saved = await realPush.PushService.registerToken('bob', 'tok-2', 'ios', undefined, ['chat_badge']);
    log.mockRestore();
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toHaveProperty('client_features');
    expect(saved).toMatchObject({ token: 'tok-2' });
  });
});
