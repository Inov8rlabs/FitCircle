/**
 * Settings → Privacy → Meals (docs/FOOD_ENTRY_PRIVACY_SPEC.md §2.4, §2.5).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  getMealSharingDefault: vi.fn(),
  setMealSharingDefault: vi.fn(),
  makeAllMealsPrivate: vi.fn(),
}));
const track = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api/nutrition-client', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, nutritionClient: client };
});
vi.mock('@/lib/analytics', async () => {
  const { AnalyticsEvents } = await import('@/lib/analytics/events.generated');
  return { AnalyticsEvents, analytics: { track } };
});
vi.mock('sonner', () => ({ toast }));

import { MealSharingSettings } from '@/components/profile/meal-sharing-settings';
import { __resetMealSharingDefaultCache, cachedMealSharingDefault } from '@/lib/food-sharing';

const defaultSwitch = () => screen.getByRole('switch', { name: 'Share new meals with my circles' });

beforeEach(() => {
  __resetMealSharingDefaultCache();
  Object.values(client).forEach((f) => f.mockReset());
  track.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  client.getMealSharingDefault.mockResolvedValue({ share_meals_with_circles: false });
});

describe('Share new meals with my circles', () => {
  it('loads the default (off) and saves a change through PUT', async () => {
    client.setMealSharingDefault.mockResolvedValue({ share_meals_with_circles: true });
    render(<MealSharingSettings />);
    await waitFor(() => expect(defaultSwitch()).not.toBeDisabled());
    expect(defaultSwitch()).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(defaultSwitch());
    await waitFor(() => expect(client.setMealSharingDefault).toHaveBeenCalledWith(true));
    await waitFor(() => expect(defaultSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(track).toHaveBeenCalledWith({
      name: 'Meal Sharing Default Changed',
      properties: { enabled: true, source: 'settings' },
    });
    // New logging surfaces start from the saved value.
    expect(cachedMealSharingDefault()).toBe(true);
  });

  it('reverts when the save fails', async () => {
    client.setMealSharingDefault.mockRejectedValue(new Error('nope'));
    render(<MealSharingSettings />);
    await waitFor(() => expect(defaultSwitch()).not.toBeDisabled());
    fireEvent.click(defaultSwitch());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(defaultSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(track).not.toHaveBeenCalled();
  });
});

describe('Make all past meals private', () => {
  it('asks for confirmation, then runs the bulk action', async () => {
    client.makeAllMealsPrivate.mockResolvedValue({ entries_made_private: 12, posts_removed: 9 });
    render(<MealSharingSettings />);
    fireEvent.click(screen.getByTestId('privacy-make-all-private'));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Make all past meals private?');
    expect(client.makeAllMealsPrivate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('make-all-private-confirm'));
    await waitFor(() => expect(client.makeAllMealsPrivate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({
        name: 'Meal Privacy Changed',
        properties: { surface: 'settings_bulk', to: 'private', entry_count: 12 },
      })
    );
    expect(toast.success).toHaveBeenCalledWith('12 meals are now private');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('does nothing when cancelled', async () => {
    render(<MealSharingSettings />);
    fireEvent.click(screen.getByTestId('privacy-make-all-private'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(client.makeAllMealsPrivate).not.toHaveBeenCalled();
  });
});
