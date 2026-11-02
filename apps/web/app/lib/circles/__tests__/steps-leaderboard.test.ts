import { describe, expect, it } from 'vitest';

import {
  buildStepsRows,
  challengeDailyStepGoal,
  competitionRanks,
  goalPercent,
  LEGACY_STEPS_UNIT,
  overlayLegacySteps,
  sortForMetric,
  stepsPeriod,
  type StepsMemberInput,
} from '../steps-leaderboard';

const member = (id: string, name: string, steps: Record<string, number>, extra: Partial<StepsMemberInput> = {}): StepsMemberInput => ({
  user_id: id,
  display_name: name,
  avatar_url: null,
  local_today: '2026-11-03',
  visible: true,
  daily_goal_steps: 8000,
  goal_source: 'challenge',
  steps_by_date: new Map(Object.entries(steps)),
  last_synced_at: null,
  synced_recently: true,
  joined_at: null,
  ...extra,
});

describe('stepsPeriod', () => {
  it('is upcoming the day before the start (end_date is exclusive)', () => {
    expect(stepsPeriod('2026-11-02', '2026-11-30', '2026-11-01')).toEqual({
      phase: 'upcoming', start_date: '2026-11-02', end_date: '2026-11-29', total_days: 28, day_number: null, days_until_start: 1,
    });
  });
  it('counts the day number while active', () => {
    const p = stepsPeriod('2026-11-02 00:00:00+00', '2026-11-30 00:00:00+00', '2026-11-03');
    expect(p.phase).toBe('active');
    expect(p.day_number).toBe(2);
  });
  it('is completed on end_date', () => {
    expect(stepsPeriod('2026-11-02', '2026-11-30', '2026-11-30').phase).toBe('completed');
  });
});

describe('challengeDailyStepGoal', () => {
  it('reads the daily step templates', () => {
    expect(challengeDailyStepGoal({ template_id: 'steps-8k-daily', unit: 'steps' })).toBe(8000);
    expect(challengeDailyStepGoal({ template_id: 'steps-10k-daily', unit: 'Steps' })).toBe(10000);
  });
  it('ignores totals, other units and custom challenges', () => {
    expect(challengeDailyStepGoal({ template_id: 'step-sprint', unit: 'steps' })).toBeNull();
    expect(challengeDailyStepGoal({ template_id: null, unit: 'steps' })).toBeNull();
    expect(challengeDailyStepGoal({ template_id: 'steps-8k-daily', unit: 'miles' })).toBeNull();
    expect(challengeDailyStepGoal(null)).toBeNull();
  });
});

describe('ranking', () => {
  it('uses competition ranking with nulls unranked', () => {
    const r = competitionRanks([
      { id: 'a', value: 10 }, { id: 'b', value: 30 }, { id: 'c', value: 10 }, { id: 'd', value: null }, { id: 'e', value: 5 },
    ]);
    expect(Object.fromEntries(r)).toEqual({ b: 1, a: 2, c: 2, e: 4, d: null });
  });
  it('goal percent is rounded and uncapped', () => {
    expect(goalPercent(12000, 8000)).toBe(150);
    expect(goalPercent(1, 3)).toBe(33);
    expect(goalPercent(100, 0)).toBe(0);
  });
});

describe('buildStepsRows', () => {
  const period = stepsPeriod('2026-11-02', '2026-11-30', '2026-11-03');

  it('ranks today, total and % of goal independently', () => {
    const rows = buildStepsRows(period, 'me', [
      member('me', 'Ani', { '2026-11-02': 20000, '2026-11-03': 4000 }),
      member('b', 'Bea', { '2026-11-02': 1000, '2026-11-03': 9000 }),
      member('c', 'Cy', { '2026-11-03': 6000 }, { daily_goal_steps: 5000, goal_source: 'member' }),
      member('d', 'Dee', { '2026-11-01': 50000 }), // before the start: does not count
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(rows.map((r) => r.user_id)).toEqual(['b', 'c', 'me', 'd']);
    expect(by.me).toMatchObject({ is_me: true, today_steps: 4000, total_steps: 24000, goal_pct_today: 50, days_goal_met: 1 });
    expect(by.me.ranks).toEqual({ today_steps: 3, total_steps: 1, goal_pct_today: 3 });
    expect(by.c.ranks.goal_pct_today).toBe(1); // 120% of their own 5,000
    expect(by.b.ranks.goal_pct_today).toBe(2); // 113%
    expect(by.d).toMatchObject({ today_steps: 0, total_steps: 0, ranks: { today_steps: 4, total_steps: 4, goal_pct_today: 4 } });
    expect(by.me.days).toEqual([{ date: '2026-11-02', steps: 20000 }, { date: '2026-11-03', steps: 4000 }]);
    expect(by.c.days).toEqual([{ date: '2026-11-02', steps: null }, { date: '2026-11-03', steps: 6000 }]);
    expect(sortForMetric(rows, 'total_steps').map((r) => r.user_id)).toEqual(['me', 'b', 'c', 'd']);
  });

  it('hides a private member from everyone but themselves', () => {
    const rows = buildStepsRows(period, 'me', [
      member('me', 'Ani', { '2026-11-03': 100 }, { visible: false }),
      member('p', 'Pat', { '2026-11-03': 99999 }, { visible: false }),
    ]);
    const p = rows.find((r) => r.user_id === 'p')!;
    expect(p).toMatchObject({ steps_visible: false, today_steps: null, total_steps: null, goal_pct_today: null, days: [], steps_synced_recently: null });
    expect(p.ranks).toEqual({ today_steps: null, total_steps: null, goal_pct_today: null });
    expect(rows[0].user_id).toBe('me');
    expect(rows[0].ranks.today_steps).toBe(1);
  });

  it("uses each member's own local day", () => {
    const rows = buildStepsRows(period, 'me', [
      member('me', 'Ani', { '2026-11-03': 500 }),
      member('far', 'Far', { '2026-11-03': 7000, '2026-11-04': 300 }, { local_today: '2026-11-04' }),
      member('behind', 'Behind', { '2026-11-01': 7000 }, { local_today: '2026-11-01' }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(by.far.today_steps).toBe(300);
    expect(by.far.total_steps).toBe(7300);
    expect(by.behind).toMatchObject({ today_steps: 0, total_steps: 0, days: [] });
  });

  it('has no values or ranks before the start', () => {
    const upcoming = stepsPeriod('2026-11-02', '2026-11-30', '2026-11-01');
    const rows = buildStepsRows(upcoming, 'me', [member('me', 'Ani', { '2026-11-01': 9000 }, { local_today: '2026-11-01' })]);
    expect(rows[0]).toMatchObject({ today_steps: null, total_steps: null, goal_pct_today: null, days: [], steps_synced_recently: true });
    expect(rows[0].ranks.today_steps).toBeNull();
  });

  it('freezes on the last day once completed', () => {
    const done = stepsPeriod('2026-11-02', '2026-11-04', '2026-11-10');
    const rows = buildStepsRows(done, 'me', [
      member('me', 'Ani', { '2026-11-02': 1, '2026-11-03': 2, '2026-11-04': 400 }, { local_today: '2026-11-10' }),
    ]);
    expect(rows[0]).toMatchObject({ today_steps: 2, total_steps: 3 });
  });
});

describe('overlayLegacySteps (shipped apps)', () => {
  const period = stepsPeriod('2026-11-02', '2026-11-30', '2026-11-03');
  const legacy = (id: string, rank: number) => ({
    rank, user_id: id.toUpperCase(), display_name: id, progress_percentage: 0, current_value: 80, starting_value: 90,
    target_value: 70, goal_type: 'weight_loss', goal_unit: 'kg', streak_days: 0,
  });

  it('fills progress and the goal line from average daily steps and re-ranks', () => {
    const board = {
      members: buildStepsRows(period, 'me', [
        member('me', 'Ani', { '2026-11-02': 4000, '2026-11-03': 4100 }),
        member('b', 'Bea', { '2026-11-02': 12000, '2026-11-03': 100 }),
        member('p', 'Pat', { '2026-11-03': 9000 }, { visible: false }),
      ]),
    };
    const out = overlayLegacySteps([legacy('me', 1), legacy('p', 2), legacy('b', 3), legacy('gone', 4)], board);
    expect(out.map((e) => e.user_id)).toEqual(['B', 'ME', 'P', 'GONE']);
    expect(out[0]).toMatchObject({ rank: 1, progress_percentage: 76, current_value: 6.1, target_value: 8, starting_value: null, goal_unit: LEGACY_STEPS_UNIT, goal_type: 'weight_loss' });
    expect(out[1]).toMatchObject({ rank: 2, progress_percentage: 51, current_value: 4.1 });
    expect(out[2]).toMatchObject({ rank: 3, progress_percentage: 0, current_value: null, target_value: null, goal_unit: null });
  });

  it('reads "No data -> goal" before the start', () => {
    const upcoming = stepsPeriod('2026-11-02', '2026-11-30', '2026-11-01');
    const board = { members: buildStepsRows(upcoming, 'me', [member('me', 'Ani', {}, { local_today: '2026-11-01' })]) };
    expect(overlayLegacySteps([legacy('me', 1)], board)[0]).toMatchObject({ progress_percentage: 0, current_value: null, target_value: 8, goal_unit: LEGACY_STEPS_UNIT });
  });
});
