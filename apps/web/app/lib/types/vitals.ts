/**
 * Dashboard vitals — the one payload behind the Weight / BMI / Water cards on
 * iOS, Android and web. Canonical units (kg, ml); clients convert for display.
 */
import type { BmiBand, BmiCategory } from '../utils/bmi';

export type GoalDirection = 'lose' | 'gain' | 'maintain';

export interface VitalsWeightGoal {
  target_kg: number;
  /** Explicit starting weight if the user set one, else the earliest reading on file. */
  starting_kg: number | null;
  /** |current − target|, 0 when reached. */
  to_go_kg: number;
  direction: GoalDirection;
  /** 0..100 progress from starting → target; null when starting is unknown or equals target. */
  progress_pct: number | null;
  reached: boolean;
}

export interface VitalsWeight {
  current_kg: number;
  current_date: string;
  /** The reading `change_kg` is measured against (start of period, or the last reading before it). */
  baseline_kg: number | null;
  baseline_date: string | null;
  /** current − baseline; negative = lost. Null when there is nothing to compare with. */
  change_kg: number | null;
  series: { date: string; kg: number }[];
  goal: VitalsWeightGoal | null;
}

export interface VitalsBmi {
  value: number | null;
  category: BmiCategory | null;
  height_cm: number | null;
  healthy_range_kg: { min: number; max: number } | null;
  scale: { min: number; max: number; bands: BmiBand[] };
  /** Why `value` is null. */
  missing: 'height' | 'weight' | null;
}

export interface VitalsWaterDay {
  date: string;
  ml: number;
  goal_met: boolean;
}

export interface VitalsWater {
  goal_ml: number;
  goal_source: 'user' | 'default';
  days: VitalsWaterDay[];
  total_ml: number;
  /** goal_ml × days in period. */
  total_goal_ml: number;
  /** 0..100+ (can exceed 100). */
  pct: number;
  days_met: number;
  today_ml: number;
}

export interface VitalsSummary {
  period: { days: number; start: string; end: string; timezone: string };
  units: 'metric' | 'imperial';
  weight: VitalsWeight | null;
  bmi: VitalsBmi;
  water: VitalsWater;
}

export interface VitalsGoalsUpdate {
  target_weight_kg?: number | null;
  starting_weight_kg?: number | null;
  daily_water_ml_target?: number | null;
}

/** Default hydration target when the user hasn't set one (general adult guidance). */
export const DEFAULT_WATER_GOAL_ML = 2000;
