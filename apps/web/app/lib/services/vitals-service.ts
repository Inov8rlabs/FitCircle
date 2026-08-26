/**
 * VitalsService — builds the dashboard Weight / BMI / Water summary and
 * stores the user's weight + hydration goals.
 *
 * Sources: daily_tracking.weight_kg (weight), profiles.height_cm (BMI),
 * food_log_entries(entry_type=water).water_ml + beverage_logs(category=water)
 * .volume_ml (water — both tables, both soft-deleted via deleted_at).
 * Goals: profiles.goals[type=weight] (target/starting), and the hydration
 * target in profiles.preferences.hydration — NOT a new goals[] type, because
 * shipped iOS builds decode goals[].type as a closed enum and would fail to
 * decode the whole user.
 *
 * All day math is in the user's timezone via lib/utils/timezone.
 */

import { createAdminSupabase } from '../supabase-admin';
import {
  DEFAULT_WATER_GOAL_ML,
  type VitalsBmi,
  type VitalsGoalsUpdate,
  type VitalsSummary,
  type VitalsWater,
  type VitalsWeight,
  type VitalsWeightGoal,
} from '../types/vitals';
import { BMI_BANDS, BMI_SCALE, bmiCategory, computeBmi, healthyWeightRangeKg } from '../utils/bmi';
import { getLastNDays, getTodayInTimezone } from '../utils/timezone';

const MAX_DAYS = 90;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export class VitalsService {
  static async getSummary(userId: string, opts: { days?: number; timezone?: string | null } = {}): Promise<VitalsSummary> {
    const supabase = createAdminSupabase();
    const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(opts.days ?? 7)));

    const { data: profile } = await supabase
      .from('profiles')
      .select('height_cm, weight_kg, goals, preferences, timezone')
      .eq('id', userId)
      .maybeSingle();

    const timezone = opts.timezone || profile?.timezone || 'UTC';
    const dayList = getLastNDays(days, timezone); // today first
    const end = dayList[0];
    const start = dayList[dayList.length - 1];
    const prefs = (profile?.preferences ?? {}) as Record<string, any>;
    const units: 'metric' | 'imperial' =
      prefs.display?.units === 'imperial' || prefs.unitSystem === 'imperial' ? 'imperial' : 'metric';

    const [weight, water] = await Promise.all([
      this.buildWeight(supabase, userId, profile?.goals, profile?.weight_kg ?? null, start, end),
      this.buildWater(supabase, userId, prefs, dayList),
    ]);

    return {
      period: { days, start, end, timezone },
      units,
      weight,
      bmi: this.buildBmi(profile?.height_cm ?? null, weight?.current_kg ?? null),
      water,
    };
  }

  // ---------------------------------------------------------------------------

  private static async buildWeight(
    supabase: any,
    userId: string,
    goals: any,
    profileWeightKg: number | null,
    start: string,
    end: string
  ): Promise<VitalsWeight | null> {
    // Latest reading on file (may be older than the period).
    const { data: latestRows } = await supabase
      .from('daily_tracking')
      .select('tracking_date, weight_kg')
      .eq('user_id', userId)
      .gt('weight_kg', 0)
      .order('tracking_date', { ascending: false })
      .limit(1);
    const latest = (latestRows ?? [])[0];
    if (!latest?.weight_kg) return null;

    // Readings inside the period, oldest first.
    const { data: inWindow } = await supabase
      .from('daily_tracking')
      .select('tracking_date, weight_kg')
      .eq('user_id', userId)
      .gt('weight_kg', 0)
      .gte('tracking_date', start)
      .lte('tracking_date', end)
      .order('tracking_date', { ascending: true });
    const series = ((inWindow ?? []) as { tracking_date: string; weight_kg: number }[]).map(r => ({
      date: r.tracking_date,
      kg: Number(r.weight_kg),
    }));

    // Baseline for "change": the first reading in the period when there are at
    // least two, otherwise the most recent reading BEFORE the period — so a
    // single weigh-in this week still shows movement since the last one.
    let baseline: { date: string; kg: number } | null = null;
    if (series.length >= 2) {
      baseline = series[0];
    } else {
      const { data: before } = await supabase
        .from('daily_tracking')
        .select('tracking_date, weight_kg')
        .eq('user_id', userId)
        .gt('weight_kg', 0)
        .lt('tracking_date', start)
        .order('tracking_date', { ascending: false })
        .limit(1);
      const b = (before ?? [])[0];
      if (b?.weight_kg) baseline = { date: b.tracking_date, kg: Number(b.weight_kg) };
    }

    const currentKg = Number(latest.weight_kg);
    const changeKg = baseline && baseline.date !== latest.tracking_date ? round1(currentKg - baseline.kg) : null;

    // Earliest reading ever — the starting point when the user never set one.
    const { data: earliestRows } = await supabase
      .from('daily_tracking')
      .select('tracking_date, weight_kg')
      .eq('user_id', userId)
      .gt('weight_kg', 0)
      .order('tracking_date', { ascending: true })
      .limit(1);
    const earliestKg = (earliestRows ?? [])[0]?.weight_kg ? Number(earliestRows[0].weight_kg) : profileWeightKg;

    return {
      current_kg: currentKg,
      current_date: latest.tracking_date,
      baseline_kg: baseline?.kg ?? null,
      baseline_date: baseline?.date ?? null,
      change_kg: changeKg,
      series,
      goal: this.buildGoal(goals, currentKg, earliestKg),
    };
  }

  private static buildGoal(goals: any, currentKg: number, earliestKg: number | null): VitalsWeightGoal | null {
    const weightGoal = Array.isArray(goals) ? goals.find((g: any) => g?.type === 'weight') : null;
    const targetKg = Number(weightGoal?.target_weight_kg);
    if (!weightGoal || !Number.isFinite(targetKg) || targetKg <= 0) return null;

    const startingKg =
      Number.isFinite(Number(weightGoal.starting_weight_kg)) && Number(weightGoal.starting_weight_kg) > 0
        ? Number(weightGoal.starting_weight_kg)
        : earliestKg;
    const direction = targetKg < currentKg ? 'lose' : targetKg > currentKg ? 'gain' : 'maintain';
    const toGo = round1(Math.abs(currentKg - targetKg));

    let progress: number | null = null;
    if (startingKg != null && startingKg !== targetKg) {
      const raw = ((startingKg - currentKg) / (startingKg - targetKg)) * 100;
      progress = Math.max(0, Math.min(100, Math.round(raw)));
    }
    const reached = direction === 'lose' ? currentKg <= targetKg : direction === 'gain' ? currentKg >= targetKg : true;

    return { target_kg: targetKg, starting_kg: startingKg, to_go_kg: reached ? 0 : toGo, direction, progress_pct: reached ? 100 : progress, reached };
  }

  private static buildBmi(heightCm: number | null, currentKg: number | null): VitalsBmi {
    const scale = { min: BMI_SCALE.min, max: BMI_SCALE.max, bands: BMI_BANDS };
    if (!heightCm) return { value: null, category: null, height_cm: null, healthy_range_kg: null, scale, missing: 'height' };
    const range = healthyWeightRangeKg(heightCm);
    if (!currentKg) return { value: null, category: null, height_cm: heightCm, healthy_range_kg: range, scale, missing: 'weight' };
    const value = computeBmi(currentKg, heightCm)!;
    return { value, category: bmiCategory(value), height_cm: heightCm, healthy_range_kg: range, scale, missing: null };
  }

  private static async buildWater(supabase: any, userId: string, prefs: Record<string, any>, dayList: string[]): Promise<VitalsWater> {
    const start = dayList[dayList.length - 1];
    const end = dayList[0];
    const userGoal = Number(prefs.hydration?.daily_water_ml_target);
    const goalMl = Number.isFinite(userGoal) && userGoal > 0 ? Math.round(userGoal) : DEFAULT_WATER_GOAL_ML;

    const [{ data: foodWater }, { data: bevWater }] = await Promise.all([
      supabase
        .from('food_log_entries')
        .select('entry_date, water_ml')
        .eq('user_id', userId)
        .eq('entry_type', 'water')
        .is('deleted_at', null)
        .gte('entry_date', start)
        .lte('entry_date', end),
      supabase
        .from('beverage_logs')
        .select('entry_date, volume_ml')
        .eq('user_id', userId)
        .eq('category', 'water')
        .is('deleted_at', null)
        .gte('entry_date', start)
        .lte('entry_date', end),
    ]);

    const byDay = new Map<string, number>(dayList.map(d => [d, 0]));
    for (const r of (foodWater ?? []) as { entry_date: string; water_ml: number | null }[]) {
      if (byDay.has(r.entry_date)) byDay.set(r.entry_date, byDay.get(r.entry_date)! + (r.water_ml ?? 0));
    }
    for (const r of (bevWater ?? []) as { entry_date: string; volume_ml: number | null }[]) {
      if (byDay.has(r.entry_date)) byDay.set(r.entry_date, byDay.get(r.entry_date)! + (r.volume_ml ?? 0));
    }

    // Oldest → newest for charting.
    const days = [...dayList].reverse().map(date => {
      const ml = byDay.get(date) ?? 0;
      return { date, ml, goal_met: ml >= goalMl };
    });
    const totalMl = days.reduce((a, d) => a + d.ml, 0);
    const totalGoal = goalMl * days.length;

    return {
      goal_ml: goalMl,
      goal_source: Number.isFinite(userGoal) && userGoal > 0 ? 'user' : 'default',
      days,
      total_ml: totalMl,
      total_goal_ml: totalGoal,
      pct: totalGoal > 0 ? Math.round((totalMl / totalGoal) * 100) : 0,
      days_met: days.filter(d => d.goal_met).length,
      today_ml: byDay.get(end) ?? 0,
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Merge goal changes into the profile: the weight goal into goals[] (kept in
   * the shape every client already decodes) and the hydration target into
   * preferences.hydration. Passing null clears that goal.
   */
  static async updateGoals(userId: string, update: VitalsGoalsUpdate): Promise<{ goals: any[]; preferences: Record<string, any> }> {
    const supabase = createAdminSupabase();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('goals, preferences')
      .eq('id', userId)
      .single();
    if (error) throw error;

    const goals: any[] = Array.isArray(profile?.goals) ? [...profile.goals] : [];
    const prefs: Record<string, any> = { ...(profile?.preferences ?? {}) };

    if (update.target_weight_kg !== undefined) {
      const others = goals.filter(g => g?.type !== 'weight');
      if (update.target_weight_kg === null) {
        goals.splice(0, goals.length, ...others);
      } else {
        const existing = goals.find(g => g?.type === 'weight') ?? {};
        goals.splice(0, goals.length, ...others, {
          ...existing,
          type: 'weight',
          target_weight_kg: round1(update.target_weight_kg),
          starting_weight_kg:
            update.starting_weight_kg === undefined
              ? existing.starting_weight_kg ?? null
              : update.starting_weight_kg === null
                ? null
                : round1(update.starting_weight_kg),
          updated_at: new Date().toISOString(),
        });
      }
    } else if (update.starting_weight_kg !== undefined) {
      const existing = goals.find(g => g?.type === 'weight');
      if (existing) existing.starting_weight_kg = update.starting_weight_kg === null ? null : round1(update.starting_weight_kg);
    }

    if (update.daily_water_ml_target !== undefined) {
      if (update.daily_water_ml_target === null) {
        delete prefs.hydration;
      } else {
        prefs.hydration = { ...(prefs.hydration ?? {}), daily_water_ml_target: Math.round(update.daily_water_ml_target) };
      }
    }

    const { data, error: updateError } = await supabase
      .from('profiles')
      .update({ goals, preferences: prefs, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('goals, preferences')
      .single();
    if (updateError) throw updateError;
    return { goals: data.goals ?? [], preferences: data.preferences ?? {} };
  }
}
