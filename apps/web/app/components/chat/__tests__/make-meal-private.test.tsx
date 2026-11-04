/**
 * "Make private" on your own meal card in circle chat
 * (docs/FOOD_ENTRY_PRIVACY_SPEC.md §2.6, §6.3 #3).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/circle-chat-client', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, chatClient: { setReaction: vi.fn(), clearReaction: vi.fn(), listReactors: vi.fn() } };
});
vi.mock('@/lib/analytics', async () => {
  const { AnalyticsEvents } = await import('@/lib/analytics/events.generated');
  return { AnalyticsEvents, analytics: { track: vi.fn() } };
});

import { MessageBubble, ownMealEntryId } from '@/components/chat/MessageBubble';
import type { ChatMessage } from '@/lib/api/circle-chat-client';

const ME = 'me';

function mealCard(actorId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    circleId: 'c1',
    kind: 'system_event',
    sender: null,
    body: 'Ani logged lunch: Pasta',
    photoUrl: null,
    system: {
      eventType: 'meal_logged',
      refId: 'entry-1',
      renderHint: 'meal_card',
      actors: [{ id: actorId, name: 'Ani' }],
      payload: { entry_id: 'entry-1' },
    },
    reactions: [],
    clientId: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function renderCard(message: ChatMessage, onMakeMealPrivate = vi.fn(async () => {})) {
  render(
    <MessageBubble
      message={message}
      isMine={false}
      viewerId={ME}
      groupedWithPrevious={false}
      onReactionsChange={vi.fn()}
      onMakeMealPrivate={onMakeMealPrivate}
    />
  );
  return onMakeMealPrivate;
}

describe('ownMealEntryId', () => {
  it('returns the entry id only for the viewer’s own live meal card', () => {
    expect(ownMealEntryId(mealCard(ME), ME)).toBe('entry-1');
    expect(ownMealEntryId(mealCard('someone-else'), ME)).toBeNull();
    expect(ownMealEntryId(mealCard(ME, { deletedAt: new Date().toISOString() }), ME)).toBeNull();
    expect(ownMealEntryId(mealCard(ME), null)).toBeNull();
  });

  it('falls back to payload.entry_id when refId is missing', () => {
    const m = mealCard(ME);
    m.system = { ...m.system!, refId: null };
    expect(ownMealEntryId(m, ME)).toBe('entry-1');
  });

  it('ignores non-meal system posts', () => {
    const m = mealCard(ME);
    m.system = { ...m.system!, eventType: 'workout_done', renderHint: 'stat_card' };
    expect(ownMealEntryId(m, ME)).toBeNull();
  });
});

describe('MessageBubble meal card', () => {
  it('shows "Make private" on my own meal card and calls the handler with the entry id', async () => {
    const handler = renderCard(mealCard(ME));
    const button = screen.getByTestId('meal-make-private');
    expect(button).toHaveAccessibleName(/Make this meal private/);
    fireEvent.click(button);
    await waitFor(() => expect(handler).toHaveBeenCalledWith('msg-1', 'entry-1'));
  });

  it('also offers it in the focused menu', async () => {
    const handler = renderCard(mealCard(ME));
    fireEvent.contextMenu(screen.getByRole('group'));
    const item = await screen.findByRole('menuitem', { name: 'Make private' });
    fireEvent.click(item);
    await waitFor(() => expect(handler).toHaveBeenCalledWith('msg-1', 'entry-1'));
  });

  it('does not offer it on someone else’s meal card', () => {
    renderCard(mealCard('friend'));
    expect(screen.queryByTestId('meal-make-private')).not.toBeInTheDocument();
  });

  it('hides a retracted (tombstoned) meal card', () => {
    renderCard(mealCard(ME, { deletedAt: new Date().toISOString(), body: null }));
    expect(screen.queryByText(/logged lunch/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('meal-make-private')).not.toBeInTheDocument();
  });
});
