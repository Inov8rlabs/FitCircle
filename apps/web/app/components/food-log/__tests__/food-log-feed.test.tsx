import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/services/food-log-service', () => ({ FoodLogService: { deleteEntry: vi.fn() } }));
vi.mock('@/lib/services/beverage-log-service', () => ({ BeverageLogService: { deleteEntry: vi.fn() } }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/nutrition/FitzyLauncher', () => ({ FitzyLauncher: () => null }));

import { FoodLogFeed } from '../food-log-feed';

const today = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const entries = [
  { id: 'b', entry_type: 'food', meal_type: 'breakfast', title: 'Poha', entry_date: key, logged_at: `${key}T08:00:00`, nutrition_data: { calories: 532, protein_g: 12 } },
  { id: 'w1', entry_type: 'water', water_ml: 250, entry_date: key, logged_at: `${key}T09:00:00` },
  { id: 'w2', category: 'water', volume_ml: 500, entry_date: key, logged_at: `${key}T11:00:00` },
];

describe('FoodLogFeed', () => {
  it('renders a day section with meal cards and one folded water card', async () => {
    const user = userEvent.setup();
    render(<FoodLogFeed entries={entries} userId="u1" summary={<p>summary slot</p>} nutrition={<p>nutrition slot</p>} />);

    expect(screen.getByText('summary slot')).toBeInTheDocument();
    expect(screen.getByText('nutrition slot')).toBeInTheDocument();
    const day = screen.getByTestId('food-day');
    expect(within(day).getByText('Today')).toBeInTheDocument();
    expect(within(day).getByText('Breakfast')).toBeInTheDocument();
    expect(within(day).getByText('532 kcal')).toBeInTheDocument();

    const water = screen.getByTestId('water-day-card');
    expect(within(water).getByText('750 ml')).toBeInTheDocument();
    expect(screen.queryAllByTestId('water-log-row')).toHaveLength(0);
    await user.click(within(water).getByRole('button', { name: /water, 750 ml, 2 logs/i }));
    expect(screen.getAllByTestId('water-log-row')).toHaveLength(2);
  });

  it('filters with the iOS chips', async () => {
    const user = userEvent.setup();
    render(<FoodLogFeed entries={entries} userId="u1" />);
    await user.click(screen.getByTestId('food-filter-water'));
    expect(screen.queryByTestId('meal-card')).toBeNull();
    expect(screen.getByTestId('water-day-card')).toBeInTheDocument();
    await user.click(screen.getByTestId('food-filter-meals'));
    expect(screen.getAllByTestId('meal-card')).toHaveLength(1);
    expect(screen.queryByTestId('water-day-card')).toBeNull();
  });

  it('shows the empty state with no entries', () => {
    render(<FoodLogFeed entries={[]} userId="u1" />);
    expect(screen.getByText('No entries yet')).toBeInTheDocument();
  });
});
