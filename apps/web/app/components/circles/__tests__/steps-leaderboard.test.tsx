import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  analytics: { track: (...a: unknown[]) => track(...a) },
}));

import { StepsLeaderboard, sortStepsRows, stepsHeadline, type StepsBoard, type StepsMemberRow } from '../StepsLeaderboard';

const row = (id: string, name: string, today: number | null, total: number | null, pct: number | null, ranks: [number | null, number | null, number | null], extra: Partial<StepsMemberRow> = {}): StepsMemberRow => ({
  user_id: id, display_name: name, avatar_url: null, is_me: false, steps_visible: true,
  today_steps: today, total_steps: total, daily_goal_steps: 8000, goal_source: 'challenge', goal_pct_today: pct,
  days_goal_met: 1, steps_synced_recently: true,
  ranks: { today_steps: ranks[0], total_steps: ranks[1], goal_pct_today: ranks[2] },
  days: [{ date: '2026-11-02', steps: 9000 }, { date: '2026-11-03', steps: today }],
  ...extra,
});

const ACTIVE: StepsBoard = {
  is_steps_circle: true, phase: 'active', start_date: '2026-11-02', end_date: '2026-11-29', total_days: 28,
  day_number: 2, days_until_start: 0, daily_goal: { steps: 8000 }, default_metric: 'today_steps', member_count: 3,
  members: [
    row('a', 'Abha', 8800, 8800, 110, [1, 2, 1]),
    row('me', 'Ani', 4000, 13000, 50, [2, 1, 2], { is_me: true }),
    row('p', 'Pat', null, null, null, [null, null, null], { steps_visible: false, days: [], steps_synced_recently: null }),
  ],
};

const mockFetch = (body: unknown, ok = true) =>
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body } as Response);

beforeEach(() => track.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('sortStepsRows / stepsHeadline', () => {
  it('sorts by the chosen rank with unranked last', () => {
    expect(sortStepsRows(ACTIVE.members, 'total_steps').map((r) => r.user_id)).toEqual(['me', 'a', 'p']);
    expect(sortStepsRows(ACTIVE.members, 'goal_pct_today').map((r) => r.user_id)).toEqual(['a', 'me', 'p']);
  });
  it('words the phase', () => {
    expect(stepsHeadline(ACTIVE)).toBe('Day 2 of 28');
    expect(stepsHeadline({ ...ACTIVE, phase: 'upcoming', days_until_start: 1 })).toBe('Starts tomorrow');
    expect(stepsHeadline({ ...ACTIVE, phase: 'upcoming', days_until_start: 3 })).toBe('Starts in 3 days');
    expect(stepsHeadline({ ...ACTIVE, phase: 'completed' })).toBe('Final results');
  });
});

describe('<StepsLeaderboard />', () => {
  it('toggles metrics, re-sorts and tracks the switch', async () => {
    mockFetch(ACTIVE);
    render(<StepsLeaderboard circleId="c1" fallback={<p>old board</p>} />);
    await waitFor(() => expect(screen.getByTestId('steps-leaderboard')).toBeInTheDocument());
    const names = () => screen.getAllByTestId('steps-leaderboard-row').map((r) => r.textContent);
    expect(names()[0]).toContain('Abha');
    expect(names()[0]).toContain('8,800');
    expect(names()[2]).toContain('Private');
    await userEvent.click(screen.getByRole('tab', { name: 'Total' }));
    expect(names()[0]).toContain('Ani');
    expect(names()[0]).toContain('13,000');
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leaderboard Metric Changed', properties: { metric: 'total_steps', circle_phase: 'active' } }));
    await userEvent.click(screen.getByRole('tab', { name: '% Goal' }));
    expect(names()[0]).toContain('110%');
  });

  it('opens the per-day breakdown', async () => {
    mockFetch(ACTIVE);
    render(<StepsLeaderboard circleId="c1" fallback={null} />);
    const rows = await screen.findAllByTestId('steps-leaderboard-row');
    await userEvent.click(rows[1]);
    const breakdown = await screen.findByTestId('steps-day-breakdown');
    expect(breakdown.textContent).toContain('9,000');
    expect(breakdown.textContent).toContain('4,000');
  });

  it('shows a pre-start state instead of zeros', async () => {
    mockFetch({
      ...ACTIVE, phase: 'upcoming', day_number: null, days_until_start: 1,
      members: ACTIVE.members.map((m) => ({ ...m, today_steps: null, total_steps: null, goal_pct_today: null, days: [], ranks: { today_steps: null, total_steps: null, goal_pct_today: null } })),
    });
    render(<StepsLeaderboard circleId="c1" fallback={null} />);
    expect(await screen.findByText('Starts tomorrow')).toBeInTheDocument();
    expect(screen.getByText(/3 members ready/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('Steps syncing').length).toBe(2);
  });

  it('falls back to the goal leaderboard', async () => {
    mockFetch({ ...ACTIVE, is_steps_circle: false });
    const { unmount } = render(<StepsLeaderboard circleId="c1" fallback={<p>old board</p>} />);
    expect(await screen.findByText('old board')).toBeInTheDocument();
    unmount();
    mockFetch({}, false);
    render(<StepsLeaderboard circleId="c1" fallback={<p>old board</p>} />);
    expect(await screen.findByText('old board')).toBeInTheDocument();
  });
});
