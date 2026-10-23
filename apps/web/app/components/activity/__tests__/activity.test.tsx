import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/exercise-log', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/useUnitPreference', () => ({ useUnitPreference: () => ({ unitSystem: 'metric' }) }));
vi.mock('@/stores/auth-store', () => {
  const state = { user: { id: 'u1', name: 'Anki', email: 'a@b.co' }, token: null };
  const useAuthStore = Object.assign((sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state), {
    getState: () => state,
  });
  return { useAuthStore };
});
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import type { ExerciseLog } from '@/lib/types/exercise';

import { normalizeExerciseList, normalizeExerciseStats, parseDateKey } from '../api';
import { CheckInHistoryList } from '../CheckInHistoryList';
import { weekDays } from '../StepsPanel';
import { WorkoutList, groupByDay } from '../WorkoutList';

function log(p: Partial<ExerciseLog>): ExerciseLog {
  return {
    id: 'x',
    user_id: 'u1',
    exercise_type: 'Walking',
    category: 'cardio',
    duration_minutes: 30,
    calories_burned: 120,
    calories_estimated: false,
    exercise_date: '2026-10-20',
    started_at: null,
    source: 'manual',
    distance_meters: null,
    avg_heart_rate: null,
    effort_level: null,
    location_type: null,
    workout_companion: null,
    body_areas: null,
    is_indoor: null,
    notes: null,
    healthkit_workout_id: null,
    source_device_name: null,
    ...p,
  } as ExerciseLog;
}

describe('activity api normalizers', () => {
  it('reads the { success, data: [...] } list envelope the route actually returns', () => {
    expect(normalizeExerciseList({ success: true, data: [log({ id: 'a' })] }).map((l) => l.id)).toEqual(['a']);
    expect(normalizeExerciseList({ exercises: [log({ id: 'b' })] }).map((l) => l.id)).toEqual(['b']);
    expect(normalizeExerciseList({ success: false })).toEqual([]);
  });

  it('reads stats from { data } or bare', () => {
    expect(normalizeExerciseStats({ data: { total_workouts: 5, total_minutes: 161 } })?.total_minutes).toBe(161);
    expect(normalizeExerciseStats({ total_workouts: 2 })?.total_workouts).toBe(2);
    expect(normalizeExerciseStats({ data: null })).toBeNull();
  });

  it('parses calendar days as local dates', () => {
    const d = parseDateKey('2026-10-23');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 23]);
  });
});

describe('groupByDay / weekDays', () => {
  it('groups newest day first', () => {
    const g = groupByDay([log({ id: '1', exercise_date: '2026-10-19' }), log({ id: '2', exercise_date: '2026-10-21' }), log({ id: '3', exercise_date: '2026-10-21' })], (l) => l.exercise_date);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([
      ['2026-10-21', 2],
      ['2026-10-19', 1],
    ]);
  });

  it('builds a Monday-start week', () => {
    const days = weekDays(new Date(2026, 9, 22)); // Thu
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getDate()).toBe(19);
    expect(days).toHaveLength(7);
  });
});

describe('WorkoutList', () => {
  const logs = [
    log({ id: '1', exercise_type: 'Walking', category: 'cardio', exercise_date: '2026-10-21', source: 'healthkit', distance_meters: 3200 }),
    log({ id: '2', exercise_type: 'Yoga', category: 'flexibility', exercise_date: '2026-10-19' }),
  ];

  it('renders day groups, metric pills and the Health heart', () => {
    render(<WorkoutList logs={logs} loading={false} onDelete={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getAllByTestId('workout-row')).toHaveLength(2);
    const walking = screen.getAllByTestId('workout-row')[0];
    expect(within(walking).getByText('30min')).toBeInTheDocument();
    expect(within(walking).getByText('3.2 km')).toBeInTheDocument();
    expect(within(walking).getByLabelText('Synced from Health')).toBeInTheDocument();
  });

  it('filters by category chip', async () => {
    const user = userEvent.setup();
    render(<WorkoutList logs={logs} loading={false} onDelete={vi.fn()} onAdd={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Flexibility & Mobility' }));
    expect(screen.getAllByTestId('workout-row')).toHaveLength(1);
    expect(screen.getByText('Yoga')).toBeInTheDocument();
  });

  it('shows the empty state with an add action', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<WorkoutList logs={[]} loading={false} onDelete={vi.fn()} onAdd={onAdd} />);
    await user.click(screen.getByRole('button', { name: /log a workout/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('CheckInHistoryList', () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({
    id: `r${i}`,
    tracking_date: `2026-10-${String(22 - i).padStart(2, '0')}`,
    weight_kg: 91 + i / 10,
    steps: 8000 + i,
    mood_score: 7,
    energy_level: 6,
    created_at: '2026-10-22T10:00:00Z',
  }));

  it('caps at pageSize and expands with Show more', async () => {
    const user = userEvent.setup();
    render(<CheckInHistoryList rows={rows} pageSize={5} />);
    expect(screen.getAllByTestId('checkin-row')).toHaveLength(5);
    await user.click(screen.getByTestId('checkin-show-more'));
    expect(screen.getAllByTestId('checkin-row')).toHaveLength(10);
  });

  it('links to See all instead of expanding when seeAllHref is set', () => {
    render(<CheckInHistoryList rows={rows} pageSize={3} seeAllHref="/exercise-log?tab=checkins" title="Recent Check-Ins" />);
    expect(screen.getAllByTestId('checkin-row')).toHaveLength(3);
    expect(screen.queryByTestId('checkin-show-more')).toBeNull();
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/exercise-log?tab=checkins');
  });

  it('shows weight and steps per row', () => {
    render(<CheckInHistoryList rows={rows.slice(0, 1)} />);
    const row = screen.getByTestId('checkin-row');
    expect(within(row).getByText('91.0 kg')).toBeInTheDocument();
    expect(within(row).getByText('8,000 steps')).toBeInTheDocument();
  });
});
