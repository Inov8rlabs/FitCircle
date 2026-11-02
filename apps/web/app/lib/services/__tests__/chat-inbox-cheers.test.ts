import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// GET /api/mobile/chats (ChatInboxService) + leaderboard cheers
// (CircleCheerService) — docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §1 / §3.
// Real services over an in-memory DB; pushes and the steps board are stubbed.
// ---------------------------------------------------------------------------

import { ChatFakeDb } from './chat-fake-db';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => holder.db.client() }));

const notify = vi.hoisted(() => ({
  notifyCheer: vi.fn(async () => {}),
  notifyNewMessage: vi.fn(async () => {}),
}));
vi.mock('../chat-notification-service', () => ({ ChatNotificationService: notify }));

const steps = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('../circle-steps-leaderboard-service', () => ({ CircleStepsLeaderboardService: steps }));

import { CHEER_DAILY_LIMIT } from '../../types/circle-chat';
import {
  ChatInboxService,
  isUnreadFor,
  pickDefaultCircle,
  previewOf,
} from '../chat-inbox-service';
import { CheerError, CircleCheerService, cheerBody, cheerLimitVerdict, snapshotFromRow } from '../circle-cheer-service';
import { CircleChatService } from '../circle-chat-service';

const ME = 'me';
const RAV = 'raveesh';
const GRACE = 'grace';
const BLOCKED = 'blocked';
const STEPS = 'c-steps';
const LIFT = 'c-lift';
const QUIET = 'c-quiet';

const NOW = Date.parse('2026-11-02T18:00:00Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

let db: ChatFakeDb;
let seq = 0;
const msg = (circle: string, sender: string | null, minAgo: number, extra: Record<string, unknown> = {}) => ({
  id: `m${++seq}`,
  fitcircle_id: circle,
  sender_id: sender,
  kind: sender ? 'user_text' : 'system_event',
  body: `hello ${seq}`,
  photo_url: null,
  client_id: null,
  system_event_type: sender ? null : 'workout_done',
  system_event_ref: null,
  system_payload: sender ? null : { actors: [{ id: GRACE }] },
  priority: 'p1',
  edited_at: null,
  deleted_at: null,
  created_at: at(minAgo),
  updated_at: at(minAgo),
  ...extra,
});

beforeEach(() => {
  seq = 0;
  db = new ChatFakeDb();
  holder.db = db;
  db.tables = {
    fitcircle_members: [
      ...[ME, RAV, GRACE, BLOCKED].map((user_id) => ({ fitcircle_id: STEPS, user_id, status: 'active', joined_at: at(10_000) })),
      ...[ME, GRACE].map((user_id) => ({ fitcircle_id: LIFT, user_id, status: 'active', joined_at: at(20_000) })),
      { fitcircle_id: QUIET, user_id: ME, status: 'active', joined_at: at(30_000) },
      { fitcircle_id: 'c-left', user_id: ME, status: 'dropped', joined_at: at(30_000) },
    ],
    fitcircles: [
      { id: STEPS, name: 'Nov steps challenge', type: 'step_count', cover_image_url: 'https://x/c.png' },
      { id: LIFT, name: 'Lifters', type: 'custom', cover_image_url: 'http://insecure/c.png' },
      { id: QUIET, name: 'Quiet circle', type: 'custom', cover_image_url: null },
      { id: 'c-left', name: 'Left', type: 'custom', cover_image_url: null },
    ],
    circle_chat_state: [
      { fitcircle_id: STEPS, user_id: ME, last_read_at: at(60), muted: false },
      { fitcircle_id: LIFT, user_id: ME, last_read_at: null, muted: true },
    ],
    circle_member_blocks: [{ blocker_id: ME, blocked_id: BLOCKED }],
    profiles: [
      { id: ME, display_name: 'Ani', avatar_url: null },
      { id: RAV, display_name: 'Raveesh', avatar_url: 'https://x/r.png' },
      { id: GRACE, display_name: 'Grace', avatar_url: null },
      { id: BLOCKED, display_name: 'Blocked', avatar_url: null },
    ],
    circle_messages: [
      msg(STEPS, RAV, 120), // before my cursor: read
      msg(STEPS, RAV, 30, { body: "Let's go!" }), // unread
      msg(STEPS, ME, 20), // mine: never unread
      msg(STEPS, null, 15, { body: 'Grace finished a run' }), // system post: unread
      msg(STEPS, BLOCKED, 10), // blocked sender: hidden
      msg(STEPS, RAV, 5, { deleted_at: at(4) }), // deleted: hidden
      msg(LIFT, GRACE, 3, { body: 'Bench day' }), // muted circle, never read: unread
      msg(LIFT, GRACE, 2, { kind: 'user_photo', body: null, photo_url: 'p' }),
      msg(QUIET, GRACE, 60 * 24 * 40, { body: 'ancient' }), // silent for 40 days
    ],
  };
  notify.notifyCheer.mockClear();
  notify.notifyNewMessage.mockClear();
  steps.build.mockReset();
});

describe('pure inbox rules', () => {
  it('unread = after the cursor, not mine, not deleted, not from a blocked pair', () => {
    const hidden = new Set([BLOCKED]);
    const row = { id: 'x', fitcircle_id: STEPS, sender_id: RAV, created_at: at(5), deleted_at: null };
    expect(isUnreadFor(row, ME, at(10), hidden)).toBe(true);
    expect(isUnreadFor(row, ME, at(1), hidden)).toBe(false);
    expect(isUnreadFor(row, ME, null, hidden)).toBe(true);
    expect(isUnreadFor({ ...row, sender_id: ME }, ME, null, hidden)).toBe(false);
    expect(isUnreadFor({ ...row, sender_id: BLOCKED }, ME, null, hidden)).toBe(false);
    expect(isUnreadFor({ ...row, deleted_at: at(1) }, ME, null, hidden)).toBe(false);
    expect(isUnreadFor({ ...row, sender_id: null }, ME, null, hidden)).toBe(true);
  });

  it('previews photos as "Photo", collapse whitespace and cap at 80 chars', () => {
    expect(previewOf({ kind: 'user_photo', body: null })).toBe('Photo');
    expect(previewOf({ kind: 'user_text', body: '  a\n\nb  ' })).toBe('a b');
    const long = previewOf({ kind: 'user_text', body: 'x'.repeat(200) });
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('default circle: newest unread non-muted, then muted unread, then most recent', () => {
    const chats = [
      { circle_id: 'a', muted: false, unread_count: 0 },
      { circle_id: 'b', muted: false, unread_count: 2 },
      { circle_id: 'c', muted: true, unread_count: 5 },
      { circle_id: 'd', muted: false, unread_count: 1 },
    ];
    const newest = new Map([['b', at(10)], ['c', at(1)], ['d', at(5)]]);
    expect(pickDefaultCircle(chats, newest)).toBe('d');
    expect(pickDefaultCircle(chats.map((c) => ({ ...c, unread_count: c.muted ? 5 : 0 })), newest)).toBe('c');
    expect(pickDefaultCircle(chats.map((c) => ({ ...c, unread_count: 0 })), newest)).toBe('a');
    expect(pickDefaultCircle([], newest)).toBeNull();
  });
});

describe('ChatInboxService.listChats', () => {
  it('counts unread per circle, keeps muted out of the total, and picks the chat to open', async () => {
    const inbox = await ChatInboxService.listChats(ME, NOW);
    expect(inbox.chats.map((c) => c.circle_id)).toEqual([LIFT, STEPS, QUIET]); // last activity desc; dropped circle absent
    const stepsChat = inbox.chats.find((c) => c.circle_id === STEPS)!;
    expect(stepsChat.unread_count).toBe(2); // Raveesh's "Let's go!" + the system post
    expect(stepsChat.muted).toBe(false);
    expect(stepsChat.circle_avatar_url).toBe('https://x/c.png');
    expect(stepsChat.circle_type).toBe('step_count');
    expect(stepsChat.last_read_at).toBe(at(60));
    // Newest visible message: the system post (15 min ago; the blocked and deleted ones are skipped).
    expect(stepsChat.last_message).toMatchObject({
      sender_id: null,
      sender_display_name: 'Grace',
      preview: 'Grace finished a run',
      kind: 'system_event',
      is_cheer: false,
    });
    const lift = inbox.chats.find((c) => c.circle_id === LIFT)!;
    expect(lift).toMatchObject({ unread_count: 2, muted: true, circle_avatar_url: null });
    expect(lift.last_message).toMatchObject({ preview: 'Photo', sender_display_name: 'Grace', kind: 'user_photo' });
    expect(inbox.total_unread).toBe(2);
    expect(inbox.muted_unread).toBe(2);
    expect(inbox.default_circle_id).toBe(STEPS);
  });

  it('finds the last message of a circle silent for longer than the window (one fallback read)', async () => {
    const inbox = await ChatInboxService.listChats(ME, NOW);
    const quiet = inbox.chats.find((c) => c.circle_id === QUIET)!;
    expect(quiet.unread_count).toBe(0); // older than the 30-day look-back
    expect(quiet.last_message?.preview).toBe('ancient');
  });

  it('uses a fixed number of queries regardless of circle count (no N+1)', async () => {
    for (let i = 0; i < 12; i++) {
      db.tables.fitcircle_members.push({ fitcircle_id: `extra-${i}`, user_id: ME, status: 'active', joined_at: at(5) });
      db.tables.fitcircles.push({ id: `extra-${i}`, name: `Extra ${i}`, type: 'custom', cover_image_url: null });
      db.tables.circle_messages.push(msg(`extra-${i}`, GRACE, 1));
    }
    db.log = [];
    await ChatInboxService.listChats(ME, NOW);
    expect(db.log.length).toBeLessThanOrEqual(8);
  });

  it('flags cheers and hides a blocked sender from the preview', async () => {
    db.tables.circle_messages.push(
      msg(STEPS, RAV, 1, { body: '👏 @Ani Keep going!', system_payload: { cheer: { to_user_id: ME } } }),
      msg(STEPS, BLOCKED, 0.5)
    );
    const inbox = await ChatInboxService.listChats(ME, NOW);
    const s = inbox.chats.find((c) => c.circle_id === STEPS)!;
    expect(s.last_message).toMatchObject({ is_cheer: true, sender_display_name: 'Raveesh', preview: '👏 @Ani Keep going!' });
    expect(s.unread_count).toBe(3);
  });

  it('no circles → empty inbox with no target', async () => {
    expect(await ChatInboxService.listChats('nobody', NOW)).toEqual({
      chats: [],
      total_unread: 0,
      muted_unread: 0,
      default_circle_id: null,
    });
  });
});

describe('ChatInboxService.unreadTotals (push badge)', () => {
  it('computes every recipient in one batch, excluding muted circles and blocked senders', async () => {
    db.tables.circle_chat_state.push({ fitcircle_id: STEPS, user_id: RAV, last_read_at: at(25), muted: false });
    db.log = [];
    const totals = await ChatInboxService.unreadTotals([ME, RAV, GRACE], NOW);
    expect(totals.get(ME)).toBe(2); // same as /chats total_unread
    // After Raveesh's cursor: mine (20), the system post (15), Blocked's (10) — only I blocked them.
    expect(totals.get(RAV)).toBe(3);
    expect(totals.get(GRACE)).toBeGreaterThan(0);
    expect(db.log.length).toBeLessThanOrEqual(4);
  });

  it('never throws (badge simply omitted)', async () => {
    holder.db = { client: () => { throw new Error('db down'); } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await ChatInboxService.unreadTotals([ME])).size).toBe(0);
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Cheers
// ---------------------------------------------------------------------------

const board = (row: Record<string, unknown> | null) => ({
  ok: true,
  board: {
    today: '2026-11-02',
    members: row ? [{ user_id: RAV, steps_visible: true, today_steps: 2732, daily_goal_steps: 8000, goal_pct_today: 34, days: [{ date: '2026-11-01' }, { date: '2026-11-02' }], ...row }] : [],
  },
});

describe('pure cheer rules', () => {
  it('body degrades to readable text for shipped clients', () => {
    expect(cheerBody('👏', 'Raveesh', 'Keep going!')).toBe('👏 @Raveesh Keep going!');
    expect(cheerBody('🎉', 'Raveesh', null)).toBe('🎉 @Raveesh');
    expect(cheerBody('👏', '  ', null)).toBe('👏 @friend');
  });

  it('rate limit: 1 per pair per 60 s, 20 per circle per rolling day', () => {
    const now = NOW;
    expect(cheerLimitVerdict([], RAV, now)).toEqual({ ok: true });
    expect(cheerLimitVerdict([{ to_user_id: RAV, created_at: new Date(now - 30_000).toISOString() }], RAV, now)).toEqual({
      ok: false,
      reason: 'pair_cooldown',
      retryAfterSeconds: 30,
    });
    expect(cheerLimitVerdict([{ to_user_id: RAV, created_at: new Date(now - 61_000).toISOString() }], RAV, now)).toEqual({ ok: true });
    expect(cheerLimitVerdict([{ to_user_id: GRACE, created_at: new Date(now - 1_000).toISOString() }], RAV, now)).toEqual({ ok: true });
    const many = Array.from({ length: CHEER_DAILY_LIMIT }, (_, i) => ({ to_user_id: `u${i}`, created_at: new Date(now - (i + 2) * 3_600_000 / 2).toISOString() }));
    const verdict = cheerLimitVerdict(many, RAV, now);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('daily_limit');
    // Rows older than 24 h don't count.
    expect(cheerLimitVerdict(many.map((r) => ({ ...r, created_at: new Date(now - 25 * 3_600_000).toISOString() })), RAV, now)).toEqual({ ok: true });
  });

  it('stat snapshot: the recipient row, never for a private member', () => {
    expect(snapshotFromRow(board({})!.board.members[0] as any, '2026-11-02')).toEqual({
      metric: 'steps', date: '2026-11-02', today_steps: 2732, daily_goal_steps: 8000, goal_pct_today: 34,
    });
    expect(snapshotFromRow({ ...(board({})!.board.members[0] as any), steps_visible: false }, 'd')).toBeNull();
    expect(snapshotFromRow({ ...(board({})!.board.members[0] as any), today_steps: null }, 'd')).toBeNull();
    expect(snapshotFromRow(undefined, 'd')).toBeNull();
  });
});

describe('CircleCheerService.sendCheer', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('posts a user_text cheer with structured data, the server snapshot, and pushes', async () => {
    steps.build.mockResolvedValue(board({}));
    const dto = await CircleCheerService.sendCheer(STEPS, ME, {
      toUserId: RAV,
      reaction: '💪',
      message: '  Keep going!  ',
      source: 'leaderboard_long_press',
      clientTimezone: 'America/Toronto',
    });
    expect(dto).toMatchObject({
      kind: 'user_text',
      body: '💪 @Raveesh Keep going!',
      sender: { id: ME, name: 'Ani' },
      cheer: {
        to_user_id: RAV,
        to_display_name: 'Raveesh',
        reaction: 'muscle', // canonicalised like reactions v2
        emoji: '💪',
        message: 'Keep going!',
        source: 'leaderboard_long_press',
        stat_snapshot: { metric: 'steps', today_steps: 2732, goal_pct_today: 34, daily_goal_steps: 8000, date: '2026-11-02' },
      },
    });
    const stored = db.tables.circle_messages.at(-1)!;
    expect(stored).toMatchObject({ kind: 'user_text', sender_id: ME, fitcircle_id: STEPS });
    expect(stored.system_payload.cheer.to_user_id).toBe(RAV);
    expect(steps.build).toHaveBeenCalledWith(STEPS, ME, 'America/Toronto');

    await flush();
    await flush();
    expect(notify.notifyCheer).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: RAV, senderId: ME, senderName: 'Ani', emoji: '💪', message: 'Keep going!', circleName: 'Nov steps challenge' })
    );
    expect(notify.notifyNewMessage).toHaveBeenCalledWith(STEPS, ME, 'Ani', 'Nov steps challenge', dto.id, dto.body, { excludeUserIds: [RAV] });
  });

  it('defaults to 👏 with no message; snapshot is null when the board fails', async () => {
    steps.build.mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dto = await CircleCheerService.sendCheer(STEPS, ME, { toUserId: RAV });
    warn.mockRestore();
    expect(dto.body).toBe('👏 @Raveesh');
    expect(dto.cheer).toMatchObject({ reaction: 'clap', emoji: '👏', message: null, stat_snapshot: null, source: 'leaderboard_long_press' });
  });

  const refuse = async (input: Parameters<typeof CircleCheerService.sendCheer>[2], sender = ME, circle = STEPS) => {
    steps.build.mockResolvedValue(board({}));
    try {
      await CircleCheerService.sendCheer(circle, sender, input);
    } catch (e) {
      return e as CheerError;
    }
    throw new Error('expected a refusal');
  };

  it('refuses self, non-members, blocked pairs and bad input', async () => {
    expect((await refuse({ toUserId: ME })).code).toBe('CANNOT_CHEER_SELF');
    expect((await refuse({ toUserId: RAV }, 'outsider')).code).toBe('FORBIDDEN');
    expect((await refuse({ toUserId: 'outsider' })).code).toBe('RECIPIENT_NOT_FOUND');
    expect((await refuse({ toUserId: BLOCKED })).code).toBe('BLOCKED');
    // Blocked the other way round too.
    db.tables.circle_member_blocks.push({ blocker_id: GRACE, blocked_id: ME });
    expect((await refuse({ toUserId: GRACE })).code).toBe('BLOCKED');
    const bad = await refuse({ toUserId: RAV, reaction: 'not an emoji' });
    expect(bad.code).toBe('VALIDATION_ERROR');
    expect(bad.details).toHaveProperty('reaction');
    expect((await refuse({ toUserId: RAV, message: 'x'.repeat(281) })).code).toBe('VALIDATION_ERROR');
    expect(db.tables.circle_messages.some((m) => m.system_payload?.cheer)).toBe(false);
  });

  it('rate limits from stored cheers (durable), with a friendly message', async () => {
    steps.build.mockResolvedValue(board({}));
    await CircleCheerService.sendCheer(STEPS, ME, { toUserId: RAV });
    const second = await refuse({ toUserId: RAV });
    expect(second.code).toBe('RATE_LIMITED');
    expect(second.message).toBe('You just cheered Raveesh — give it a minute');
    expect(second.details).toMatchObject({ reason: 'pair_cooldown' });
    expect(Number(second.details.retry_after_seconds)).toBeGreaterThan(0);
    // A different member is fine.
    await expect(CircleCheerService.sendCheer(STEPS, ME, { toUserId: GRACE })).resolves.toBeTruthy();
  });

  it('is retry-safe on client_id', async () => {
    steps.build.mockResolvedValue(board({}));
    const clientId = '11111111-1111-4111-8111-111111111111';
    const first = await CircleCheerService.sendCheer(STEPS, ME, { toUserId: RAV, clientId });
    const again = await CircleCheerService.sendCheer(STEPS, ME, { toUserId: RAV, clientId });
    expect(again.id).toBe(first.id);
    expect(db.tables.circle_messages.filter((m) => m.client_id === clientId)).toHaveLength(1);
  });
});

describe('cheer messages in the chat DTO', () => {
  it('cheerOf normalises stored data and drops it on tombstones / other kinds', () => {
    const row = { kind: 'user_text' as const, deleted_at: null, system_payload: { cheer: { to_user_id: RAV, reaction: 'flame' } } };
    expect(CircleChatService.cheerOf(row)).toEqual({
      to_user_id: RAV, to_display_name: '', reaction: 'flame', emoji: '🔥', message: null, source: 'leaderboard_long_press', stat_snapshot: null,
    });
    expect(CircleChatService.cheerOf({ ...row, deleted_at: at(1) })).toBeNull();
    expect(CircleChatService.cheerOf({ ...row, kind: 'system_event' })).toBeNull();
    expect(CircleChatService.cheerOf({ ...row, system_payload: null })).toBeNull();
    expect(CircleChatService.cheerOf({ ...row, system_payload: { cheer: { reaction: 'clap' } } })).toBeNull();
  });

  it('list responses carry cheer (null on ordinary messages) and keep system posts when the viewer blocked someone', async () => {
    steps.build.mockResolvedValue(board({}));
    await CircleCheerService.sendCheer(STEPS, ME, { toUserId: RAV });
    const { messages } = await CircleChatService.listMessages(STEPS, ME, {});
    const cheer = messages.find((m) => m.cheer);
    expect(cheer?.cheer?.to_user_id).toBe(RAV);
    expect(messages.filter((m) => !m.cheer).every((m) => m.cheer === null)).toBe(true);
    // Viewer has a block: system posts (sender_id null) must still be listed.
    expect(messages.some((m) => m.kind === 'system_event')).toBe(true);
    expect(messages.some((m) => m.sender?.id === BLOCKED)).toBe(false);
  });

  it('cheers cannot be edited', async () => {
    steps.build.mockResolvedValue(board({}));
    const dto = await CircleCheerService.sendCheer(STEPS, ME, { toUserId: RAV });
    await expect(CircleChatService.editMessage(ME, dto.id, 'changed')).rejects.toThrow('InvalidMessageKind');
  });
});
