import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VitalsService } from '@/lib/services/vitals-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');

const USER = 'user-1';
const NOW = new Date('2026-08-25T18:00:00Z'); // 2pm Toronto
let db: FakeSupabase;

function seed(opts: { height?: number | null; goals?: any[]; prefs?: any; weights?: [string, number][]; water?: [string, number][]; bev?: [string, number][] } = {}) {
  db.seed('profiles', [{ id: USER, height_cm: opts.height === undefined ? 180 : opts.height, weight_kg: null, goals: opts.goals ?? [], preferences: opts.prefs ?? { display: { units: 'metric' } }, timezone: 'America/Toronto' }]);
  for (const [d, kg] of opts.weights ?? []) db.seed('daily_tracking', [{ user_id: USER, tracking_date: d, weight_kg: kg }]);
  for (const [d, ml] of opts.water ?? []) db.seed('food_log_entries', [{ user_id: USER, entry_type: 'water', entry_date: d, water_ml: ml, deleted_at: null }]);
  for (const [d, ml] of opts.bev ?? []) db.seed('beverage_logs', [{ user_id: USER, category: 'water', entry_date: d, volume_ml: ml, deleted_at: null }]);
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  db = new FakeSupabase({ profiles: { uniqueKey: ['id'] }, daily_tracking: { uniqueKey: ['user_id', 'tracking_date'] }, food_log_entries: {}, beverage_logs: {} });
  (createAdminSupabase as any).mockReturnValue(db);
});
afterEach(() => vi.useRealTimers());

describe('VitalsService.getSummary', () => {
  it('weight: current, change over the period, series, goal to-go and progress', async () => {
    seed({
      goals: [{ type: 'weight', target_weight_kg: 73, starting_weight_kg: 85 }],
      weights: [['2026-08-19', 80.1], ['2026-08-22', 79.3], ['2026-08-25', 78.5]],
    });
    const s = await VitalsService.getSummary(USER, { days: 7, timezone: 'America/Toronto' });
    expect(s.period).toMatchObject({ days: 7, start: '2026-08-19', end: '2026-08-25', timezone: 'America/Toronto' });
    expect(s.weight?.current_kg).toBe(78.5);
    expect(s.weight?.change_kg).toBe(-1.6);
    expect(s.weight?.series.map(p => p.date)).toEqual(['2026-08-19', '2026-08-22', '2026-08-25']);
    expect(s.weight?.goal).toMatchObject({ target_kg: 73, starting_kg: 85, to_go_kg: 5.5, direction: 'lose', progress_pct: 54, reached: false });
  });

  it('weight: a single reading in the period compares against the last reading before it', async () => {
    seed({ weights: [['2026-08-10', 80.0], ['2026-08-24', 79.0]] });
    const s = await VitalsService.getSummary(USER, { days: 7, timezone: 'America/Toronto' });
    expect(s.weight?.change_kg).toBe(-1);
    expect(s.weight?.baseline_date).toBe('2026-08-10');
    expect(s.weight?.goal).toBeNull();
  });

  it('bmi: value, category, healthy range; missing height is reported', async () => {
    seed({ weights: [['2026-08-25', 78.5]] });
    const s = await VitalsService.getSummary(USER, { days: 7 });
    expect(s.bmi).toMatchObject({ value: 24.2, category: 'normal', height_cm: 180, healthy_range_kg: { min: 59.9, max: 80.7 }, missing: null });

    db.getRows('profiles')[0].height_cm = null;
    const noHeight = await VitalsService.getSummary(USER, { days: 7 });
    expect(noHeight.bmi).toMatchObject({ value: null, missing: 'height' });
  });

  it('water: sums both sources per day in the user timezone, default goal, pct', async () => {
    seed({ water: [['2026-08-25', 500], ['2026-08-24', 2000]], bev: [['2026-08-25', 750], ['2026-08-01', 9999]] });
    const s = await VitalsService.getSummary(USER, { days: 7, timezone: 'America/Toronto' });
    expect(s.water.goal_ml).toBe(2000);
    expect(s.water.goal_source).toBe('default');
    expect(s.water.days).toHaveLength(7);
    expect(s.water.days[6]).toEqual({ date: '2026-08-25', ml: 1250, goal_met: false });
    expect(s.water.days[5]).toEqual({ date: '2026-08-24', ml: 2000, goal_met: true });
    expect(s.water.total_ml).toBe(3250);
    expect(s.water.pct).toBe(23);
    expect(s.water.days_met).toBe(1);
    expect(s.water.today_ml).toBe(1250);
  });

  it('water: honours the user goal from preferences.hydration and ignores deleted rows', async () => {
    seed({ prefs: { display: { units: 'imperial' }, hydration: { daily_water_ml_target: 3000 } }, water: [['2026-08-25', 3000]] });
    db.seed('food_log_entries', [{ user_id: USER, entry_type: 'water', entry_date: '2026-08-25', water_ml: 5000, deleted_at: '2026-08-25T10:00:00Z' }]);
    const s = await VitalsService.getSummary(USER, { days: 7 });
    expect(s.units).toBe('imperial');
    expect(s.water).toMatchObject({ goal_ml: 3000, goal_source: 'user', today_ml: 3000, days_met: 1 });
  });

  it('no weight on file → weight null, bmi missing weight, water still computed', async () => {
    seed();
    const s = await VitalsService.getSummary(USER, { days: 7 });
    expect(s.weight).toBeNull();
    expect(s.bmi.missing).toBe('weight');
    expect(s.water.total_ml).toBe(0);
  });
});

describe('VitalsService.updateGoals', () => {
  it('merges the weight goal into goals[] and hydration into preferences', async () => {
    seed({ goals: [{ type: 'steps', daily_steps_target: 8000 }] });
    const r = await VitalsService.updateGoals(USER, { target_weight_kg: 73, starting_weight_kg: 85, daily_water_ml_target: 2500 });
    expect(r.goals.find((g: any) => g.type === 'steps')).toMatchObject({ daily_steps_target: 8000 });
    expect(r.goals.find((g: any) => g.type === 'weight')).toMatchObject({ target_weight_kg: 73, starting_weight_kg: 85 });
    expect(r.preferences.hydration.daily_water_ml_target).toBe(2500);
    expect(r.preferences.display.units).toBe('metric');
  });

  it('null clears each goal independently', async () => {
    seed({ goals: [{ type: 'weight', target_weight_kg: 73 }], prefs: { hydration: { daily_water_ml_target: 2500 } } });
    const r = await VitalsService.updateGoals(USER, { target_weight_kg: null, daily_water_ml_target: null });
    expect(r.goals.find((g: any) => g.type === 'weight')).toBeUndefined();
    expect(r.preferences.hydration).toBeUndefined();
  });
});
