import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  formatEntryDay,
  formatMetricValue,
  formatWeightChange,
  type MemberCircleProgress,
} from '../member-progress-format';
import { MemberProgressPanel } from '../MemberProgressPanel';

const EMPTY_SUMMARY = {
  total: null,
  daily_average: null,
  days_logged: 0,
  best_day: null,
  today_value: null,
  goal: null,
  progress_percentage: null,
  starting: null,
  current: null,
  target: null,
  change: null,
};

const STEPS: MemberCircleProgress = {
  metric: 'steps',
  unit: 'steps',
  label: 'Steps',
  can_view: true,
  hidden_reason: null,
  today: '2026-11-05',
  summary: {
    ...EMPTY_SUMMARY,
    total: 28797,
    daily_average: 7199,
    days_logged: 4,
    best_day: { date: '2026-11-02', value: 10109 },
    today_value: 3007,
    goal: 224000,
    progress_percentage: 12.9,
  },
  entries: [
    { id: '4', date: '2026-11-05', value: 3007, change: -6123, is_public: true, note: null },
    { id: '3', date: '2026-11-04', value: 9130, change: 2579, is_public: true, note: null },
    { id: '2', date: '2026-11-03', value: 6551, change: -3558, is_public: true, note: null },
    { id: '1', date: '2026-11-02', value: 10109, change: null, is_public: true, note: null },
  ],
};

const WEIGHT: MemberCircleProgress = {
  metric: 'weight',
  unit: 'kg',
  label: 'Weight',
  can_view: true,
  hidden_reason: null,
  today: '2026-11-05',
  summary: { ...EMPTY_SUMMARY, days_logged: 3, starting: 94, current: 89, target: 84, change: -5, progress_percentage: 50 },
  entries: [
    { id: 'c', date: '2026-11-05', value: 89.4, change: 0.4, is_public: true, note: null },
    { id: 'b', date: '2026-11-04', value: 89, change: -5, is_public: true, note: null },
    { id: 'a', date: '2026-11-01', value: 94, change: null, is_public: true, note: null },
  ],
};

describe('member progress formatting', () => {
  it('steps stay steps — never converted, never lb/kg', () => {
    expect(formatMetricValue(10109, 'steps', 'steps', 'imperial')).toBe('10,109 steps');
    expect(formatMetricValue(45, 'workout_minutes', 'min', 'imperial')).toBe('45 min');
    expect(formatMetricValue(120, 'custom', 'reps', 'imperial')).toBe('120 reps');
  });

  it('weight follows the viewer\'s units', () => {
    expect(formatMetricValue(89, 'weight', 'kg', 'imperial')).toBe('196.2 lbs');
    expect(formatMetricValue(89, 'weight', 'kg', 'metric')).toBe('89.0 kg');
  });

  it('weight change: negative = lost, positive = gained', () => {
    expect(formatWeightChange(-5, 'metric')).toEqual({ text: 'Lost 5.0 kg', direction: 'lost' });
    expect(formatWeightChange(0.4, 'imperial')).toEqual({ text: 'Gained 0.9 lbs', direction: 'gained' });
    expect(formatWeightChange(0, 'metric').direction).toBe('same');
  });

  it('date-only days: Today / Yesterday / "Nov 4" — never a time', () => {
    expect(formatEntryDay('2026-11-05', '2026-11-05')).toBe('Today');
    expect(formatEntryDay('2026-11-04', '2026-11-05')).toBe('Yesterday');
    expect(formatEntryDay('2026-11-02', '2026-11-05')).toBe('Nov 2');
    expect(formatEntryDay('2025-12-31', '2026-01-02')).toBe('Dec 31, 2025');
    expect(formatEntryDay('2026-11-01', '2026-11-01')).not.toMatch(/AM|PM|:/);
  });
});

describe('<MemberProgressPanel>', () => {
  it('steps circle: steps card and steps history, no weight wording or units', () => {
    const { container } = render(<MemberProgressPanel progress={STEPS} unitSystem="imperial" />);

    expect(screen.getByTestId('member-progress-steps')).toBeInTheDocument();
    expect(screen.getAllByText('28,797 steps').length).toBeGreaterThan(0);
    const list = screen.getByTestId('member-progress-entries');
    expect(within(list).getByText('10,109 steps')).toBeInTheDocument();
    expect(within(list).getByText('Today')).toBeInTheDocument();
    expect(within(list).getByText('Yesterday')).toBeInTheDocument();
    expect(within(list).getByText('Nov 2')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/lbs|kg|Weight|Lost|12:00/);
  });

  it('weight circle in lbs: start / current / target converted, lost vs gained per entry', () => {
    render(<MemberProgressPanel progress={WEIGHT} unitSystem="imperial" />);

    expect(screen.getByText('Weight progress')).toBeInTheDocument();
    expect(screen.getByText('207.2')).toBeInTheDocument(); // 94 kg
    expect(screen.getByText('196.2')).toBeInTheDocument(); // 89 kg
    expect(screen.getByTestId('member-weight-change')).toHaveTextContent('Lost 11.0 lbs since the start');
    const list = screen.getByTestId('member-progress-entries');
    expect(within(list).getByText('Gained 0.9 lbs')).toBeInTheDocument();
    expect(within(list).getByText('Lost 11.0 lbs')).toBeInTheDocument();
  });

  it('weight circle in kg', () => {
    render(<MemberProgressPanel progress={WEIGHT} unitSystem="metric" />);
    expect(within(screen.getByTestId('member-progress-entries')).getByText('89.4 kg')).toBeInTheDocument();
  });

  it('hidden progress shows the reason and no values', () => {
    const { container } = render(
      <MemberProgressPanel
        progress={{ ...WEIGHT, can_view: false, hidden_reason: 'weight_private', entries: [], summary: EMPTY_SUMMARY }}
        unitSystem="imperial"
      />
    );
    expect(screen.getByText('Weight is private')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('a circle without a shared metric says so', () => {
    render(
      <MemberProgressPanel progress={{ ...STEPS, metric: 'none', unit: null, entries: [], summary: EMPTY_SUMMARY }} unitSystem="metric" />
    );
    expect(screen.getByText('No shared progress for this circle yet.')).toBeInTheDocument();
  });
});
