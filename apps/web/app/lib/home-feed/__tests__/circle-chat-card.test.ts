import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { buildCandidates, parseClientCards } from '../candidates';
import { DEFAULT_ORDER } from '../catalog';
import { composeFeed } from '../compose';
import { buildFeedContext, chatUnreadHint, type ContextLoaders } from '../context';
import type { ChatUnreadHint } from '../types';

import { IOS_CARDS, SPEC_SUPPORT, makeCtx, types } from './helpers';

// docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §4 — the unread circle chat card.

const HINT: ChatUnreadHint = {
  total_unread: 5,
  circles_with_unread: 2,
  circle_id: 'c1',
  circle_name: 'Nov steps challenge',
  unread_count: 3,
  sender_display_name: 'Raveesh',
  preview: "Let's go!",
};
const NEW_CLIENT = parseClientCards(`${IOS_CARDS},circle_chat@1`);

describe('circle_chat feed card', () => {
  it('is never sent to clients that did not declare it (old apps)', () => {
    const { response } = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx({ chatUnread: HINT }) });
    expect(types(response.cards)).not.toContain('circle_chat');
    // …and the shipped clients' built-in fallback order is unchanged.
    expect(DEFAULT_ORDER).not.toContain('circle_chat');
  });

  it('declared + unread → right after health_sync_banner (before campaign), with props', () => {
    const { response } = composeFeed({
      support: NEW_CLIENT,
      ctx: makeCtx({ chatUnread: HINT, campaign: { present: true, slug: 'hold_the_line', phase: 'live' } }),
    });
    const order = types(response.cards);
    expect(order.indexOf('circle_chat')).toBe(order.indexOf('health_sync_banner') + 1);
    expect(order.indexOf('circle_chat')).toBeLessThan(order.indexOf('campaign'));
    expect(response.cards.find((c) => c.type === 'circle_chat')).toEqual({
      id: 'circle_chat',
      type: 'circle_chat',
      version: 1,
      props: {
        circle_id: 'c1',
        circle_name: 'Nov steps challenge',
        unread_count: 3,
        total_unread: 5,
        circles_with_unread: 2,
        sender_display_name: 'Raveesh',
        preview: "Let's go!",
      },
    });
  });

  it('known nothing unread → dropped; no circle → dropped; unknown → kept without props', () => {
    const none = buildCandidates(makeCtx({ chatUnread: { ...HINT, total_unread: 0, circle_id: null } }), NEW_CLIENT);
    expect(none.suppressed.map((c) => c.type)).toContain('circle_chat');
    const noCircle = buildCandidates(makeCtx({ hasCircle: false }), NEW_CLIENT);
    expect(noCircle.suppressed.map((c) => c.type)).toContain('circle_chat');
    const unknown = buildCandidates(makeCtx({ chatUnread: null }), NEW_CLIENT);
    const card = unknown.eligible.find((c) => c.type === 'circle_chat')!;
    expect(card).toBeTruthy();
    expect(card.props).toBeUndefined();
  });

  it('a higher declared version still gets v1; a lower one (v0) is ignored by the parser', () => {
    expect(buildCandidates(makeCtx({ chatUnread: HINT }), parseClientCards('circle_chat@2')).eligible.map((c) => c.type)).toContain('circle_chat');
    expect(buildCandidates(makeCtx({ chatUnread: HINT }), parseClientCards('circle_chat@0')).eligible).toHaveLength(0);
  });
});

describe('chat unread context', () => {
  const profile = { id: 'u1', timezone: 'UTC', created_at: '2026-10-01T00:00:00Z', subscription_tier: 'free', preferences: {} };
  const info = { platform: 'ios' as const, appVersion: '1.1.1', appBuild: 80, clientTimezone: null };
  const loaders = (chatUnread: ContextLoaders['chatUnread']): ContextLoaders => ({
    campaign: async () => ({ present: false, slug: null, phase: null }),
    referralProgramEnabled: async () => true,
    subscriptionsEnabled: async () => true,
    activeCircleCount: async () => 1,
    checkedIn: async () => true,
    waterTodayMl: async () => 0,
    chatUnread,
  });

  it('only runs the loader for clients that declare the card', async () => {
    const chatUnread = vi.fn(async () => HINT);
    const without = await buildFeedContext(profile, info, { loaders: loaders(chatUnread) });
    expect(chatUnread).not.toHaveBeenCalled();
    expect(without).not.toHaveProperty('chatUnread');
    const withCard = await buildFeedContext(profile, info, { loaders: loaders(chatUnread), wantChat: true });
    expect(withCard.chatUnread).toEqual(HINT);
  });

  it('a slow / failing loader is unknown (null), never an error', async () => {
    const ctx = await buildFeedContext(profile, info, {
      loaders: loaders(async () => {
        throw new Error('db');
      }),
      wantChat: true,
    });
    expect(ctx.chatUnread).toBeNull();
  });

  it('hint from the /chats inbox: the default circle when it has unread, muted ignored', () => {
    const inbox = {
      chats: [
        { circle_id: 'c1', circle_name: 'A', circle_avatar_url: null, circle_type: null, unread_count: 3, muted: false, last_read_at: null, last_activity_at: null,
          last_message: { id: 'm', sender_id: 's', sender_display_name: 'Raveesh', preview: 'Hi', kind: 'user_text' as const, is_cheer: false, created_at: '' } },
        { circle_id: 'c2', circle_name: 'B', circle_avatar_url: null, circle_type: null, unread_count: 9, muted: true, last_read_at: null, last_activity_at: null, last_message: null },
      ],
      total_unread: 3,
      muted_unread: 9,
      default_circle_id: 'c1',
    };
    expect(chatUnreadHint(inbox)).toEqual({
      total_unread: 3, circles_with_unread: 1, circle_id: 'c1', circle_name: 'A', unread_count: 3, sender_display_name: 'Raveesh', preview: 'Hi',
    });
    expect(chatUnreadHint({ ...inbox, total_unread: 0, chats: inbox.chats.map((c) => ({ ...c, unread_count: 0 })) })).toMatchObject({
      total_unread: 0, circle_id: null, circles_with_unread: 0,
    });
  });
});
