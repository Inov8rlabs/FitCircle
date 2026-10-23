import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchHomeFeed, stub } = vi.hoisted(() => ({
  fetchHomeFeed: vi.fn(),
  stub: (name: string) => () => <div data-stub={name}>{name}</div>,
}));
vi.mock('@/lib/home-feed/feed-layout', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchHomeFeed: () => fetchHomeFeed(),
}));

vi.mock('@/components/layout/navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/nutrition/FitzyLauncher', () => ({ FitzyLauncher: () => null }));
vi.mock('@/components/campaigns/DashboardCampaignCard', () => ({ DashboardCampaignCard: stub('campaign') }));
vi.mock('@/components/body-composition/dashboard-card', () => ({ BodyCompDashboardCard: stub('body_comp') }));
vi.mock('@/components/home/ExtraCards', () => ({
  FitzyFocusCard: stub('fitzy_focus'),
  ReferralHomeCard: () => null, // program off → collapses
  ProUpsellCard: stub('pro_upsell'),
  PastDateRow: stub('past_date_log'),
}));
vi.mock('@/components/home/HydrationCard', () => ({ HydrationCard: stub('hydration'), HydrationCardSkeleton: stub('hydration_skeleton') }));
vi.mock('@/components/home/StreakCard', () => ({ StreakCard: stub('streak') }));
vi.mock('@/components/home/WeekStepsCard', () => ({ WeekStepsCard: stub('week') }));
vi.mock('@/components/home/ProgressCards', () => ({ ProgressCards: stub('progress') }));
vi.mock('@/components/home/TrendsCard', () => ({ WeightTrendCard: stub('trend') }));
vi.mock('@/components/activity', () => ({ CheckInHistoryList: stub('recent') }));
vi.mock('@/components/home/QuickLogSheet', () => ({ QuickLogSheet: () => null }));
vi.mock('@/components/vitals/BmiScaleCard', () => ({ BmiScaleCard: stub('vitals') }));
vi.mock('@/components/vitals/VitalsGoalDialog', () => ({ VitalsGoalDialog: () => null }));
vi.mock('@/components/vitals/useVitals', () => ({
  useVitals: () => ({ summary: { water: {} }, loading: false, error: null, refresh: vi.fn(), saveGoals: vi.fn(), logWater: vi.fn() }),
}));
vi.mock('@/components/home/useTracking', () => ({
  isoDay: () => '2026-10-22',
  useTracking: () => ({ rows: [], goals: { stepsGoal: 10000 }, loading: false, reload: vi.fn(), saveDay: vi.fn(), today: undefined, latestWeight: undefined }),
}));
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ isPro: false, isLoading: false }) }));
vi.mock('@/hooks/useUnitPreference', () => ({ useUnitPreference: () => ({ unitSystem: 'metric', setUnitSystem: vi.fn(), isLoading: false }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', name: 'Anki Rao' } }) }));

import DashboardPage from '../page';

const visibleOrder = () =>
  // Cards that self-gate render an empty wrapper, which the feed hides (div:empty).
  Array.from(document.querySelectorAll('[data-testid="home-feed"] > [data-card]'))
    .filter((el) => el.childElementCount > 0)
    .map((el) => el.getAttribute('data-card'));

describe('dashboard home feed', () => {
  beforeEach(() => fetchHomeFeed.mockReset());

  it('greets by first name and renders the built-in iOS order when the feed is unavailable', async () => {
    fetchHomeFeed.mockResolvedValue(null);
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, Anki!');
    await waitFor(() => expect(fetchHomeFeed).toHaveBeenCalled());
    // referral collapses (renders nothing) and streak_warning has no web source.
    expect(visibleOrder()).toEqual(['hydration', 'pro_upsell', 'daily_goals', 'fitzy_focus', 'progress', 'vitals', 'body_comp', 'past_date_log', 'charts']);
    expect(screen.getByTestId('home-feed')).toHaveAttribute('data-layout-source', 'default');
  });

  it('renders the server order when the feed answers', async () => {
    fetchHomeFeed.mockResolvedValue({
      source: 'server',
      layoutKey: 'default-v1+water_first.treatment',
      decisionId: 'd1',
      cards: ['header', 'progress', 'hydration', 'campaign'].map((t) => ({ id: t, type: t, version: 1 })),
    });
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId('home-feed')).toHaveAttribute('data-layout-source', 'server'));
    expect(visibleOrder()).toEqual(['progress', 'hydration', 'campaign']);
  });
});
