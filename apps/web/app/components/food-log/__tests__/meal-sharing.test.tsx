/**
 * Food entry privacy on web (docs/FOOD_ENTRY_PRIVACY_SPEC.md §6.3): the
 * "Share with my circles" control on every logging surface and on edit.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  getMealSharingDefault: vi.fn(),
  setMealSharingDefault: vi.fn(),
  makeAllMealsPrivate: vi.fn(),
  setEntrySharing: vi.fn(),
  createFoodLog: vi.fn(),
  updateFoodLog: vi.fn(),
  uploadFoodLogImages: vi.fn(),
  photoParse: vi.fn(),
  estimateItem: vi.fn(),
}));
const track = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const supabaseAuth = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })),
  getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
}));

vi.mock('@/lib/api/nutrition-client', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, nutritionClient: client };
});
vi.mock('@/lib/analytics', async () => {
  const { AnalyticsEvents } = await import('@/lib/analytics/events.generated');
  return { AnalyticsEvents, analytics: { track } };
});
vi.mock('@/lib/analytics/meal', () => ({ trackedPhotoParse: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), back: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: any) => <img alt={p.alt} src={typeof p.src === 'string' ? p.src : ''} /> }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: supabaseAuth } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/streaks/auto-claim-events', () => ({
  announceStreakAutoClaim: vi.fn(),
  clientTimezone: () => 'UTC',
  extractStreakMeta: () => null,
}));

import { FoodLogEntryForm } from '@/components/food-log/food-log-entry-form';
import { MealSharingControl } from '@/components/food-log/meal-sharing-control';
import { NutritionDetailDialog } from '@/components/food-log/nutrition-detail-dialog';
import { NutritionConfirm } from '@/components/nutrition/NutritionConfirm';
import type { NutritionDraft } from '@/lib/api/nutrition-client';
import { __resetMealSharingDefaultCache, isEntryShared } from '@/lib/food-sharing';

const draft: NutritionDraft = {
  items: [
    { name: 'Oatmeal', quantity: 1, quantityRange: null, servingUnit: 'cup', calories: 300, proteinG: 10, carbsG: 50, fatG: 5, confidence: 0.9 },
  ],
  overallConfidence: 0.9,
  notes: null,
  inputMethod: 'photo',
  nutritionSource: 'llm_vision',
  model: 'm',
  cached: false,
  totals: { calories: 300, proteinG: 10, carbsG: 50, fatG: 5 },
  healthScore: null,
} as NutritionDraft;

const chipText = (testId: string) => screen.getByTestId(`${testId}-chip`).textContent;

beforeEach(() => {
  __resetMealSharingDefaultCache();
  Object.values(client).forEach((f) => f.mockReset());
  track.mockReset();
  refresh.mockReset();
  client.createFoodLog.mockResolvedValue({ id: 'new-1', streak: null });
  client.updateFoodLog.mockResolvedValue({ id: 'e1' });
  client.setEntrySharing.mockResolvedValue({ id: 'e1' });
});

describe('isEntryShared', () => {
  it('is shared only when is_private is false AND visibility is circle/shared', () => {
    expect(isEntryShared({ is_private: false, visibility: 'circle' })).toBe(true);
    expect(isEntryShared({ is_private: false, visibility: 'shared' })).toBe(true);
    expect(isEntryShared({ is_private: false, visibility: 'private' })).toBe(false);
    expect(isEntryShared({ is_private: true, visibility: 'circle' })).toBe(false);
    expect(isEntryShared({ visibility: 'circle' })).toBe(false);
    expect(isEntryShared(null)).toBe(false);
  });
});

describe('MealSharingControl', () => {
  it('shows the state as a chip and has an accessible switch', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MealSharingControl shared={false} onChange={onChange} />);
    expect(chipText('meal-sharing-control')).toBe('Private');
    const sw = screen.getByRole('switch', { name: 'Share with my circles' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<MealSharingControl shared onChange={onChange} />);
    expect(chipText('meal-sharing-control')).toBe('Shared with circles');
  });
});

describe('NutritionConfirm — new meal (photo / voice)', () => {
  it('starts private and sends share_with_circles:false when the default is off', async () => {
    client.getMealSharingDefault.mockResolvedValue({ share_meals_with_circles: false });
    render(<NutritionConfirm draft={draft} method="photo_camera" />);
    await waitFor(() => expect(client.getMealSharingDefault).toHaveBeenCalled());
    expect(chipText('confirm-sharing')).toBe('Private');

    fireEvent.click(screen.getByRole('button', { name: /Confirm & log/ }));
    await waitFor(() => expect(client.createFoodLog).toHaveBeenCalled());
    expect(client.createFoodLog.mock.calls[0][0]).toMatchObject({ entry_type: 'food', share_with_circles: false });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Meal Logged', properties: expect.objectContaining({ is_shared: false }) })
      )
    );
  });

  it('follows the user default when it is on', async () => {
    client.getMealSharingDefault.mockResolvedValue({ share_meals_with_circles: true });
    render(<NutritionConfirm draft={draft} />);
    await waitFor(() => expect(chipText('confirm-sharing')).toBe('Shared with circles'));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & log/ }));
    await waitFor(() => expect(client.createFoodLog).toHaveBeenCalled());
    expect(client.createFoodLog.mock.calls[0][0]).toMatchObject({ share_with_circles: true });
  });

  it('stays private when the default cannot be loaded, and the user can still share', async () => {
    client.getMealSharingDefault.mockRejectedValue(new Error('offline'));
    render(<NutritionConfirm draft={draft} />);
    await waitFor(() => expect(client.getMealSharingDefault).toHaveBeenCalled());
    expect(chipText('confirm-sharing')).toBe('Private');
    fireEvent.click(screen.getByRole('switch', { name: 'Share with my circles' }));
    expect(chipText('confirm-sharing')).toBe('Shared with circles');
    fireEvent.click(screen.getByRole('button', { name: /Confirm & log/ }));
    await waitFor(() => expect(client.createFoodLog).toHaveBeenCalled());
    expect(client.createFoodLog.mock.calls[0][0]).toMatchObject({ share_with_circles: true });
  });
});

describe('NutritionConfirm — editing a saved meal', () => {
  it('seeds from the entry and PATCHes the changed choice', async () => {
    render(<NutritionConfirm draft={draft} editEntry={{ id: 'e1', mealType: 'lunch', shared: true }} />);
    expect(chipText('confirm-sharing')).toBe('Shared with circles');
    // The edit path never needs the new-meal default.
    expect(client.getMealSharingDefault).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('switch', { name: 'Share with my circles' }));
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(client.updateFoodLog).toHaveBeenCalled());
    expect(client.updateFoodLog).toHaveBeenCalledWith('e1', expect.objectContaining({ share_with_circles: false }));
    expect(client.createFoodLog).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({
        name: 'Meal Privacy Changed',
        properties: { surface: 'edit_screen', to: 'private' },
      })
    );
  });

  it('sends the unchanged choice on every edit without a privacy event', async () => {
    render(<NutritionConfirm draft={draft} editEntry={{ id: 'e1', shared: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(client.updateFoodLog).toHaveBeenCalled());
    expect(client.updateFoodLog.mock.calls[0][1]).toMatchObject({ share_with_circles: false });
    expect(track.mock.calls.some(([e]) => e.name === 'Meal Privacy Changed')).toBe(false);
  });
});

describe('NutritionDetailDialog — entry detail toggle', () => {
  const foodEntry = {
    id: 'e1',
    entry_type: 'food',
    title: 'Pasta',
    is_private: false,
    visibility: 'circle',
    nutrition_data: { calories: 600 },
  };

  async function open(entry: Record<string, unknown>) {
    const view = render(
      <NutritionDetailDialog entry={entry}>
        <button type="button">open</button>
      </NutritionDetailDialog>
    );
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    return view;
  }

  it('makes a shared meal private with share_with_circles:false', async () => {
    await open(foodEntry);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('detail-sharing-chip').textContent).toBe('Shared with circles');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Share with my circles' }));
    await waitFor(() => expect(client.setEntrySharing).toHaveBeenCalledWith('e1', false));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith({
        name: 'Meal Privacy Changed',
        properties: { surface: 'entry_detail', to: 'private' },
      })
    );
    expect(within(dialog).getByTestId('detail-sharing-chip').textContent).toBe('Private');
    expect(refresh).toHaveBeenCalled();
  });

  it('reverts and shows an error when the server refuses', async () => {
    client.setEntrySharing.mockRejectedValue(new Error('Server said no'));
    await open({ ...foodEntry, is_private: true, visibility: 'private' });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Share with my circles' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Server said no'));
    expect(within(dialog).getByTestId('detail-sharing-chip').textContent).toBe('Private');
    expect(track).not.toHaveBeenCalled();
  });

  it('offers no sharing control on water', async () => {
    await open({ id: 'w1', entry_type: 'water', title: 'Water', is_private: true, visibility: 'private' });
    expect(screen.queryByTestId('detail-sharing')).not.toBeInTheDocument();
  });
});

describe('FoodLogEntryForm — manual meal', () => {
  it('shows the control for meals and sends share_with_circles from it', async () => {
    client.getMealSharingDefault.mockResolvedValue({ share_meals_with_circles: false });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { id: 'n1' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<FoodLogEntryForm variant="sheet" onSaved={vi.fn()} />);
      await waitFor(() => expect(client.getMealSharingDefault).toHaveBeenCalled());
      expect(chipText('meal-sharing-control')).toBe('Private');
      fireEvent.click(screen.getByRole('switch', { name: 'Share with my circles' }));
      fireEvent.click(screen.getByRole('button', { name: /Save Entry/ }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/mobile/food-log');
      expect(JSON.parse(String(init.body))).toMatchObject({ entry_type: 'food', share_with_circles: true, is_private: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
