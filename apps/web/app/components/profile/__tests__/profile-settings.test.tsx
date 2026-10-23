import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/profile' }));
vi.mock('@/components/layout/navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/nutrition/FitzyLauncher', () => ({ FitzyLauncher: () => null }));
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ isPro: false, entitlements: { subscriptionsEnabled: true }, isLoading: false }),
}));
vi.mock('@/hooks/useUnitPreference', () => ({
  useUnitPreference: () => ({ unitSystem: 'metric', setUnitSystem: vi.fn(), isLoading: false }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { goals: [{ type: 'steps', daily_steps_target: 8000 }] }, error: null }) }),
      }),
    }),
  },
}));

const logout = vi.fn(async () => {});
const user = { id: 'u1', name: 'Anki Rao', username: 'anki', email: 'a@b.co', streak: 5, level: 4, xp: 1240, isPremium: false, joinedAt: '2026-08-01' };
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user, logout }) }));

import ProfilePage from '../../../profile/page';
import SettingsPage from '../../../settings/page';

describe('Settings hub', () => {
  beforeEach(() => {
    push.mockReset();
    logout.mockClear();
  });

  it('renders the iOS section order and signs out', async () => {
    const u = userEvent.setup();
    render(<SettingsPage />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Subscription',
      'Health & Data',
      'Notifications',
      'Privacy & Safety',
      'Display',
      'Support & Legal',
      'Account',
    ]);
    expect(screen.getByRole('link', { name: /Notification Preferences/ })).toHaveAttribute('href', '/settings/notifications');
    await u.click(screen.getByTestId('settings-sign-out'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(logout).toHaveBeenCalled();
  });
});

describe('Profile', () => {
  it('shows the header, stats strip and opens the steps goal sheet', async () => {
    const u = userEvent.setup();
    render(<ProfilePage />);
    expect(screen.getByTestId('profile-header')).toHaveTextContent('Anki Rao');
    expect(screen.getByTestId('profile-header')).toHaveTextContent('@anki');
    expect(screen.getByTestId('profile-stats')).toHaveTextContent('1,240');
    await waitFor(() => expect(screen.getByTestId('row-steps-goal')).toHaveTextContent('8,000'));
    await u.click(screen.getByTestId('row-steps-goal'));
    expect(await screen.findByRole('dialog', { name: 'Daily steps goal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Steps per day')).toHaveValue(8000);
  });

  it('opens Edit Profile in a sheet with the current values', async () => {
    const u = userEvent.setup();
    render(<ProfilePage />);
    await u.click(screen.getByTestId('edit-profile'));
    expect(await screen.findByRole('dialog', { name: 'Edit Profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Full Name')).toHaveValue('Anki Rao');
  });
});
