import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase fake: from().select/eq/neq/in/maybeSingle,
// delete().eq/neq, upsert(row, { onConflict, ignoreDuplicates }).
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => new FakeQuery(table),
  }),
}));

const notify = vi.hoisted(() => ({ notifyReaction: vi.fn(async () => {}) }));
vi.mock('../chat-notification-service', async (orig) => {
  const actual = (await orig()) as any;
  actual.ChatNotificationService.notifyReaction = notify.notifyReaction;
  return actual;
});

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: 'select' | 'delete' = 'select';
  private single = false;
  constructor(private table: string) {}
  private rows() {
    return (db.tables[this.table] ??= []);
  }
  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  /** Only the `a.eq.x,b.eq.y` shape ChatSafetyService.getBlockedIdsFor uses. */
  or(expr: string) {
    const clauses = expr.split(',').map((c) => c.split('.eq.'));
    this.filters.push((r) => clauses.some(([col, v]) => r[col] === v));
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  delete() {
    this.mode = 'delete';
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  upsert(row: Row, opts: { onConflict: string }) {
    const keys = opts.onConflict.split(',');
    const exists = this.rows().some((r) => keys.every((k) => r[k] === row[k]));
    if (!exists) this.rows().push({ created_at: new Date().toISOString(), ...row });
    return Promise.resolve({ data: null, error: null });
  }
  then<T1, T2>(ok?: (v: { data: any; error: null }) => T1, ko?: (e: unknown) => T2) {
    const match = (r: Row) => this.filters.every((f) => f(r));
    let data: any;
    if (this.mode === 'delete') {
      db.tables[this.table] = this.rows().filter((r) => !match(r));
      data = null;
    } else {
      const hits = this.rows().filter(match).map((r) => ({ ...r }));
      data = this.single ? hits[0] ?? null : hits;
    }
    return Promise.resolve({ data, error: null }).then(ok, ko);
  }
}

import { canonicalizeChatReaction, isSingleEmoji } from '../../chat/reactions';
import { REACTION_EMOJI } from '../../types/circle-chat';
import { CircleChatService, REACTION_PUSH_QUIET_MS, resetReactionPushMemory } from '../circle-chat-service';
import { NOTIFICATION_TEMPLATES } from '../notification-orchestrator';

const CIRCLE = 'circle-1';
const MSG = 'msg-1';
const AUTHOR = 'author';
const ME = 'me';
const OTHER = 'other';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  db.tables = {
    fitcircle_members: [AUTHOR, ME, OTHER].map((user_id) => ({ fitcircle_id: CIRCLE, user_id, status: 'active' })),
    circle_messages: [{ id: MSG, fitcircle_id: CIRCLE, sender_id: AUTHOR, kind: 'user_text', body: 'Leg day done', deleted_at: null }],
    circle_message_reactions: [],
    profiles: [
      { id: AUTHOR, display_name: 'Author', avatar_url: null },
      { id: ME, display_name: 'Ani', avatar_url: 'https://x/me.png' },
      { id: OTHER, display_name: 'Grace', avatar_url: null },
    ],
    fitcircles: [{ id: CIRCLE, name: 'Lifters' }],
    circle_member_blocks: [],
  };
  notify.notifyReaction.mockClear();
  resetReactionPushMemory();
});
afterEach(() => vi.useRealTimers());

const flush = () => new Promise((r) => setTimeout(r, 0));
const mineRows = () => db.tables.circle_message_reactions.filter((r) => r.user_id === ME);

describe('canonicalizeChatReaction', () => {
  it('keeps named kinds, including the new muscle', () => {
    expect(canonicalizeChatReaction('clap')).toBe('clap');
    expect(canonicalizeChatReaction('muscle')).toBe('muscle');
    expect(canonicalizeChatReaction(' heart ')).toBe('heart');
  });

  it('maps every named kind’s emoji to the kind (with or without VS16)', () => {
    for (const [kind, emoji] of Object.entries(REACTION_EMOJI)) {
      expect(canonicalizeChatReaction(emoji)).toBe(kind);
    }
    expect(canonicalizeChatReaction('❤')).toBe('heart');
  });

  it('accepts exactly one custom emoji, keeping skin tones / ZWJ sequences / flags as custom', () => {
    for (const e of ['🥳', '👏🏽', '🏋️‍♀️', '🇮🇳', '1️⃣', '🫡']) expect(canonicalizeChatReaction(e)).toBe(e);
  });

  it('rejects text, multiple emoji, oversize sequences and non-strings', () => {
    for (const bad of ['', 'party', 'a', '👏👏', '🔥 hot', ':clap:', '👨‍👩‍👧‍👦', '<b>', 42, null, undefined]) {
      expect(canonicalizeChatReaction(bad)).toBeNull();
    }
    expect(isSingleEmoji('👨‍👩‍👧‍👦')).toBe(false); // 25 bytes > 16
  });
});

describe('CircleChatService.setReaction', () => {
  it('stores an emoji of a named kind as the kind and returns summaries with emoji', async () => {
    const out = await CircleChatService.setReaction(MSG, ME, '👏');
    expect(mineRows().map((r) => r.reaction)).toEqual(['clap']);
    expect(out).toEqual([{ reaction: 'clap', emoji: '👏', count: 1, reactedByMe: true }]);
  });

  it('replaces the viewer’s previous reaction (one per person), collapsing legacy multi-rows', async () => {
    db.tables.circle_message_reactions.push(
      { message_id: MSG, user_id: ME, reaction: 'heart', created_at: ago(120_000) },
      { message_id: MSG, user_id: ME, reaction: 'flame', created_at: ago(100_000) },
      { message_id: MSG, user_id: OTHER, reaction: 'heart', created_at: ago(90_000) }
    );
    const out = await CircleChatService.setReaction(MSG, ME, '🥳');
    expect(mineRows().map((r) => r.reaction)).toEqual(['🥳']);
    expect(out).toEqual([
      { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false },
      { reaction: '🥳', emoji: '🥳', count: 1, reactedByMe: true },
    ]);
  });

  it('legacy POST (addReaction) has the same replace semantics', async () => {
    await CircleChatService.addReaction(MSG, ME, 'heart');
    await CircleChatService.addReaction(MSG, ME, 'thumbs_up');
    expect(mineRows().map((r) => r.reaction)).toEqual(['thumbs_up']);
  });

  it('rejects an invalid reaction before touching the DB', async () => {
    await expect(CircleChatService.setReaction(MSG, ME, 'party')).rejects.toThrow('InvalidReaction');
    expect(db.tables.circle_message_reactions).toHaveLength(0);
  });

  it('enforces membership and tombstones', async () => {
    await expect(CircleChatService.setReaction(MSG, 'stranger', 'clap')).rejects.toThrow('Forbidden');
    await expect(CircleChatService.setReaction('nope', ME, 'clap')).rejects.toThrow('NotFound');
    db.tables.circle_messages[0].deleted_at = ago(1);
    await expect(CircleChatService.setReaction(MSG, ME, 'clap')).rejects.toThrow('MessageDeleted');
  });

  it('pushes the author for a new reaction, with cheer copy for clap/same/muscle', async () => {
    await CircleChatService.setReaction(MSG, ME, 'muscle');
    await flush();
    expect(notify.notifyReaction).toHaveBeenCalledTimes(1);
    expect(notify.notifyReaction).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: AUTHOR, reactorName: 'Ani', emoji: '💪', cheer: true, subject: 'message' })
    );
  });

  it('does not push for a re-tap, a removal, or a replacement within 60 s', async () => {
    await CircleChatService.setReaction(MSG, ME, 'clap');
    await CircleChatService.setReaction(MSG, ME, 'clap'); // re-tap / retry
    await CircleChatService.setReaction(MSG, ME, 'heart'); // fiddling
    await CircleChatService.clearReaction(MSG, ME);
    await flush();
    expect(notify.notifyReaction).toHaveBeenCalledTimes(1);
  });

  it('does push a replacement made after the quiet window', async () => {
    db.tables.circle_message_reactions.push({
      message_id: MSG,
      user_id: ME,
      reaction: 'heart',
      created_at: ago(REACTION_PUSH_QUIET_MS + 1_000),
    });
    await CircleChatService.setReaction(MSG, ME, '🥳');
    await flush();
    expect(notify.notifyReaction).toHaveBeenCalledWith(expect.objectContaining({ emoji: '🥳', cheer: false }));
  });
});

describe('push no-spam memory (remove then re-add)', () => {
  it('does not push a different emoji re-added within 60 s of the last push', async () => {
    await CircleChatService.setReaction(MSG, ME, 'clap');
    await CircleChatService.clearReaction(MSG, ME);
    await CircleChatService.setReaction(MSG, ME, '🥳');
    await flush();
    expect(notify.notifyReaction).toHaveBeenCalledTimes(1);
  });

  it('pushes again once the 60 s window has passed', async () => {
    const t0 = Date.parse('2026-11-02T12:00:00Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await CircleChatService.setReaction(MSG, ME, 'clap');
    await CircleChatService.clearReaction(MSG, ME);
    now.mockReturnValue(t0 + REACTION_PUSH_QUIET_MS + 1);
    await CircleChatService.setReaction(MSG, ME, '🥳');
    await flush();
    expect(notify.notifyReaction).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('is per message + reactor: another member reacting still pushes', async () => {
    await CircleChatService.setReaction(MSG, ME, 'clap');
    await CircleChatService.setReaction(MSG, OTHER, 'clap');
    await flush();
    expect(notify.notifyReaction).toHaveBeenCalledTimes(2);
  });
});

describe('blocked members', () => {
  beforeEach(() => {
    db.tables.circle_message_reactions.push(
      { message_id: MSG, user_id: ME, reaction: 'clap', created_at: ago(5_000) },
      { message_id: MSG, user_id: OTHER, reaction: 'clap', created_at: ago(4_000) },
      { message_id: MSG, user_id: AUTHOR, reaction: 'heart', created_at: ago(3_000) }
    );
  });

  it('a member I blocked is left out of my counts and my reactors list', async () => {
    db.tables.circle_member_blocks.push({ blocker_id: ME, blocked_id: OTHER });
    expect(await CircleChatService.clearReaction(MSG, ME)).toEqual([
      { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false },
    ]);
    expect((await CircleChatService.listReactors(MSG, ME)).map((r) => r.user_id)).toEqual([AUTHOR]);
  });

  it('a member who blocked me is hidden too; my own reaction always shows', async () => {
    db.tables.circle_member_blocks.push({ blocker_id: OTHER, blocked_id: ME });
    expect(await CircleChatService.setReaction(MSG, ME, 'clap')).toEqual([
      { reaction: 'clap', emoji: '👏', count: 1, reactedByMe: true },
      { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false },
    ]);
    expect((await CircleChatService.listReactors(MSG, ME)).map((r) => r.user_id)).toEqual([ME, AUTHOR]);
  });

  it('other viewers still see everyone', async () => {
    db.tables.circle_member_blocks.push({ blocker_id: ME, blocked_id: OTHER });
    const seenByAuthor = await CircleChatService.listReactors(MSG, AUTHOR);
    expect(seenByAuthor.map((r) => r.user_id).sort()).toEqual([AUTHOR, ME, OTHER].sort());
  });

  it('a blocked pair never gets reaction pushes from each other', async () => {
    db.tables.circle_message_reactions = [];
    db.tables.circle_member_blocks.push({ blocker_id: AUTHOR, blocked_id: ME });
    await CircleChatService.setReaction(MSG, ME, 'clap');
    await flush();
    expect(notify.notifyReaction).not.toHaveBeenCalled();
  });
});

describe('CircleChatService.shouldNotifyReaction', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const at = (ms: number) => new Date(now - ms).toISOString();
  it('is pure and follows the 60 s rule', () => {
    expect(CircleChatService.shouldNotifyReaction([], 'clap', now)).toBe(true);
    expect(CircleChatService.shouldNotifyReaction([{ reaction: 'clap', created_at: at(1e6) }], 'clap', now)).toBe(false);
    expect(CircleChatService.shouldNotifyReaction([{ reaction: 'heart', created_at: at(59_000) }], 'clap', now)).toBe(false);
    expect(CircleChatService.shouldNotifyReaction([{ reaction: 'heart', created_at: at(61_000) }], 'clap', now)).toBe(true);
  });
});

describe('clear / remove', () => {
  beforeEach(() => {
    db.tables.circle_message_reactions.push(
      { message_id: MSG, user_id: ME, reaction: 'clap', created_at: ago(5_000) },
      { message_id: MSG, user_id: OTHER, reaction: 'clap', created_at: ago(4_000) }
    );
  });

  it('DELETE (no suffix) clears whatever the viewer reacted with', async () => {
    const out = await CircleChatService.clearReaction(MSG, ME);
    expect(mineRows()).toHaveLength(0);
    expect(out).toEqual([{ reaction: 'clap', emoji: '👏', count: 1, reactedByMe: false }]);
  });

  it('legacy remove of a specific kind accepts the kind or its emoji, no-op for others', async () => {
    await CircleChatService.removeReaction(MSG, ME, 'heart');
    expect(mineRows()).toHaveLength(1);
    await CircleChatService.removeReaction(MSG, ME, '👏');
    expect(mineRows()).toHaveLength(0);
  });
});

describe('summaries + reactors', () => {
  it('counts only the newest row per user and orders by count', () => {
    const rows = [
      { message_id: MSG, user_id: ME, reaction: 'heart', created_at: ago(30_000) },
      { message_id: MSG, user_id: ME, reaction: 'clap', created_at: ago(10_000) },
      { message_id: MSG, user_id: OTHER, reaction: 'clap', created_at: ago(20_000) },
      { message_id: MSG, user_id: AUTHOR, reaction: '🥳', created_at: ago(25_000) },
    ];
    expect(CircleChatService.summarizeReactions(rows, [MSG, 'empty'], ME)).toEqual(
      new Map([
        [
          MSG,
          [
            { reaction: 'clap', emoji: '👏', count: 2, reactedByMe: true },
            { reaction: '🥳', emoji: '🥳', count: 1, reactedByMe: false },
          ],
        ],
        ['empty', []],
      ])
    );
  });

  it('lists reactors viewer first, then newest, with emoji and profile fields', async () => {
    db.tables.circle_message_reactions.push(
      { message_id: MSG, user_id: OTHER, reaction: '🥳', created_at: ago(1_000) },
      { message_id: MSG, user_id: AUTHOR, reaction: 'heart', created_at: ago(2_000) },
      { message_id: MSG, user_id: ME, reaction: 'flame', created_at: ago(60_000) },
      { message_id: MSG, user_id: ME, reaction: 'clap', created_at: ago(30_000) }
    );
    const out = await CircleChatService.listReactors(MSG, ME);
    expect(out).toEqual([
      { user_id: ME, display_name: 'Ani', avatar_url: 'https://x/me.png', reaction: 'clap', emoji: '👏', reacted_at: expect.any(String) },
      { user_id: OTHER, display_name: 'Grace', avatar_url: null, reaction: '🥳', emoji: '🥳', reacted_at: expect.any(String) },
      { user_id: AUTHOR, display_name: 'Author', avatar_url: null, reaction: 'heart', emoji: '❤️', reacted_at: expect.any(String) },
    ]);
  });

  it('reactors are members-only', async () => {
    await expect(CircleChatService.listReactors(MSG, 'stranger')).rejects.toThrow('Forbidden');
  });
});

describe('chat_reaction push copy', () => {
  it('cheer kinds: "Ani cheered your message 👏" with the preview as body', () => {
    const c = NOTIFICATION_TEMPLATES.chat_reaction({
      friendName: 'Ani',
      emoji: '👏',
      reactionVerb: 'cheered',
      reactionSubject: 'message',
      preview: 'Leg day done',
    });
    expect(c.title).toBe('Ani cheered your message 👏');
    expect(c.body).toBe('"Leg day done"');
  });

  it('anything else: "Ani reacted 🥳 to your message"; photos fall back to the circle name', () => {
    const c = NOTIFICATION_TEMPLATES.chat_reaction({
      friendName: 'Ani',
      emoji: '🥳',
      reactionVerb: 'reacted',
      reactionSubject: 'photo',
      preview: 'your photo',
      circleName: 'Lifters',
    });
    expect(c.title).toBe('Ani reacted 🥳 to your photo');
    expect(c.body).toBe('in Lifters');
  });
});

describe('migration 122', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../../../supabase/migrations/122_chat_reactions_v2.sql'), 'utf8');

  it('generated emoji column matches REACTION_EMOJI exactly', () => {
    const pairs = Array.from(sql.matchAll(/WHEN '([a-z_]+)' THEN '([^']+)'/g), (m) => [m[1], m[2]]);
    expect(Object.fromEntries(pairs)).toEqual(REACTION_EMOJI);
  });

  it('CHECK lists every named kind and defines no function or trigger', () => {
    for (const kind of Object.keys(REACTION_EMOJI)) expect(sql).toContain(`'${kind}'::"text"`);
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|PROCEDURE)/i);
    expect(sql).not.toMatch(/log_reactions"?\s+(DROP|ADD)/i);
  });
});
