import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({
  analytics: { track: vi.fn() },
  AnalyticsEvents: { weightLogged: (p: unknown) => ({ name: 'Weight Logged', p }), stepsLogged: (p: unknown) => ({ name: 'Steps Logged', p }) },
}));
vi.mock('@/components/nutrition/FitzyLauncher', () => ({ FitzyLauncher: () => null }));

import type { VitalsWater } from '@/lib/types/vitals';

import { amount, heroParts, microcopy, presets } from '../hydration-format';
import { HydrationCard } from '../HydrationCard';
import { QuickLogSheet } from '../QuickLogSheet';
import { compactSteps, weekDays } from '../week-steps';

const water = (today: number, goal = 2000): VitalsWater => ({
  goal_ml: goal,
  goal_source: 'default',
  days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${16 + i}`, ml: i === 6 ? today : 2100, goal_met: i !== 6 })),
  total_ml: 0,
  total_goal_ml: goal * 7,
  pct: 0,
  days_met: 6,
  today_ml: today,
});

describe('hydration-format (iOS HydrationFormat port)', () => {
  it('formats metric and imperial amounts', () => {
    expect(amount(750, 'metric')).toBe('750 ml');
    expect(amount(1250, 'metric')).toBe('1.25 L');
    expect(amount(1000, 'metric')).toBe('1 L');
    expect(amount(237, 'imperial')).toBe('8 oz');
    expect(heroParts(1500, 'metric')).toEqual({ value: '1.5', unit: 'L' });
  });

  it('uses the iOS presets and microcopy', () => {
    expect(presets('metric').map((p) => p.ml)).toEqual([250, 500, 750]);
    expect(presets('imperial').map((p) => amount(p.ml, 'imperial'))).toEqual(['8 oz', '16 oz', '24 oz']);
    expect(microcopy(0, 0)).toMatch(/Start with a glass/);
    expect(microcopy(0.6, 1200)).toBe('Halfway there');
    expect(microcopy(1.1, 2200)).toMatch(/Goal hit/);
  });
});

describe('HydrationCard', () => {
  it('adds a preset optimistically and keeps it when the log succeeds', async () => {
    const user = userEvent.setup();
    const onLogWater = vi.fn(async () => {});
    render(<HydrationCard water={water(500)} unitSystem="metric" onLogWater={onLogWater} onEditGoal={() => {}} />);
    expect(screen.getByTestId('hydration-today')).toHaveTextContent('500');
    await user.click(screen.getByTestId('water-preset-bottle'));
    expect(onLogWater).toHaveBeenCalledWith(500);
    expect(screen.getByTestId('hydration-today')).toHaveTextContent('1');
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('rolls the total back when logging fails', async () => {
    const user = userEvent.setup();
    const onLogWater = vi.fn(async () => {
      throw new Error('offline');
    });
    render(<HydrationCard water={water(500)} unitSystem="metric" onLogWater={onLogWater} onEditGoal={() => {}} />);
    await user.click(screen.getByTestId('water-preset-glass'));
    await waitFor(() => expect(screen.getByTestId('hydration-today')).toHaveTextContent('500'));
  });

  it('logs a custom amount from the sheet', async () => {
    const user = userEvent.setup();
    const onLogWater = vi.fn(async () => {});
    render(<HydrationCard water={water(0)} unitSystem="metric" onLogWater={onLogWater} onEditGoal={() => {}} />);
    await user.click(screen.getByTestId('water-preset-custom'));
    await user.type(screen.getByLabelText('Amount in ml'), '330');
    await user.click(screen.getByRole('button', { name: 'Add 330 ml' }));
    expect(onLogWater).toHaveBeenCalledWith(330);
  });

  it('shows Set goal only for the default goal and opens the goal editor', async () => {
    const user = userEvent.setup();
    const onEditGoal = vi.fn();
    render(<HydrationCard water={water(0)} unitSystem="metric" onLogWater={vi.fn()} onEditGoal={onEditGoal} />);
    await user.click(screen.getByRole('button', { name: 'Set goal' }));
    expect(onEditGoal).toHaveBeenCalled();
  });
});

describe('weekDays', () => {
  it('builds a Monday-first week with steps and today/future flags', () => {
    const now = new Date('2026-10-22T15:00:00Z'); // Thursday
    const days = weekDays([{ tracking_date: '2026-10-20', steps: 9100 }], 0, now);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-10-19');
    expect(days[1].steps).toBe(9100);
    expect(days.find((d) => d.isToday)?.date).toBe('2026-10-22');
    expect(days[6].isFuture).toBe(true);
    expect(weekDays([], -1, now)[0].date).toBe('2026-10-12');
  });

  it('compacts step counts', () => {
    expect(compactSteps(820)).toBe('820');
    expect(compactSteps(9100)).toBe('9.1k');
    expect(compactSteps(12000)).toBe('12k');
  });
});

describe('QuickLogSheet', () => {
  it('saves steps for today through onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(
      <QuickLogSheet open onOpenChange={onOpenChange} initialKind="steps" unitSystem="metric" onUnitChange={() => {}} onSave={onSave} />
    );
    await user.type(screen.getByTestId('quick-log-value'), '8000');
    await act(async () => {
      await user.click(screen.getByTestId('quick-log-save'));
    });
    expect(onSave).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), { steps: 8000 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('converts pounds to kg for weight', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    render(<QuickLogSheet open onOpenChange={() => {}} initialKind="weight" unitSystem="imperial" onUnitChange={() => {}} onSave={onSave} />);
    await user.type(screen.getByTestId('quick-log-value'), '200');
    await act(async () => {
      await user.click(screen.getByTestId('quick-log-save'));
    });
    const [, values] = onSave.mock.calls[0] as unknown as [string, { weight_kg: number }];
    expect(values.weight_kg).toBeCloseTo(90.7, 1);
  });

  it('opens on yesterday in past-date mode', () => {
    render(<QuickLogSheet open pastDate onOpenChange={() => {}} unitSystem="metric" onUnitChange={() => {}} onSave={vi.fn()} />);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(screen.getByTestId('quick-log-date')).toHaveValue(y.toISOString().split('T')[0]);
  });
});
