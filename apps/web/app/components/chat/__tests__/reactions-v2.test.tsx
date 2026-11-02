import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  setReaction: vi.fn(),
  clearReaction: vi.fn(),
  listReactors: vi.fn(),
}));
const track = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/circle-chat-client', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, chatClient: client };
});
vi.mock('@/lib/analytics', async () => {
  const { AnalyticsEvents } = await import('@/lib/analytics/events.generated');
  return { AnalyticsEvents, analytics: { track } };
});

import { MessageBubble } from '@/components/chat/MessageBubble';
import {
  applyViewerReaction,
  canCheer,
  focusMenuTop,
  pillSummary,
  pillsAccessibleLabel,
  viewerReaction,
} from '@/components/chat/reaction-state';
import type { ChatMessage, MessageReactionSummary } from '@/lib/api/circle-chat-client';

const VIEWER = 'viewer';

function textMessage(reactions: MessageReactionSummary[] = []): ChatMessage {
  return {
    id: 'm1',
    circleId: 'c1',
    kind: 'user_text',
    sender: { id: 'friend', name: 'Grace', avatarUrl: null },
    body: 'Leg day done',
    photoUrl: null,
    system: null,
    reactions,
    clientId: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
  };
}

function activityPost(actorId: string, reactions: MessageReactionSummary[] = []): ChatMessage {
  return {
    ...textMessage(reactions),
    id: 'p1',
    kind: 'system_event',
    sender: null,
    body: 'Grace finished a 45 min run',
    system: { eventType: 'workout_done', refId: null, renderHint: 'stat_card', actors: [{ id: actorId, name: 'Grace' }], payload: {} },
  };
}

/** Stateful harness: applies onReactionsChange like CircleChat does. */
function Harness({ initial, onReport }: { initial: ChatMessage; onReport?: (id: string) => void }) {
  const [message, setMessage] = useState(initial);
  return (
    <MessageBubble
      message={message}
      isMine={false}
      viewerId={VIEWER}
      groupedWithPrevious={false}
      onReactionsChange={(_, reactions) => setMessage((m) => ({ ...m, reactions }))}
      onReport={onReport}
    />
  );
}

const clap = (count: number, mine: boolean): MessageReactionSummary => ({ reaction: 'clap', emoji: '👏', count, reactedByMe: mine });

beforeEach(() => {
  client.setReaction.mockReset();
  client.clearReaction.mockReset();
  client.listReactors.mockReset();
  track.mockReset();
});

describe('reaction-state', () => {
  it('applyViewerReaction replaces the viewer’s one reaction and drops empty pills', () => {
    const start = [clap(2, true), { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false }];
    expect(applyViewerReaction(start, 'heart')).toEqual([
      clap(1, false),
      { reaction: 'heart', emoji: '❤️', count: 2, reactedByMe: true },
    ]);
    expect(applyViewerReaction([clap(1, true)], null)).toEqual([]);
    expect(applyViewerReaction([], '🥳')).toEqual([{ reaction: '🥳', emoji: '🥳', count: 1, reactedByMe: true }]);
    expect(viewerReaction(start)).toBe('clap');
  });

  it('pills show at most three emoji, most popular first, plus the total', () => {
    const many = [
      { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false },
      clap(3, false),
      { reaction: 'flame', emoji: '🔥', count: 2, reactedByMe: false },
      { reaction: '🥳', emoji: '🥳', count: 1, reactedByMe: false },
    ];
    expect(pillSummary(many)).toEqual({ emojis: ['👏', '🔥', '❤️'], total: 7 });
    expect(pillsAccessibleLabel([clap(2, false), { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false }])).toBe(
      '3 reactions: clap 2, heart 1. Activate to see who reacted.'
    );
  });

  it('cheer chip only on activity posts about someone else', () => {
    expect(canCheer(activityPost('friend'), VIEWER)).toBe(true);
    expect(canCheer(activityPost(VIEWER), VIEWER)).toBe(false);
    expect(canCheer(textMessage(), VIEWER)).toBe(false);
    const summary = activityPost('friend');
    summary.system!.eventType = 'daily_summary';
    expect(canCheer(summary, VIEWER)).toBe(false);
  });

  it('focus menu stays on screen', () => {
    expect(focusMenuTop({ top: 300, height: 40 }, 800, { bar: 52, menu: 100 })).toBe(240);
    expect(focusMenuTop({ top: 10, height: 40 }, 800, { bar: 52, menu: 100 })).toBe(12);
    expect(focusMenuTop({ top: 760, height: 40 }, 800, { bar: 52, menu: 100 })).toBe(800 - 12 - (52 + 8 + 40 + 8 + 100));
  });
});

describe('MessageBubble reactions', () => {
  it('right-click opens one focused menu with the reaction bar and actions', async () => {
    const onReport = vi.fn();
    render(<Harness initial={textMessage()} onReport={onReport} />);
    fireEvent.contextMenu(screen.getByRole('group', { name: /Grace: Leg day done/ }));

    const menu = await screen.findByRole('dialog', { name: 'Message actions' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Reactions' })).toBeInTheDocument();
    for (const name of ['React clap', 'React high five', 'React strong', 'React fire', 'React heart', 'React laugh', 'More reactions']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    expect(onReport).toHaveBeenCalledWith('m1');
    expect(screen.queryByTestId('message-focus-menu')).not.toBeInTheDocument();
  });

  it('picking a reaction applies optimistically, calls PUT and tracks Chat Reaction Set', async () => {
    client.setReaction.mockResolvedValue({ reactions: [{ reaction: 'muscle', emoji: '💪', count: 1, reactedByMe: true }] });
    render(<Harness initial={textMessage()} />);
    fireEvent.contextMenu(screen.getByRole('group', { name: /Grace/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'React strong' }));

    expect(await screen.findByTestId('reaction-pills')).toHaveTextContent('💪');
    expect(client.setReaction).toHaveBeenCalledWith('m1', 'muscle');
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({
        name: 'Chat Reaction Sent',
        properties: { reaction: 'muscle', circle_id: 'c1', source: 'long_press', replaced: false },
      })
    );
  });

  it('＋ opens the emoji grid; a custom emoji is sent as-is and tracked as "custom"', async () => {
    client.setReaction.mockResolvedValue({ reactions: [{ reaction: '🥳', emoji: '🥳', count: 1, reactedByMe: true }] });
    render(<Harness initial={textMessage()} />);
    fireEvent.contextMenu(screen.getByRole('group', { name: /Grace/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'More reactions' }));
    fireEvent.click(screen.getByRole('button', { name: '🥳' }));
    expect(client.setReaction).toHaveBeenCalledWith('m1', '🥳');
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        expect.objectContaining({ properties: expect.objectContaining({ reaction: 'custom', source: 'emoji_picker' }) })
      )
    );
  });

  it('double-click toggles the 👏 cheer; a second double-click clears it', async () => {
    client.setReaction.mockResolvedValue({ reactions: [clap(1, true)] });
    client.clearReaction.mockResolvedValue({ reactions: [] });
    render(<Harness initial={textMessage()} />);
    const bubble = screen.getByRole('group', { name: /Grace/ });

    fireEvent.doubleClick(bubble);
    await waitFor(() => expect(client.setReaction).toHaveBeenCalledWith('m1', 'clap'));
    await screen.findByTestId('reaction-pills');

    fireEvent.doubleClick(bubble);
    await waitFor(() => expect(client.clearReaction).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(screen.queryByTestId('reaction-pills')).not.toBeInTheDocument());
    expect(track).toHaveBeenLastCalledWith({
      name: 'Chat Reaction Removed',
      properties: { reaction: 'clap', circle_id: 'c1', source: 'double_tap' },
    });
  });

  it('double-click does not cheer on a link', () => {
    render(
      <Harness initial={{ ...textMessage(), body: 'see https://fitcircle.ai' }} />
    );
    const bubble = screen.getByRole('group', { name: /Grace/ });
    const link = document.createElement('a');
    link.href = 'https://fitcircle.ai';
    link.textContent = 'fitcircle.ai';
    bubble.querySelector('p')!.appendChild(link);
    fireEvent.mouseDown(link, { detail: 1 });
    fireEvent.doubleClick(link);
    expect(client.setReaction).not.toHaveBeenCalled();
  });

  it('double-click does not cheer when it starts on already-selected text', () => {
    client.setReaction.mockResolvedValue({ reactions: [clap(1, true)] });
    render(<Harness initial={textMessage()} />);
    const bubble = screen.getByRole('group', { name: /Grace/ });
    const text = bubble.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    fireEvent.mouseDown(text, { detail: 1 });
    fireEvent.doubleClick(text);
    expect(client.setReaction).not.toHaveBeenCalled();

    // Without a prior selection the same gesture cheers.
    window.getSelection()!.removeAllRanges();
    fireEvent.mouseDown(text, { detail: 1 });
    fireEvent.doubleClick(text);
    expect(client.setReaction).toHaveBeenCalledWith('m1', 'clap');
  });

  it('rolls back when the server rejects', async () => {
    client.setReaction.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Harness initial={textMessage()} />);
    fireEvent.doubleClick(screen.getByRole('group', { name: /Grace/ }));
    await waitFor(() => expect(client.setReaction).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('reaction-pills')).not.toBeInTheDocument());
  });

  it('keyboard: Enter on the focused message opens the menu and Escape closes it', async () => {
    render(<Harness initial={textMessage()} />);
    const bubble = screen.getByRole('group', { name: /Grace/ });
    bubble.focus();
    fireEvent.keyDown(bubble, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Message actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'React clap' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Message actions' })).not.toBeInTheDocument();
  });

  it('pills open the Reactions dialog; the viewer’s row is first with Tap to remove', async () => {
    client.listReactors.mockResolvedValue({
      reactors: [
        { user_id: VIEWER, display_name: 'Ani', avatar_url: null, reaction: 'clap', emoji: '👏', reacted_at: '2026-11-02T10:00:00Z' },
        { user_id: 'friend', display_name: 'Grace', avatar_url: null, reaction: 'heart', emoji: '❤️', reacted_at: '2026-11-02T09:00:00Z' },
      ],
    });
    client.clearReaction.mockResolvedValue({ reactions: [{ reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false }] });
    render(<Harness initial={textMessage([clap(1, true), { reaction: 'heart', emoji: '❤️', count: 1, reactedByMe: false }])} />);

    fireEvent.click(screen.getByRole('button', { name: /2 reactions: clap 1, heart 1/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reactions' });
    expect(await within(dialog).findByText('Grace')).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('You');
    expect(screen.getByRole('tab', { name: 'All 2' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: /You reacted clap. Activate to remove/ }));
    await waitFor(() => expect(client.clearReaction).toHaveBeenCalledWith('m1'));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chat Reaction Removed', properties: expect.objectContaining({ source: 'pills_sheet' }) }))
    );
  });
});

describe('Cheer chip on activity posts', () => {
  it('reads Cheer → Cheered with no count; the clap count lives in the pills', async () => {
    client.setReaction.mockResolvedValue({ reactions: [clap(2, true)] });
    const { unmount } = render(<Harness initial={activityPost('friend', [clap(1, false)])} />);
    const chip = screen.getByRole('button', { name: 'Cheer' });
    expect(chip).toHaveTextContent(/^👏Cheer$/);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    // Claps-only reactions still get pills (they open the reactors dialog).
    expect(screen.getByTestId('reaction-pills')).toHaveTextContent('👏');
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(client.setReaction).toHaveBeenCalledWith('p1', 'clap');
    const cheered = await screen.findByRole('button', { name: 'Cheered. Activate to undo' });
    expect(cheered).toHaveAttribute('aria-pressed', 'true');
    expect(cheered).toHaveTextContent(/^👏Cheered$/);
    await waitFor(() => expect(screen.getByTestId('reaction-pills')).toHaveTextContent('👏2'));
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ properties: expect.objectContaining({ source: 'cheer_button' }) }));
    unmount();

    render(<Harness initial={activityPost(VIEWER)} />);
    expect(screen.queryByRole('button', { name: /^Cheer/ })).not.toBeInTheDocument();
  });
});
