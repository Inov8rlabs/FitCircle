import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AnalyticsModule from '@/lib/analytics';
import type { ReferralHub } from '@/lib/referrals/types';

const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return { ...actual, analytics: { ...actual.analytics, track: (...args: unknown[]) => track(...args) } };
});
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-1' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { FriendsList } from '../FriendsList';
import { InviteHub, finePrint, trackActivationOnce } from '../InviteHub';

const fetchMock = vi.fn();
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}
const setStorage = (store: unknown) =>
  Object.defineProperty(window, 'localStorage', { value: store, configurable: true, writable: true });
const deadline = new Date(Date.now() + 5 * 86_400_000).toISOString();

function hub(extra: Partial<ReferralHub> & { activation?: { activated: boolean } } = {}): ReferralHub {
  return {
    enabled: true,
    code: 'SAM7K2',
    shareUrl: 'https://www.fitcircle.ai/i/SAM7K2',
    shareMessage: 'join me',
    program: { rewardDaysPerFriend: 7, lifetimeThreshold: 100, inviteeRewardDays: 7, attributionWindowDays: 7, qualifyingDays: 4 } as any,
    stats: { invited: 0, pending: 0, qualified: 0, daysEarned: 0, daysBanked: 0, hasLifetime: false, toLifetime: 100 },
    milestones: [],
    nextMilestone: null,
    invitees: [],
    invites: [],
    unseenRewards: [],
    canClaimCode: false,
    ...extra,
  } as ReferralHub;
}

beforeEach(() => {
  track.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setStorage(memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

const serve = (data: ReferralHub) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true, data, error: null, meta: null }), { status: 200 }));

describe('InviteHub v3', () => {
  it('uses program.qualifyingDays in how-it-works and fine print', async () => {
    serve(hub());
    render(<InviteHub />);
    expect(await screen.findByText(/They sign up with your link and check in on 4 different days\./)).toBeInTheDocument();
    expect(screen.getByText(finePrint(4))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/3 different days/);
  });

  it('shows the in-progress "Your free week" card with dots', async () => {
    serve(
      hub({
        myReward: { days: 2, required: 3, deadline, status: 'in_progress', rewardDays: 7, inviterFirstName: 'Maya' },
      } as any)
    );
    render(<InviteHub />);
    const card = await screen.findByTestId('my-reward-progress');
    expect(card).toHaveTextContent('Your free week');
    expect(card).toHaveTextContent('2 of 3 check-ins');
    expect(card).toHaveTextContent('1 more check-in unlocks a free week for you and Maya');
    expect(screen.getByRole('img', { name: '2 of 3 check-ins' }).querySelectorAll('span.rounded-full')).toHaveLength(3);
  });

  it('shows the unlocked state', async () => {
    serve(
      hub({
        myReward: { days: 3, required: 3, deadline, status: 'unlocked', rewardDays: 7, inviterFirstName: 'Maya' },
      } as any)
    );
    render(<InviteHub />);
    expect(await screen.findByTestId('my-reward-unlocked')).toHaveTextContent('Your free week of Pro is unlocked ✓');
  });

  it('fires User Activated once per user when activated', async () => {
    serve(hub({ activation: { activated: true, circleOf3: true, loggedDays3: true, reactionReceived: true, windowEndsAt: '2026-10-23T00:00:00Z' } }));
    const { unmount } = render(<InviteHub />);
    await waitFor(() => expect(track).toHaveBeenCalledWith({ name: 'User Activated', properties: {} }));
    unmount();
    track.mockClear();
    render(<InviteHub />);
    await screen.findByText(finePrint(4));
    expect(track).not.toHaveBeenCalledWith({ name: 'User Activated', properties: {} });
  });

  it('does not fire when not activated', async () => {
    serve(hub({ activation: { activated: false, circleOf3: false, loggedDays3: false, reactionReceived: false, windowEndsAt: '2026-10-23T00:00:00Z' } }));
    render(<InviteHub />);
    await screen.findByText(finePrint(4));
    expect(track).not.toHaveBeenCalledWith({ name: 'User Activated', properties: {} });
  });
});

describe('trackActivationOnce', () => {
  it('still fires when storage throws, and needs a user id', () => {
    expect(trackActivationOnce(null, true)).toBe(false);
    setStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(trackActivationOnce('u2', true)).toBe(true);
  });
});

describe('FriendsList progress', () => {
  it('renders a progress bar on joined rows only', () => {
    render(
      <FriendsList
        invites={[]}
        invitees={[
          { id: 'a', displayName: 'Sam', avatarUrl: null, status: 'pending', joinedAt: 'x', qualifiedAt: null, circleName: null, progress: { days: 2, required: 3, deadline } },
          { id: 'b', displayName: 'Lee', avatarUrl: null, status: 'qualified', joinedAt: 'x', qualifiedAt: 'y', circleName: null, progress: { days: 3, required: 3, deadline } },
        ]}
        onChanged={vi.fn()}
      />
    );
    const bars = screen.getAllByTestId('friend-progress');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveTextContent('2/3 check-ins');
    expect(screen.getByRole('progressbar', { name: 'Sam check-in progress' })).toHaveAttribute('aria-valuenow', '2');
    fireEvent.click(document.body);
  });
});
