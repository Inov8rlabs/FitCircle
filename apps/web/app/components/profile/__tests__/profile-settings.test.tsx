import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Analytics from '@/lib/analytics';
import type * as ProfileClient from '@/lib/api/profile-client';

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
const updateUser = vi.fn();
const user = { id: 'u1', name: 'Anki Rao', username: 'anki', email: 'a@b.co', streak: 5, level: 4, xp: 1240, isPremium: false, joinedAt: '2026-08-01' };
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user, logout, updateUser }) }));

const updateProfileName = vi.fn();
vi.mock('@/lib/api/profile-client', async () => {
  const actual = await vi.importActual<typeof ProfileClient>('@/lib/api/profile-client');
  return { ...actual, updateProfileName: (...args: unknown[]) => updateProfileName(...args) };
});
const track = vi.fn();
vi.mock('@/lib/analytics', async () => {
  const actual = await vi.importActual<typeof Analytics>('@/lib/analytics');
  return { ...actual, analytics: { ...actual.analytics, track: (...args: unknown[]) => track(...args) } };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

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

  describe('changing your name', () => {
    beforeEach(() => {
      updateProfileName.mockReset();
      updateUser.mockReset();
      track.mockReset();
      toastSuccess.mockReset();
    });

    it('tapping the name in the header opens a prefilled name sheet with a counter', async () => {
      const u = userEvent.setup();
      render(<ProfilePage />);
      await u.click(screen.getByTestId('edit-name'));
      expect(await screen.findByRole('dialog', { name: 'Your name' })).toBeInTheDocument();
      expect(screen.getByLabelText('Display name')).toHaveValue('Anki Rao');
      expect(screen.getByTestId('display-name-count')).toHaveTextContent('8/40');
      expect(screen.getByTestId('save-name')).toBeDisabled(); // unchanged
    });

    it('the avatar and the Account > Name row open it too', async () => {
      const u = userEvent.setup();
      render(<ProfilePage />);
      await u.click(screen.getByTestId('row-name'));
      expect(await screen.findByRole('dialog', { name: 'Your name' })).toBeInTheDocument();
    });

    it('validates inline and keeps Save disabled for an invalid name', async () => {
      const u = userEvent.setup();
      render(<ProfilePage />);
      await u.click(screen.getByTestId('edit-name'));
      const input = await screen.findByLabelText('Display name');
      await u.clear(input);
      await u.type(input, '   ');
      expect(screen.getByText('Enter a name')).toBeInTheDocument();
      expect(screen.getByTestId('save-name')).toBeDisabled();
      await u.clear(input);
      await u.type(input, 'x'.repeat(41));
      expect(screen.getByText('Names can be up to 40 characters')).toBeInTheDocument();
      expect(screen.getByTestId('save-name')).toBeDisabled();
    });

    it('saves optimistically, confirms, and tracks the event without the name', async () => {
      updateProfileName.mockResolvedValue({ displayName: 'Anki R', username: 'anki' });
      const u = userEvent.setup();
      render(<ProfilePage />);
      await u.click(screen.getByTestId('edit-name'));
      const input = await screen.findByLabelText('Display name');
      await u.clear(input);
      await u.type(input, '  Anki   R ');
      await u.click(screen.getByTestId('save-name'));
      await waitFor(() => expect(updateProfileName).toHaveBeenCalledWith({ displayName: 'Anki R' }));
      expect(updateUser).toHaveBeenNthCalledWith(1, { name: 'Anki R' });
      expect(updateUser).toHaveBeenLastCalledWith({ name: 'Anki R', username: 'anki' });
      expect(toastSuccess).toHaveBeenCalledWith('Name updated. Your circles now see "Anki R".');
      expect(track).toHaveBeenCalledWith({ name: 'Profile Name Changed', properties: { entry_point: 'profile_header' } });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your name' })).not.toBeInTheDocument());
    });

    it('rolls back and shows the server message when the save is rejected', async () => {
      const { ProfileApiError } = await import('@/lib/api/profile-client');
      updateProfileName.mockRejectedValue(
        new ProfileApiError('Names can\'t contain < or >', 400, 'VALIDATION_ERROR', { displayName: "Names can't contain < or >" })
      );
      const u = userEvent.setup();
      render(<ProfilePage />);
      await u.click(screen.getByTestId('edit-name'));
      const input = await screen.findByLabelText('Display name');
      await u.clear(input);
      await u.type(input, 'New Name');
      await u.click(screen.getByTestId('save-name'));
      expect(await screen.findByRole('alert')).toHaveTextContent("Names can't contain < or >");
      expect(updateUser).toHaveBeenLastCalledWith({ name: 'Anki Rao', username: 'anki' });
      expect(track).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Your name' })).toBeInTheDocument();
    });

    it('Edit Profile saves the name through the same path (edit_profile)', async () => {
      updateProfileName.mockResolvedValue({ displayName: 'Anki B', username: 'anki' });
      const u = userEvent.setup();
      render(<ProfilePage />);
      await u.click(screen.getByTestId('edit-profile'));
      const input = await screen.findByLabelText('Full Name');
      await u.clear(input);
      await u.type(input, 'Anki B');
      await u.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(updateProfileName).toHaveBeenCalledWith({ displayName: 'Anki B' }));
      expect(track).toHaveBeenCalledWith({ name: 'Profile Name Changed', properties: { entry_point: 'edit_profile' } });
    });
  });
});
