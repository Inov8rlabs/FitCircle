import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Leaderboard cheers on web (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §3):
// right-click / long-press / hover button → cheer sheet → POST /cheers.

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/fitcircles/c1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
const client = vi.hoisted(() => ({ sendCheer: vi.fn(), listChats: vi.fn() }));
vi.mock('@/lib/api/circle-chat-client', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, chatClient: client };
});
vi.mock('@/lib/supabase', () => {
  const channel: any = { on: () => channel, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', async () => {
  const { AnalyticsEvents } = await import('@/lib/analytics/events.generated');
  return { AnalyticsEvents, analytics: { track } };
});

import { CheerSheet } from '@/components/circles/CheerSheet';
import { cheerChipsFor, cheerStatLine, firstName, goalPctBucket } from '@/components/circles/cheer-options';
import { LeaderboardRow } from '@/components/circles/LeaderboardRow';
import { StepsLeaderboard, cheerTargetFor, type StepsBoard, type StepsMemberRow } from '@/components/circles/StepsLeaderboard';
import { ChatApiError } from '@/lib/api/circle-chat-client';

const RAV = { user_id: 'rav', display_name: 'Raveesh Kumar', avatar_url: null, steps: 2732, goalPct: 34 };

beforeEach(() => {
  router.push.mockReset();
  client.sendCheer.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  track.mockReset();
});
// Not vi.restoreAllMocks(): it would also wipe the global matchMedia stub framer-motion needs.
let fetchSpy: { mockRestore: () => void } | null = null;
afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

describe('cheer options', () => {
  it('contextual chips: "Keep going!" below goal, "You crushed it!" at 100 %+, neither when unknown', () => {
    const texts = (pct: number | null) => cheerChipsFor(pct).map((c) => c.text);
    expect(texts(34)).toEqual(['Great job!', 'Keep going!', 'On fire!', 'High five!']);
    expect(texts(115)).toEqual(['Great job!', 'On fire!', 'High five!', 'You crushed it!']);
    expect(texts(null)).toEqual(['Great job!', 'On fire!', 'High five!']);
    expect(cheerChipsFor(34).map((c) => c.emoji)).toEqual(['👏', '💪', '🔥', '🙌']);
  });

  it('buckets, stat line, first name', () => {
    expect([null, 0, 24, 25, 50, 75, 99, 100, 250].map(goalPctBucket)).toEqual([
      'unknown', 'lt_25', 'lt_25', '25_50', '50_75', '75_100', '75_100', '100_plus', '100_plus',
    ]);
    expect(cheerStatLine({ steps: 2732, goalPct: 34.4 })).toBe('2,732 steps today · 34% of goal');
    expect(cheerStatLine({ goalPct: 50 })).toBe('50% of goal');
    expect(cheerStatLine({})).toBeNull();
    expect(firstName('Raveesh Kumar')).toBe('Raveesh');
  });
});

describe('CheerSheet', () => {
  const mount = (onClose = vi.fn(), onSent = vi.fn()) => {
    render(<CheerSheet circleId="c1" target={RAV} source="leaderboard_long_press" onClose={onClose} onSent={onSent} />);
    return { onClose, onSent };
  };

  it('shows the member and their stat; a chip sends immediately', async () => {
    client.sendCheer.mockResolvedValue({ message: { id: 'm1' } });
    const { onClose, onSent } = mount();
    expect(screen.getByText('Cheer Raveesh Kumar')).toBeInTheDocument();
    expect(screen.getByText('2,732 steps today · 34% of goal')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Say something to Raveesh')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Keep going!/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.sendCheer).toHaveBeenCalledWith('c1', {
      to_user_id: 'rav', reaction: 'muscle', message: 'Keep going!', source: 'leaderboard_long_press',
    });
    expect(onSent).toHaveBeenCalledWith('rav');
    expect(track).toHaveBeenCalledWith({
      name: 'Member Cheer Sent',
      properties: { circle_id: 'c1', reaction: 'muscle', has_message: true, source: 'leaderboard_long_press', recipient_goal_pct_bucket: '25_50' },
    });
    expect(toast.success).toHaveBeenCalledWith('Cheer sent to Raveesh', expect.objectContaining({ action: expect.objectContaining({ label: 'View in chat' }) }));
    // The toast action opens the chat.
    toast.success.mock.calls[0][1].action.onClick();
    expect(router.push).toHaveBeenCalledWith('/fitcircles/c1?tab=chat');
    expect(track).toHaveBeenCalledWith({ name: 'Chat Opened', properties: { entry: 'cheer_toast', circle_id: 'c1' } });
  });

  it('a typed message sends with 👏; ＋ opens the emoji grid (custom emoji → "custom" in analytics)', async () => {
    client.sendCheer.mockResolvedValue({ message: { id: 'm1' } });
    mount();
    const send = screen.getByRole('button', { name: 'Send cheer' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Message to Raveesh'), { target: { value: '  Proud of you  ' } });
    fireEvent.click(send);
    await waitFor(() => expect(client.sendCheer).toHaveBeenCalledWith('c1', expect.objectContaining({ reaction: 'clap', message: 'Proud of you' })));

    client.sendCheer.mockClear();
    track.mockClear();
    render(<CheerSheet circleId="c1" target={{ ...RAV, user_id: 'g', goalPct: null }} source="member_sheet" onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose another emoji' }).at(-1)!);
    fireEvent.click(screen.getAllByRole('button', { name: '🥳' }).at(-1)!);
    await waitFor(() => expect(client.sendCheer).toHaveBeenCalledWith('c1', { to_user_id: 'g', reaction: '🥳', source: 'member_sheet' }));
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ properties: expect.objectContaining({ reaction: 'custom', has_message: false, recipient_goal_pct_bucket: 'unknown' }) }));
  });

  it('rate limited: shows the server message, closes, does not retry', async () => {
    client.sendCheer.mockRejectedValue(new ChatApiError('You just cheered Raveesh — give it a minute', 429, 'RATE_LIMITED'));
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Great job!/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('You just cheered Raveesh — give it a minute'));
    expect(onClose).toHaveBeenCalled();
    expect(client.sendCheer).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });

  it('other failures keep the sheet open with an error toast', async () => {
    client.sendCheer.mockRejectedValue(new Error('network'));
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Great job!/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('leaderboard entry points', () => {
  const row = (id: string, name: string, extra: Partial<StepsMemberRow> = {}): StepsMemberRow => ({
    user_id: id, display_name: name, avatar_url: null, is_me: false, steps_visible: true,
    today_steps: 2732, total_steps: 9000, daily_goal_steps: 8000, goal_source: 'challenge', goal_pct_today: 34,
    days_goal_met: 0, steps_synced_recently: true,
    ranks: { today_steps: 1, total_steps: 1, goal_pct_today: 1 },
    days: [{ date: '2026-11-02', steps: 2732 }],
    ...extra,
  });
  const BOARD: StepsBoard = {
    is_steps_circle: true, phase: 'active', start_date: '2026-11-02', end_date: '2026-11-29', total_days: 28, day_number: 1,
    days_until_start: 0, daily_goal: { steps: 8000 }, default_metric: 'today_steps', member_count: 3,
    members: [row('rav', 'Raveesh'), row('me', 'Ani', { is_me: true }), row('pat', 'Pat', { steps_visible: false, today_steps: null, goal_pct_today: null, days: [] })],
  };

  const ravRow = () => screen.getAllByTestId('steps-leaderboard-row').find((r) => r.textContent?.includes('Raveesh'))!;

  async function mountBoard() {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => BOARD } as Response);
    render(<StepsLeaderboard circleId="c1" fallback={<p>fallback</p>} />);
    await screen.findByTestId('steps-leaderboard');
  }

  it('the private member’s target carries no numbers', () => {
    expect(cheerTargetFor(BOARD.members[2])).toEqual({ user_id: 'pat', display_name: 'Pat', avatar_url: null, steps: null, goalPct: null });
  });

  it('steps board: a Cheer button for everyone but you; right-click a row opens the sheet', async () => {
    await mountBoard();
    const buttons = screen.getAllByTestId('leaderboard-cheer-button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Cheer Pat', 'Cheer Raveesh']); // rows: Ani, Pat, Raveesh
    fireEvent.contextMenu(ravRow());
    expect(await screen.findByTestId('cheer-sheet')).toHaveTextContent('Cheer Raveesh');
    expect(screen.getByTestId('cheer-sheet')).toHaveTextContent('2,732 steps today · 34% of goal');
  });

  it('steps board: right-click on your own row does nothing', async () => {
    await mountBoard();
    const mine = screen.getAllByTestId('steps-leaderboard-row').find((r) => r.textContent?.includes('You'))!;
    fireEvent.contextMenu(mine);
    expect(screen.queryByTestId('cheer-sheet')).toBeNull();
  });

  it('steps board: touch long-press opens the sheet and swallows the tap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountBoard();
    const first = ravRow();
    fireEvent.pointerDown(first, { pointerType: 'touch', clientX: 1, clientY: 1 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.pointerUp(first, { pointerType: 'touch' });
    fireEvent.click(first);
    expect(await screen.findByTestId('cheer-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('steps-day-breakdown')).toBeNull();
    vi.useRealTimers();
  });

  it('steps board: the member detail sheet has a Cheer action (source member_sheet)', async () => {
    client.sendCheer.mockResolvedValue({ message: { id: 'm' } });
    await mountBoard();
    fireEvent.click(ravRow());
    fireEvent.click(await screen.findByTestId('member-sheet-cheer'));
    fireEvent.click(await screen.findByRole('button', { name: /On fire!/ }));
    await waitFor(() => expect(client.sendCheer).toHaveBeenCalledWith('c1', expect.objectContaining({ source: 'member_sheet', reaction: 'flame' })));
  });

  it('goal leaderboard row: hover Cheer button + right-click, never on your own row', () => {
    const onCheer = vi.fn();
    const entry = { user_id: 'rav', display_name: 'Raveesh', progress: 40 };
    const { rerender } = render(<ul><LeaderboardRow rank={1} entry={entry} isYou={false} onCheer={onCheer} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Cheer Raveesh' }));
    fireEvent.contextMenu(screen.getByTestId('leaderboard-row'));
    expect(onCheer).toHaveBeenCalledTimes(2);
    rerender(<ul><LeaderboardRow rank={1} entry={entry} isYou onCheer={onCheer} /></ul>);
    expect(screen.queryByRole('button', { name: 'Cheer Raveesh' })).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('leaderboard-row'));
    expect(onCheer).toHaveBeenCalledTimes(2);
  });
});
