import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CircleStreakView } from '../../types/circle-streak';

// ---------------------------------------------------------------------------
// Mocks: the orchestrator's DB-backed guards all pass; PushService is spied so
// we can inspect the PushNotification handed to it; the circle streak view is
// stubbed for the circle-card path.
// ---------------------------------------------------------------------------

const sendPush = vi.fn(async (_userId: string, _n: unknown) => 1);
const getStreak = vi.fn();

// Any query chain (select/eq/not/gte…/insert) resolves to "nothing logged yet".
function chain(): any {
  const result = { count: 0, data: null, error: null };
  return new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown) => void) => resolve(result) : chain),
    apply: () => chain(),
  });
}
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({ from: () => chain() }) }));

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

vi.mock('../circle-streak-service', () => ({
  CircleStreakService: { getStreak: (...args: unknown[]) => getStreak(...args) },
}));

import { NOTIFICATION_TEMPLATES, NotificationOrchestrator, type NotificationType } from '../notification-orchestrator';
import {
  APNS_PAYLOAD_BUDGET_BYTES,
  CIRCLE_CARD_MAX_MEMBERS,
  CIRCLE_CARD_TYPES,
  DEFAULT_PASSIVE_TYPES,
  passiveTypes,
  TIME_SENSITIVE_TYPES,
  TYPE_APNS_CATEGORY,
  buildCircleCard,
  byteLength,
  initialsFor,
  isHttpsUrl,
  presentationFor,
} from '../push-presentation';
import { apsExtras, buildFCMMessage, type PushNotification } from '../push-service';

const ME = 'user-me';

function view(members: Array<{ id: string; name: string; logged?: boolean; covered?: boolean }>, streak = 12): CircleStreakView {
  const loggedCount = members.filter((m) => m.logged || m.covered).length;
  return {
    fitcircleId: 'circle-1',
    currentStreak: streak,
    longestStreak: streak,
    lastActiveDate: '2026-10-21',
    updatedAt: null,
    today: {
      date: '2026-10-21',
      loggedCount,
      activeCount: members.length,
      needed: Math.ceil((members.length + 1) / 2),
      qualified: false,
      members: members.map((m) => ({
        userId: m.id,
        displayName: m.name,
        avatarUrl: null,
        logged: !!m.logged,
        covered: !!m.covered,
        coveredBy: m.covered ? 'Ana' : null,
      })),
    },
    saves: { poolRemaining: 1, poolSize: members.length, mySaveAvailable: true, weekResetsAt: '' },
    nextMilestone: null,
  };
}

describe('presentationFor', () => {
  it('maps the iOS categories to the types that have them', () => {
    expect(presentationFor('momentum_at_risk').category).toBe('STREAK_AT_RISK');
    expect(presentationFor('perfect_day').category).toBe('CIRCLE_CLOSED');
    expect(presentationFor('circle_streak_milestone').category).toBe('CIRCLE_CLOSED');
    expect(presentationFor('circle_streak_saved').category).toBe('CIRCLE_UPDATE');
    expect(presentationFor('circle_kickoff').category).toBe('CIRCLE_UPDATE');
    expect(presentationFor('circle_boost_threshold').category).toBe('CIRCLE_UPDATE');
    expect(presentationFor('weekly_summary').category).toBeUndefined();
    expect(presentationFor('chat_message').category).toBeUndefined();
  });

  it('only uses category identifiers the iOS app registers', () => {
    const registered = ['WATER_REMINDER', 'STREAK_AT_RISK', 'FRIEND_MISSED', 'CIRCLE_CLOSED', 'CIRCLE_UPDATE'];
    for (const category of Object.values(TYPE_APNS_CATEGORY)) expect(registered).toContain(category);
  });

  it('every mapped type exists in the catalog', () => {
    const mapped = [
      ...Object.keys(TYPE_APNS_CATEGORY),
      ...TIME_SENSITIVE_TYPES,
      ...DEFAULT_PASSIVE_TYPES,
    ] as NotificationType[];
    for (const t of mapped) expect(NOTIFICATION_TEMPLATES[t], t).toBeTypeOf('function');
  });

  it('streak-at-risk is time-sensitive and ranks highest', () => {
    const p = presentationFor('momentum_at_risk', { currentMomentum: 12 });
    expect(p.interruptionLevel).toBe('time-sensitive');
    expect(p.relevanceScore).toBeGreaterThanOrEqual(0.9);
  });

  it('low-value nudges are passive with a low score; re-engagement stays active', () => {
    for (const t of ['daily_drop', 'day30_monthly_recap', 'day14_challenge_nudge', 'challenge_halfway'] as NotificationType[]) {
      expect(presentationFor(t).interruptionLevel, t).toBe('passive');
      expect(presentationFor(t).relevanceScore, t).toBeLessThanOrEqual(0.2);
    }
    for (const t of ['dormant_7d', 'win_back_60d', 'streak_lost', 'weekly_summary', 'referral_progress'] as NotificationType[]) {
      expect(presentationFor(t).interruptionLevel, t).toBe('active');
    }
  });

  it('passive list is reversible from env: PUSH_PASSIVE_ENABLED=false and PUSH_PASSIVE_TYPES override', () => {
    expect(passiveTypes({})).toBe(DEFAULT_PASSIVE_TYPES);
    expect(passiveTypes({ PUSH_PASSIVE_ENABLED: 'false' }).size).toBe(0);
    expect(presentationFor('daily_drop', {}, { PUSH_PASSIVE_ENABLED: 'false' }).interruptionLevel).toBe('active');
    expect([...passiveTypes({ PUSH_PASSIVE_TYPES: ' weekly_summary , daily_drop ' })]).toEqual(['weekly_summary', 'daily_drop']);
    expect(presentationFor('weekly_summary', {}, { PUSH_PASSIVE_TYPES: 'weekly_summary' }).interruptionLevel).toBe('passive');
    expect(passiveTypes({ PUSH_PASSIVE_TYPES: '' }).size).toBe(0);
  });

  it('time-sensitive and passive never overlap', () => {
    for (const t of TIME_SENSITIVE_TYPES) expect(DEFAULT_PASSIVE_TYPES.has(t)).toBe(false);
  });

  it('sets mutable-content for chat with a sender and for an https image only', () => {
    expect(presentationFor('chat_message', { senderName: 'Sam' }).mutableContent).toBe(true);
    expect(presentationFor('chat_mention', { friendName: 'Sam' }).mutableContent).toBe(true);
    expect(presentationFor('chat_rally', { body: 'Big day' }).mutableContent).toBe(false);
    expect(presentationFor('momentum_at_risk').mutableContent).toBe(false);
    expect(presentationFor('campaign', { imageUrl: 'https://cdn.example.com/a.png' }).mutableContent).toBe(true);
    expect(presentationFor('campaign', { imageUrl: 'http://cdn.example.com/a.png' }).mutableContent).toBe(false);
  });

  it('circle-card types are exactly the CIRCLE_* categories', () => {
    expect([...CIRCLE_CARD_TYPES].sort()).toEqual(
      ['circle_boost_threshold', 'circle_kickoff', 'circle_streak_milestone', 'circle_streak_saved', 'perfect_day'].sort()
    );
  });
});

describe('isHttpsUrl', () => {
  it('accepts https only', () => {
    expect(isHttpsUrl('https://x.supabase.co/storage/v1/object/public/avatars/u1.jpg')).toBe(true);
    expect(isHttpsUrl('http://x.co/a.jpg')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(`https://x.co/${'a'.repeat(2000)}`)).toBe(false);
  });
});

describe('initialsFor', () => {
  it('takes first + last initials, or the first two letters of one word', () => {
    expect(initialsFor('Sam Lee')).toBe('SL');
    expect(initialsFor('ana maria de souza')).toBe('AS');
    expect(initialsFor('sam')).toBe('SA');
    expect(initialsFor('  ')).toBe('?');
    expect(initialsFor(null)).toBe('?');
    expect(initialsFor('Émile Zola')).toBe('ÉZ');
  });
});

describe('buildCircleCard', () => {
  it('maps member states and marks the recipient', () => {
    const card = buildCircleCard(
      view([
        { id: 'a', name: 'Ana Ruiz', logged: true },
        { id: ME, name: 'Me Myself', logged: true },
        { id: 'b', name: 'Ben', covered: true },
        { id: 'c', name: 'Cy Twombly' },
      ]),
      ME,
      'Hold the Line'
    );
    expect(card).toMatchObject({ v: 1, circleId: 'circle-1', name: 'Hold the Line', streak: 12, checkedIn: 3, total: 4, needed: 3, closed: false });
    expect(card.members).toEqual([
      { initials: 'AR', state: 'in' },
      { initials: 'MM', state: 'in', me: true },
      { initials: 'BE', state: 'saved' },
      { initials: 'CT', state: 'out' },
    ]);
  });

  it('is closed when everyone is in (a save counts)', () => {
    const card = buildCircleCard(view([{ id: 'a', name: 'A', logged: true }, { id: ME, name: 'B', covered: true }]), ME);
    expect(card.closed).toBe(true);
    expect(card.name).toBeUndefined();
  });

  it('caps at 8 members but always keeps the recipient', () => {
    const members = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}`, logged: i < 6 }));
    members.push({ id: ME, name: 'Zed Last', logged: false });
    const card = buildCircleCard(view(members), ME);
    expect(card.members).toHaveLength(CIRCLE_CARD_MAX_MEMBERS);
    expect(card.members[CIRCLE_CARD_MAX_MEMBERS - 1]).toEqual({ initials: 'ZL', state: 'out', me: true });
    expect(card.total).toBe(13);
  });

  it('stays far inside the APNs 4 KB budget at the cap', () => {
    const members = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, name: `Very Long Name Number ${i}`, logged: true }));
    const card = buildCircleCard(view(members), 'm0', 'A circle with a really long name that keeps going on');
    expect(card.name!.length).toBeLessThanOrEqual(40);
    expect(byteLength(card)).toBeLessThan(700);
    expect(byteLength(card)).toBeLessThan(APNS_PAYLOAD_BUDGET_BYTES);
  });
});

describe('FCM wire shape (buildFCMMessage)', () => {
  const base: PushNotification = { title: 'T', body: 'B', data: { type: 'momentum_at_risk', screen: 'streaks', category: 'momentum' } };

  it('is byte-for-byte the legacy shape when no extras are given (old behaviour)', () => {
    expect(buildFCMMessage('tok', base)).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'T', body: 'B' },
        data: base.data,
        apns: { payload: { aps: { badge: undefined, sound: 'default' } } },
        android: { notification: { sound: 'default' } },
      },
    });
  });

  it('merges category, interruption level, relevance and mutable-content into aps', () => {
    const msg = buildFCMMessage('tok', {
      ...base,
      apns: { category: 'STREAK_AT_RISK', interruptionLevel: 'time-sensitive', relevanceScore: 0.9, mutableContent: false },
    });
    expect(msg.message.apns!.payload.aps).toEqual({
      badge: undefined,
      sound: 'default',
      category: 'STREAK_AT_RISK',
      'interruption-level': 'time-sensitive',
      'relevance-score': 0.9,
    });
    // Android is untouched.
    expect(msg.message.android).toEqual({ notification: { sound: 'default' } });
    expect(msg.message.data).toEqual(base.data);
  });

  it('keeps the chat shape (data-only Android, alert + thread-id iOS) and adds extras', () => {
    const msg = buildFCMMessage('tok', {
      ...base,
      chat: { threadId: 'circle-1' },
      apns: { mutableContent: true, interruptionLevel: 'active', relevanceScore: 0.6 },
    });
    expect(msg.message.notification).toBeUndefined();
    expect(msg.message.android).toEqual({ priority: 'HIGH' });
    expect(msg.message.apns!.headers).toEqual({ 'apns-priority': '10' });
    expect(msg.message.apns!.payload.aps).toEqual({
      alert: { title: 'T', body: 'B' },
      sound: 'default',
      'thread-id': 'circle-1',
      'mutable-content': 1,
      'interruption-level': 'active',
      'relevance-score': 0.6,
    });
  });

  it('puts custom keys (the circle card) beside aps, never inside FCM data', () => {
    const fc = { v: 1, circleId: 'c', members: [] };
    const msg = buildFCMMessage('tok', { ...base, apns: { custom: { fc } } });
    expect(msg.message.apns!.payload.fc).toEqual(fc);
    expect(msg.message.data).not.toHaveProperty('fc');
  });

  it('apsExtras clamps the relevance score and drops absent fields', () => {
    expect(apsExtras(undefined)).toEqual({});
    expect(apsExtras({ relevanceScore: 3 })).toEqual({ 'relevance-score': 1 });
    expect(apsExtras({ relevanceScore: -1 })).toEqual({ 'relevance-score': 0 });
    expect(apsExtras({ relevanceScore: Number.NaN })).toEqual({});
    expect(apsExtras({ mutableContent: false })).toEqual({});
  });
});

describe('NotificationOrchestrator.send → PushNotification', () => {
  beforeEach(() => {
    sendPush.mockClear();
    getStreak.mockReset();
    // Duplicate / burst guards are process-local; every test starts clean.
    NotificationOrchestrator.resetInProcessGuards();
  });

  const sent = () => sendPush.mock.calls.at(-1)![1] as unknown as PushNotification;

  it('streak at risk: category + time-sensitive, existing data contract unchanged', async () => {
    await NotificationOrchestrator.send('u1', 'momentum_at_risk', { currentMomentum: 12, shieldsRemaining: 0 });
    const n = sent();
    expect(n.data).toEqual({ type: 'momentum_at_risk', category: 'momentum', screen: 'streaks' });
    expect(n.apns).toMatchObject({ category: 'STREAK_AT_RISK', interruptionLevel: 'time-sensitive', mutableContent: false });
    expect(n.apns?.custom).toBeUndefined();
  });

  it('chat message: sender id + https avatar for the Communication Notification', async () => {
    await NotificationOrchestrator.send('u1', 'chat_message', {
      circleId: 'circle-1',
      circleName: 'Hold the Line',
      friendName: 'Sam Lee',
      senderName: 'Sam Lee',
      senderId: 'sender-1',
      senderAvatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/s.jpg',
      preview: 'Leg day done',
      messageId: 'm1',
    });
    const n = sent();
    expect(n.chat).toEqual({ threadId: 'circle-1' });
    expect(n.data).toMatchObject({
      type: 'chat_message',
      screen: 'circle_chat',
      circleId: 'circle-1',
      senderName: 'Sam Lee',
      senderId: 'sender-1',
      senderAvatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/s.jpg',
      preview: 'Leg day done',
    });
    expect(n.apns).toMatchObject({ mutableContent: true, interruptionLevel: 'active' });
    // FCM data must stay all-strings.
    for (const v of Object.values(n.data!)) expect(typeof v).toBe('string');
  });

  it('chat: drops a non-https avatar; rallies carry no sender', async () => {
    await NotificationOrchestrator.send('u1', 'chat_message', {
      circleId: 'c', senderName: 'Sam', senderId: 's', senderAvatarUrl: 'http://insecure/a.jpg', preview: 'hi',
    });
    expect(sent().data).not.toHaveProperty('senderAvatarUrl');
    await NotificationOrchestrator.send('u1', 'chat_rally', { circleId: 'c', body: 'Big', senderId: 's' });
    expect(sent().data).not.toHaveProperty('senderId');
    expect(sent().apns?.mutableContent).toBe(false);
  });

  it('circle types carry the recipient-specific circle card', async () => {
    getStreak.mockResolvedValue(view([{ id: 'a', name: 'Ana', logged: true }, { id: 'u1', name: 'Me Too', logged: true }], 7));
    await NotificationOrchestrator.send('u1', 'circle_streak_milestone', { circleId: 'circle-1', circleName: 'Crew', streakDays: 7 });
    expect(getStreak).toHaveBeenCalledWith('circle-1', 'u1');
    const n = sent();
    expect(n.apns?.category).toBe('CIRCLE_CLOSED');
    expect(n.apns?.custom?.fc).toMatchObject({
      circleId: 'circle-1',
      name: 'Crew',
      streak: 7,
      closed: true,
      members: [{ initials: 'AN', state: 'in' }, { initials: 'MT', state: 'in', me: true }],
    });
  });

  it('a failing circle lookup never blocks the send', async () => {
    getStreak.mockRejectedValue(new Error('Forbidden'));
    const res = await NotificationOrchestrator.send('u1', 'circle_streak_saved', { circleId: 'circle-1', friendName: 'Ana' });
    expect(res.sent).toBe(true);
    expect(sent().apns?.category).toBe('CIRCLE_UPDATE');
    expect(sent().apns?.custom).toBeUndefined();
  });

  it('no circle id → no lookup, list-screen fallback unchanged', async () => {
    await NotificationOrchestrator.send('u1', 'perfect_day', { circleName: 'Crew' });
    expect(getStreak).not.toHaveBeenCalled();
    expect(sent().data?.screen).toBe('circles');
  });

  it('forwards an https image_url and marks it mutable', async () => {
    await NotificationOrchestrator.send('u1', 'campaign', { title: 'Hold the Line', body: 'Day 9', imageUrl: 'https://cdn.example.com/htl.png' });
    expect(sent().data?.image_url).toBe('https://cdn.example.com/htl.png');
    expect(sent().apns?.mutableContent).toBe(true);
  });

  it('weekly summary stays audible (active)', async () => {
    await NotificationOrchestrator.send('u1', 'weekly_summary', { workoutsThisWeek: 3, streakDays: 4 });
    expect(sent().apns).toMatchObject({ interruptionLevel: 'active' });
  });
});
