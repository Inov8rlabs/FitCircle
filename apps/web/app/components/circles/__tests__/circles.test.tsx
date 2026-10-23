import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/nutrition/FitzyLauncher', () => ({ FitzyLauncher: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CircleListCard } from '../CircleListCard';
import { CircleStreakLiveCard } from '../CircleStreakLiveCard';
import { LeaderboardRow } from '../LeaderboardRow';
import { SegmentedRing } from '../SegmentedRing';
import {
  canCover,
  circleTypeLabel,
  daysLeft,
  durationLabel,
  leftToCloseLine,
  milestoneLine,
  savesPoolLine,
  todayProgressLine,
  type CircleStreakStatus,
} from '../types';

const ME = '11111111-1111-4111-8111-111111111111';
const MAYA = '33333333-3333-4333-8333-333333333331';

function status(overrides: Partial<CircleStreakStatus> = {}): CircleStreakStatus {
  return {
    fitcircleId: 'c1',
    currentStreak: 9,
    longestStreak: 12,
    lastActiveDate: null,
    updatedAt: null,
    today: {
      date: '2026-10-22',
      loggedCount: 1,
      activeCount: 3,
      needed: 2,
      qualified: false,
      members: [
        { userId: ME, displayName: 'Anki Rao', avatarUrl: null, logged: true, covered: false, coveredBy: null },
        { userId: MAYA, displayName: 'Maya Kapoor', avatarUrl: null, logged: false, covered: false, coveredBy: null },
        { userId: 'j', displayName: 'Jordan Reyes', avatarUrl: null, logged: false, covered: true, coveredBy: ME },
      ],
    },
    saves: { poolRemaining: 2, poolSize: 3, mySaveAvailable: true },
    nextMilestone: { days: 14, remaining: 5 },
    ...overrides,
  };
}

describe('circle copy helpers (iOS parity)', () => {
  it('progress line matches iOS Today.progressLine', () => {
    expect(todayProgressLine(status().today!)).toBe('1 of 3 checked in today · 1 more keeps it alive');
    expect(todayProgressLine({ ...status().today!, loggedCount: 2, qualified: true })).toBe(
      '2 of 3 checked in today · streak safe for today 🔥'
    );
  });

  it('pool, milestone and close lines', () => {
    expect(savesPoolLine({ poolRemaining: 1, poolSize: 3, mySaveAvailable: true })).toBe('🛡️ 1 save left this week');
    expect(milestoneLine({ days: 14, remaining: 1 })).toBe('1 more day to a 14-day streak');
    expect(leftToCloseLine(status().today!)).toBe('2 left to close it');
    expect(leftToCloseLine({ ...status().today!, loggedCount: 3 })).toBe("Everyone's in today");
  });

  it('canCover: only others who have not counted, while my save is available', () => {
    const s = status();
    const [me, maya, jordan] = s.today!.members;
    expect(canCover(s, maya, ME)).toBe(true);
    expect(canCover(s, me, ME)).toBe(false); // logged (and me)
    expect(canCover(s, jordan, ME)).toBe(false); // already covered
    expect(canCover({ ...s, saves: { ...s.saves!, mySaveAvailable: false } }, maya, ME)).toBe(false);
  });

  it('dates and labels', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(daysLeft('2026-10-25T12:00:00Z', now)).toBe(3);
    expect(daysLeft('2026-10-01', now)).toBe(0);
    expect(durationLabel('2026-10-01', '2026-10-11')).toBe('10 days');
    expect(durationLabel('2026-10-03', '2027-01-30')).toBe('17 weeks');
    expect(durationLabel('2026-10-03', '2027-01-31')).toBe('17 weeks 1d');
    expect(circleTypeLabel('weight_loss')).toBe('Weight Loss');
    expect(circleTypeLabel('daily_calendar')).toBe('Daily Calendar');
  });
});

describe('SegmentedRing', () => {
  it('draws one arc per member and labels the count', () => {
    const { container } = render(<SegmentedRing filled={3} total={5} />);
    expect(screen.getByRole('img', { name: '3 of 5 in today' })).toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(5);
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });
});

describe('LeaderboardRow', () => {
  it('shows rank, You badge, today check and progress', async () => {
    const onClick = vi.fn();
    render(
      <ul>
        <LeaderboardRow
          rank={1}
          isYou
          isCreator
          checkedInToday
          onClick={onClick}
          entry={{ user_id: ME, display_name: 'Anki Rao', progress: 26, current_value: 91.4, target_value: 84, starting_value: 94.1 }}
        />
      </ul>
    );
    expect(screen.getByLabelText('Rank 1')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByLabelText('Checked in today')).toBeInTheDocument();
    expect(screen.getByText('26%')).toBeInTheDocument();
    expect(screen.getByText('91.4 kg → 84.0 kg goal')).toBeInTheDocument();
    expect(screen.getByText('2.7 kg of 10.1 kg')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('leaderboard-row'));
    expect(onClick).toHaveBeenCalled();
  });

  it('locks private members that are not you', () => {
    render(
      <ul>
        <LeaderboardRow rank={4} isYou={false} entry={{ user_id: 'x', display_name: 'Sam', progress: 0, is_public: false }} />
      </ul>
    );
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-row')).toBeDisabled();
  });
});

describe('CircleStreakLiveCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a skeleton while loading', () => {
    render(<CircleStreakLiveCard circleId="c1" status={null} />);
    expect(screen.getByTestId('circle-streak-skeleton')).toBeInTheDocument();
  });

  it('renders streak, today progress, member chips and Cover only for coverable members', async () => {
    const next = status({ today: { ...status().today!, loggedCount: 2, qualified: true } });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { created: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: next }), { status: 200 }));
    const onChanged = vi.fn();
    render(<CircleStreakLiveCard circleId="c1" status={status()} viewerId={ME} onChanged={onChanged} />);
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Best: 12 days')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 checked in today · 1 more keeps it alive')).toBeInTheDocument();
    expect(screen.getByText('🛡️ 2 saves left this week')).toBeInTheDocument();
    expect(screen.getByText('5 more days to a 14-day streak')).toBeInTheDocument();
    const cover = screen.getAllByRole('button', { name: /^Cover/ });
    expect(cover).toHaveLength(1);
    expect(cover[0]).toHaveAccessibleName('Cover Maya');

    await userEvent.setup().click(cover[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(next));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mobile/circles/c1/streak/save');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ coveredUserId: MAYA });
  });
});

describe('CircleListCard', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: status() }), { status: 200 })
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('links to the circle and shows the live "in today" ring and circle streak', async () => {
    render(
      <CircleListCard
        circle={{ id: 'c1', name: 'OakvilleBesties', type: 'weight_loss', participant_count: 3, end_date: '2099-01-01' }}
      />
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/fitcircles/c1');
    await waitFor(() => expect(screen.getByRole('img', { name: '1 of 3 in today' })).toBeInTheDocument());
    expect(screen.getByLabelText('9 day circle streak')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 in · 2 left to close it')).toBeInTheDocument();
    expect(screen.getByText('1 more keeps it alive')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/mobile/circles/c1/streak', expect.objectContaining({ credentials: 'include' }));
  });

  it('falls back to the member count when the streak call fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('{}', { status: 500 }));
    render(<CircleListCard circle={{ id: 'c2', name: 'Solo', participant_count: 2, end_date: '2099-01-01' }} />);
    await waitFor(() => expect(screen.getByRole('img', { name: '0 of 2 in today' })).toBeInTheDocument());
  });
});
