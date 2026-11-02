import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Top-nav chat button, circle switcher, cheer bubbles
// (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §1 / §3).

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
const client = vi.hoisted(() => ({ listChats: vi.fn() }));
vi.mock('@/lib/api/circle-chat-client', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, chatClient: client };
});
vi.mock('@/lib/supabase', () => {
  const channel: any = { on: () => channel, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});
vi.mock('@/stores/auth-store', () => {
  const state = { user: { id: 'me', name: 'Ani' }, token: 't' };
  const useAuthStore: any = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', async () => {
  const { AnalyticsEvents } = await import('@/lib/analytics/events.generated');
  return { AnalyticsEvents, analytics: { track } };
});

import { ChatNavButton, chatHref } from '@/components/chat/ChatNavButton';
import { ChatCircleSwitcher, inboxPreview, inboxTime } from '@/components/chat/ChatSwitcher';
import { MessageBubble, cheerHeadline, cheerStatChip } from '@/components/chat/MessageBubble';
import { badgeLabel, switcherOrder, useChatInboxStore } from '@/components/chat/useChatInbox';
import type { ChatInbox, ChatMessage, InboxChat } from '@/lib/api/circle-chat-client';

const chat = (id: string, name: string, unread: number, extra: Partial<InboxChat> = {}): InboxChat => ({
  circle_id: id,
  circle_name: name,
  circle_avatar_url: null,
  circle_type: 'custom',
  unread_count: unread,
  muted: false,
  last_message: {
    id: `m-${id}`, sender_id: 's', sender_display_name: 'Raveesh', preview: `hi ${name}`, kind: 'user_text', is_cheer: false,
    created_at: '2026-11-02T18:00:00Z',
  },
  last_read_at: null,
  last_activity_at: '2026-11-02T18:00:00Z',
  ...extra,
});

const INBOX: ChatInbox = {
  chats: [chat('c-a', 'Alpha', 0), chat('c-b', 'Beta', 3), chat('c-m', 'Muted', 4, { muted: true })],
  total_unread: 3,
  muted_unread: 4,
  default_circle_id: 'c-b',
};

async function mountButton(inbox: ChatInbox | null) {
  client.listChats.mockResolvedValue(inbox);
  useChatInboxStore.setState({ inbox, loading: false });
  render(<ChatNavButton />);
  await act(async () => {});
}

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  track.mockReset();
  client.listChats.mockReset();
});

describe('pure helpers', () => {
  it('badge caps at 99+, switcher puts non-muted unread first', () => {
    expect(badgeLabel(5)).toBe('5');
    expect(badgeLabel(100)).toBe('99+');
    expect(switcherOrder(INBOX.chats).map((c) => c.circle_id)).toEqual(['c-b', 'c-a', 'c-m']);
    expect(chatHref('c1')).toBe('/fitcircles/c1?tab=chat');
  });

  it('preview names the sender (not for system posts); time formats', () => {
    expect(inboxPreview(INBOX.chats[0])).toBe('Raveesh: hi Alpha');
    expect(inboxPreview(chat('x', 'X', 0, { last_message: { ...INBOX.chats[0].last_message!, kind: 'system_event' } }))).toBe('hi Alpha');
    expect(inboxPreview(chat('x', 'X', 0, { last_message: null }))).toBe('No messages yet');
    const now = new Date('2026-11-02T20:00:00');
    expect(inboxTime('2026-11-02T18:05:00', now)).toMatch(/6:05/);
    expect(inboxTime('2026-10-01T18:05:00', now)).toBe('Oct 1');
    expect(inboxTime(null, now)).toBe('');
  });
});

describe('ChatNavButton', () => {
  it('is hidden when the viewer has no circle chats', async () => {
    await mountButton({ chats: [], total_unread: 0, muted_unread: 0, default_circle_id: null });
    expect(screen.queryByTestId('chat-nav-button')).toBeNull();
  });

  it('shows the unread total and opens the chat the server picked', async () => {
    await mountButton(INBOX);
    const button = screen.getByTestId('chat-nav-button');
    expect(button).toHaveAccessibleName('Chats, 3 unread');
    expect(screen.getByTestId('chat-nav-badge')).toHaveTextContent('3');
    fireEvent.click(button);
    expect(router.push).toHaveBeenCalledWith('/fitcircles/c-b?tab=chat');
    expect(track).toHaveBeenCalledWith({ name: 'Chat Opened', properties: { entry: 'top_nav', circle_id: 'c-b' } });
  });

  it('a dot (no number) when only muted circles have unread', async () => {
    await mountButton({ ...INBOX, total_unread: 0 });
    expect(screen.queryByTestId('chat-nav-badge')).toBeNull();
    expect(screen.getByTestId('chat-nav-dot')).toBeInTheDocument();
  });

  it('right-click opens the circle list; picking one opens that chat', async () => {
    await mountButton(INBOX);
    fireEvent.contextMenu(screen.getByTestId('chat-nav-button'));
    expect(track).toHaveBeenCalledWith({ name: 'Chat Switcher Opened', properties: { source: 'long_press', circle_count: 3 } });
    const rows = within(screen.getByTestId('chat-switcher-list')).getAllByTestId('chat-switcher-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Beta'),
      expect.stringContaining('Alpha'),
      expect.stringContaining('Muted'),
    ]);
    fireEvent.click(rows[1]);
    expect(router.push).toHaveBeenCalledWith('/fitcircles/c-a?tab=chat');
    expect(track).toHaveBeenCalledWith({ name: 'Chat Opened', properties: { entry: 'switcher', circle_id: 'c-a' } });
  });
});

describe('ChatCircleSwitcher', () => {
  it('one chat: a plain title, no switcher', () => {
    render(<ChatCircleSwitcher circleId="c-a" circleName="Alpha" chats={[INBOX.chats[0]]} onSwitch={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByTestId('chat-switcher-toggle')).toBeNull();
  });

  it('several chats: the title opens the list; choosing another circle swaps in place', () => {
    const onSwitch = vi.fn();
    const onOpen = vi.fn();
    render(<ChatCircleSwitcher circleId="c-a" circleName="Alpha" chats={INBOX.chats} onOpen={onOpen} onSwitch={onSwitch} />);
    const toggle = screen.getByTestId('chat-switcher-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalled();
    const current = screen.getByRole('option', { selected: true });
    expect(current).toHaveTextContent('Alpha');
    fireEvent.click(within(current).getByRole('button'));
    expect(onSwitch).not.toHaveBeenCalled(); // same circle: just closes
    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByTestId('chat-switcher-row')[0]);
    expect(onSwitch).toHaveBeenCalledWith('c-b');
  });
});

describe('cheer messages', () => {
  const cheerMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'm1',
    circleId: 'c1',
    kind: 'user_text',
    sender: { id: 'ani', name: 'Ani', avatarUrl: null },
    body: '👏 @Raveesh Keep going!',
    photoUrl: null,
    system: null,
    reactions: [],
    clientId: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    cheer: {
      to_user_id: 'rav',
      to_display_name: 'Raveesh',
      reaction: 'clap',
      emoji: '👏',
      message: 'Keep going!',
      source: 'leaderboard_long_press',
      stat_snapshot: { metric: 'steps', date: '2026-11-02', today_steps: 2732, daily_goal_steps: 8000, goal_pct_today: 34 },
    },
    ...overrides,
  });

  it('headline and stat chip from the viewer’s point of view', () => {
    const c = cheerMessage().cheer!;
    expect(cheerHeadline(c, 'Ani', false, 'grace')).toEqual({ actor: 'Ani', target: 'Raveesh' });
    expect(cheerHeadline(c, 'Ani', true, 'ani')).toEqual({ actor: 'You', target: 'Raveesh' });
    expect(cheerHeadline(c, 'Ani', false, 'rav')).toEqual({ actor: 'Ani', target: 'you' });
    expect(cheerStatChip(c)).toBe('2,732 steps · 34%');
    expect(cheerStatChip({ stat_snapshot: null })).toBeNull();
  });

  it('renders a cheer bubble (not the plain fallback body) and highlights it for the member cheered', () => {
    const { rerender } = render(
      <MessageBubble message={cheerMessage()} isMine={false} viewerId="grace" groupedWithPrevious={false} onReactionsChange={vi.fn()} />
    );
    const bubble = screen.getByTestId('cheer-bubble');
    expect(bubble).toHaveTextContent('Ani cheered Raveesh');
    expect(bubble).toHaveTextContent('Keep going!');
    expect(bubble).toHaveTextContent('2,732 steps · 34%');
    expect(screen.queryByText('👏 @Raveesh Keep going!')).toBeNull();
    expect(bubble.className).not.toContain('amber');

    rerender(<MessageBubble message={cheerMessage()} isMine={false} viewerId="rav" groupedWithPrevious={false} onReactionsChange={vi.fn()} />);
    expect(screen.getByTestId('cheer-bubble')).toHaveTextContent('Ani cheered you');
    expect(screen.getByTestId('cheer-bubble').className).toContain('amber');
  });

  it('a plain text message still renders as text', () => {
    render(
      <MessageBubble message={cheerMessage({ cheer: null, body: 'hello' })} isMine={false} viewerId="grace" groupedWithPrevious={false} onReactionsChange={vi.fn()} />
    );
    expect(screen.queryByTestId('cheer-bubble')).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('own cheers offer no Edit action', () => {
    render(<MessageBubble message={cheerMessage()} isMine viewerId="ani" groupedWithPrevious={false} onReactionsChange={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'React or more actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });
});
